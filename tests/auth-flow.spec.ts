import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { MOCK_USER } from './helpers';

const DEFAULT_DEVICE_FLOW = {
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 1,
};

const AUTHORIZED_USER = {
  login: MOCK_USER.login,
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
};

function buildLayoutData(authenticated: boolean) {
  if (authenticated) {
    return {
      type: 'data',
      nodes: [
        {
          type: 'data',
          data: [
            { authenticated: 1, user: 2 },
            true,
            { login: 3, name: 4 },
            MOCK_USER.login,
            MOCK_USER.name,
          ],
          uses: {},
        },
        { type: 'skip' },
      ],
    };
  }

  return {
    type: 'data',
    nodes: [
      {
        type: 'data',
        data: [{ authenticated: 1, user: 2 }, false, null],
        uses: {},
      },
      { type: 'skip' },
    ],
  };
}

async function mockSettingsApi(page: Page): Promise<void> {
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { settings: null } });
    }

    return route.fulfill({ json: { success: true } });
  });
}

async function mockDeviceFlowStart(
  page: Page,
  overrides: Partial<typeof DEFAULT_DEVICE_FLOW> = {},
): Promise<void> {
  await page.route('**/auth/device/start', (route) =>
    route.fulfill({
      json: {
        ...DEFAULT_DEVICE_FLOW,
        ...overrides,
      },
    }),
  );
}

async function mockAuthenticatedWebSocket(page: Page): Promise<void> {
  await page.routeWebSocket('**/ws*', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', user: MOCK_USER.login }));

    ws.onMessage((data) => {
      const message = JSON.parse(data as string) as { type?: string };

      if (message.type === 'new_session') {
        ws.send(JSON.stringify({ type: 'session_created', model: 'gpt-4.1' }));
      }

      if (message.type === 'list_models') {
        ws.send(
          JSON.stringify({
            type: 'models',
            models: [
              {
                id: 'gpt-4.1',
                name: 'GPT-4.1',
                vendor: 'OpenAI',
                capabilities: { supports: {} },
              },
            ],
          }),
        );
      }
    });
  });
}

async function mockAuthReloadState(
  page: Page,
  authState: { authenticated: boolean },
): Promise<void> {
  await page.route('/', async (route) => {
    const response = await route.fetch();
    let html = await response.text();

    if (authState.authenticated) {
      html = html.replace(
        /data:\{authenticated:false,user:null\}/g,
        `data:{authenticated:true,user:{login:"${MOCK_USER.login}",name:"${MOCK_USER.name}"}}`,
      );
    }

    await route.fulfill({ response, body: html });
  });

  await page.route('**/__data.json*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(buildLayoutData(authState.authenticated)),
    }),
  );

  await page.route('**/auth/status', (route) =>
    route.fulfill({
      json: {
        authenticated: authState.authenticated,
        user: authState.authenticated
          ? { login: MOCK_USER.login, name: MOCK_USER.name }
          : null,
        githubUser: authState.authenticated ? MOCK_USER.login : null,
      },
    }),
  );
}

test.describe('Device flow authentication', () => {
  test('completes the full device flow journey and opens the chat screen', async ({ page }) => {
    const authState = { authenticated: false };
    let pollCount = 0;

    await mockAuthReloadState(page, authState);
    await mockSettingsApi(page);
    await mockAuthenticatedWebSocket(page);
    await mockDeviceFlowStart(page);
    await page.route('**/auth/device/poll', (route) => {
      pollCount += 1;

      if (pollCount === 1) {
        return route.fulfill({ json: { status: 'pending' } });
      }

      authState.authenticated = true;
      return route.fulfill({
        json: {
          status: 'authorized',
          githubUser: MOCK_USER.login,
          user: AUTHORIZED_USER,
        },
      });
    });

    await page.goto('/');

    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('.device-code-text')).toHaveText('ABCD-1234');
    await expect(page.locator('.login-status')).toContainText('Waiting for authorization');

    await expect(page.locator('.terminal')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.hamburger-btn')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.login-screen')).toBeHidden();
  });

  test('shows an error state when the device flow cannot start', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        status: 500,
        json: { error: 'Failed to start device flow' },
      }),
    );

    await page.goto('/');

    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('.login-status')).toContainText('Failed to start device flow');
    await expect(page.locator('.spinner-char.failed')).toBeVisible();
  });

  test('shows an expired message when the device code expires', async ({ page }) => {
    await mockDeviceFlowStart(page);
    await page.route('**/auth/device/poll', (route) =>
      route.fulfill({ json: { status: 'expired' } }),
    );

    await page.goto('/');

    await expect(page.locator('.device-code-text')).toHaveText('ABCD-1234');
    await expect(page.locator('.login-status')).toContainText('Code expired');
    await expect(page.locator('.spinner-char.failed')).toBeVisible();
  });

  test('shows a denied message when GitHub authorization is cancelled', async ({ page }) => {
    await mockDeviceFlowStart(page);
    await page.route('**/auth/device/poll', (route) =>
      route.fulfill({ json: { status: 'access_denied' } }),
    );

    await page.goto('/');

    await expect(page.locator('.device-code-text')).toHaveText('ABCD-1234');
    await expect(page.locator('.login-status')).toContainText('Access denied');
    await expect(page.locator('.spinner-char.failed')).toBeVisible();
  });

  test('displays the countdown timer while polling for authorization', async ({ page }) => {
    await mockDeviceFlowStart(page, {
      user_code: 'TIME-4321',
      expires_in: 125,
      interval: 60,
    });
    await page.route('**/auth/device/poll', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    );

    await page.goto('/');

    await expect(page.locator('.device-code-text')).toHaveText('TIME-4321');
    await expect(page.locator('.login-expires')).toBeVisible();
    await expect(page.locator('.login-expires')).toContainText(/Code expires in \d+:\d{2}/);
  });

  test('copies the device code to the clipboard', async ({ page }) => {
    await page.addInitScript(() => {
      const clipboardState = { value: '' };

      Object.defineProperty(window, '__copiedText', {
        value: clipboardState,
        configurable: true,
      });

      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            clipboardState.value = text;
          },
        },
        configurable: true,
      });
    });

    await mockDeviceFlowStart(page, { user_code: 'COPY-2468', interval: 60 });
    await page.route('**/auth/device/poll', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    );

    await page.goto('/');

    const copyButton = page.locator('button.copy-code-btn');
    await expect(copyButton).toBeVisible();
    await expect(page.locator('.device-code-text')).toHaveText('COPY-2468');

    await copyButton.click();

    await expect(copyButton).toHaveText('copied!');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const windowWithClipboard = window as typeof window & {
            __copiedText?: { value: string };
          };

          return windowWithClipboard.__copiedText?.value ?? '';
        }),
      )
      .toBe('COPY-2468');
  });
});

test.describe('Authenticated session actions', () => {
  test('signing out returns the user to the login screen', async ({ page }) => {
    const authState = { authenticated: true };

    await mockAuthReloadState(page, authState);
    await mockSettingsApi(page);
    await mockAuthenticatedWebSocket(page);
    await page.route('**/auth/logout', (route) => {
      authState.authenticated = false;
      return route.fulfill({ json: { success: true } });
    });

    await page.goto('/');
    await expect(page.locator('.terminal')).toBeVisible({ timeout: 10000 });

    await page.locator('button.hamburger-btn').click();
    const signOutButton = page.locator('button.sidebar-action.sidebar-action-danger');
    await expect(signOutButton).toBeVisible();

    await signOutButton.click();

    await expect(page.locator('.login-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.terminal')).toBeHidden();
  });
});
