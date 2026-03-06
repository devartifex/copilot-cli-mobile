import { test, expect, type Page, type BrowserContext, type Browser } from '@playwright/test';

const WS_STUB_SCRIPT = () => {
  window.WebSocket = class extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = 3;
    url = '';
    protocol = '';
    extensions = '';
    bufferedAmount = 0;
    binaryType: BinaryType = 'blob';
    onopen: ((ev: Event) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    send() {}
    close() {}
  } as unknown as typeof WebSocket;
};

async function openAuthenticatedPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route('**/auth/status', (route) =>
    route.fulfill({ json: { authenticated: true, githubUser: 'testuser' } }),
  );
  await page.addInitScript(WS_STUB_SCRIPT);
  await page.goto('/');
  await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 10000 });
  return { page, context };
}

async function openUnauthenticatedPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.route('**/auth/status', (route) =>
    route.fulfill({ json: { authenticated: false, githubUser: null } }),
  );
  await page.route('**/auth/github/device/start', (route) =>
    route.fulfill({
      json: {
        user_code: 'RESP-0001',
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
  await expect(page.locator('#github-screen')).toBeVisible({ timeout: 10000 });
  return { page, context };
}

test.describe('Responsive — Login screen', () => {
  test('login screen renders on small phone (320x568)', async ({ browser }) => {
    const { page, context } = await openUnauthenticatedPage(browser, { width: 320, height: 568 });

    await expect(page.locator('.banner-box')).toBeVisible();
    await expect(page.locator('#device-code-text')).toBeVisible();
    await expect(page.locator('#copy-code-btn')).toBeVisible();

    // No horizontal overflow
    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    await context.close();
  });

  test('login screen renders on tablet (768x1024)', async ({ browser }) => {
    const { page, context } = await openUnauthenticatedPage(browser, { width: 768, height: 1024 });

    await expect(page.locator('.banner-box')).toBeVisible();
    await expect(page.locator('#device-code-text')).toBeVisible();
    await context.close();
  });
});

test.describe('Responsive — Chat screen', () => {
  test('chat screen fits small phone viewport (320x568)', async ({ browser }) => {
    const { page, context } = await openAuthenticatedPage(browser, { width: 320, height: 568 });

    await expect(page.locator('#message-input')).toBeVisible();
    await expect(page.locator('#banner')).toBeVisible();
    await expect(page.locator('.input-footer')).toBeVisible();

    // No horizontal overflow
    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    await context.close();
  });

  test('chat screen fits standard phone viewport (375x667)', async ({ browser }) => {
    const { page, context } = await openAuthenticatedPage(browser, { width: 375, height: 667 });

    await expect(page.locator('#message-input')).toBeVisible();
    await expect(page.locator('#mode-select')).toBeVisible();
    await expect(page.locator('#model-select')).toBeVisible();

    await context.close();
  });

  test('chat screen uses full width on desktop (1280x720)', async ({ browser }) => {
    const { page, context } = await openAuthenticatedPage(browser, { width: 1280, height: 720 });

    const terminalBox = page.locator('#chat-screen .terminal');
    const terminalWidth = await terminalBox.evaluate((el) => el.getBoundingClientRect().width);
    expect(terminalWidth).toBeGreaterThan(700);

    await context.close();
  });

  test('landscape mode on short viewport', async ({ browser }) => {
    const { page, context } = await openAuthenticatedPage(browser, { width: 812, height: 375 });

    // On landscape with short height, banner should be compact or hidden
    const banner = page.locator('#banner');
    const bannerBox = await banner.boundingBox();
    if (bannerBox) {
      expect(bannerBox.height).toBeLessThan(375);
    }

    await context.close();
  });

  test('input footer controls remain accessible at 380px width', async ({ browser }) => {
    const { page, context } = await openAuthenticatedPage(browser, { width: 380, height: 667 });

    await expect(page.locator('#mode-select')).toBeAttached();
    await expect(page.locator('#model-select')).toBeAttached();
    await expect(page.locator('#new-chat-btn')).toBeAttached();
    await expect(page.locator('#logout-btn')).toBeAttached();

    await context.close();
  });
});
