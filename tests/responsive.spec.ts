import { test, expect, type Browser } from '@playwright/test';

async function openLoginPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await page.route('**/auth/device/start', (route) =>
    route.fulfill({
      json: {
        user_code: 'RESP-0001',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      },
    }),
  );
  await page.route('**/auth/device/poll', (route) =>
    route.fulfill({ json: { status: 'pending' } }),
  );

  await page.goto('/');
  await expect(page.locator('.login-screen')).toBeVisible({ timeout: 10000 });
  return { page, context };
}

test.describe('Responsive — Login screen', () => {
  test('login screen renders on small phone (320x568)', async ({ browser }) => {
    const { page, context } = await openLoginPage(browser, { width: 320, height: 568 });

    await expect(page.locator('.login-section')).toBeVisible();
    await expect(page.locator('.device-code-text').first()).toBeVisible();

    // No horizontal overflow
    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    await context.close();
  });

  test('login screen renders on tablet (768x1024)', async ({ browser }) => {
    const { page, context } = await openLoginPage(browser, { width: 768, height: 1024 });

    await expect(page.locator('.login-section')).toBeVisible();
    await expect(page.locator('.device-code-text').first()).toBeVisible();

    await context.close();
  });

  test('login screen renders on desktop (1280x800)', async ({ browser }) => {
    const { page, context } = await openLoginPage(browser, { width: 1280, height: 800 });

    await expect(page.locator('.login-section')).toBeVisible();

    await context.close();
  });
});

test.describe('Responsive — general', () => {
  test('no horizontal overflow at 320px', async ({ browser }) => {
    const { page, context } = await openLoginPage(browser, { width: 320, height: 568 });

    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(320);

    await context.close();
  });

  test('page content fits within viewport at 375px', async ({ browser }) => {
    const { page, context } = await openLoginPage(browser, { width: 375, height: 667 });

    const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);

    await context.close();
  });
});
