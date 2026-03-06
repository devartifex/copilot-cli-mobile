import { test, expect, type Page } from '@playwright/test';

// Helper: mock /auth/status to unauthenticated (default behaviour)
async function mockUnauthenticated(page: Page) {
  await page.route('**/auth/status', (route) =>
    route.fulfill({ json: { authenticated: false, githubUser: null } }),
  );
}

test.describe('Login screen', () => {
  test.beforeEach(async ({ page }) => {
    await mockUnauthenticated(page);
  });

  test('shows github login screen by default', async ({ page }) => {
    await page.goto('/');
    const loginScreen = page.locator('#github-screen');
    await expect(loginScreen).toBeVisible();
    await expect(page.locator('#chat-screen')).toBeHidden();
  });

  test('displays banner with GitHub Copilot title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#github-screen .banner-title')).toContainText('GitHub Copilot');
    await expect(page.locator('#github-screen .banner-sub')).toContainText('Authenticate');
  });

  test('shows device code placeholder', async ({ page }) => {
    await page.goto('/');
    const codeText = page.locator('#device-code-text');
    await expect(codeText).toBeVisible();
    await expect(codeText).toHaveText('--------');
  });

  test('shows copy button', async ({ page }) => {
    await page.goto('/');
    const copyBtn = page.locator('#copy-code-btn');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText('copy');
  });

  test('shows GitHub device link', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('#device-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/login/device');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('shows waiting status with spinner', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('#device-status-text');
    await expect(status).toContainText('Waiting for authorization');
    await expect(page.locator('#device-spinner')).toBeVisible();
  });

  test('updates device code after flow starts', async ({ page }) => {
    // Mock the device flow start endpoint
    await page.route('**/auth/github/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'ABCD-1234',
          device_code: 'test-device-code',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      }),
    );
    // Block poll so it doesn't interfere
    await page.route('**/auth/github/device/poll', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    );

    await page.goto('/');
    const codeText = page.locator('#device-code-text');
    await expect(codeText).toHaveText('ABCD-1234', { timeout: 5000 });
  });

  test('copy button copies device code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.route('**/auth/github/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'COPY-TEST',
          device_code: 'dc',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      }),
    );
    await page.route('**/auth/github/device/poll', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    );

    await page.goto('/');
    await expect(page.locator('#device-code-text')).toHaveText('COPY-TEST', { timeout: 5000 });
    await page.locator('#copy-code-btn').click();
    await expect(page.locator('#copy-code-btn')).toHaveText('copied!');
  });

  test('shows countdown timer', async ({ page }) => {
    await page.route('**/auth/github/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'TMR-0001',
          device_code: 'dc',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        },
      }),
    );
    await page.route('**/auth/github/device/poll', (route) =>
      route.fulfill({ json: { status: 'pending' } }),
    );

    await page.goto('/');
    const expires = page.locator('#device-expires');
    await expect(expires).toContainText('Code expires in', { timeout: 5000 });
  });
});
