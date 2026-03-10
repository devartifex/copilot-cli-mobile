/**
 * Screenshot generation script — run with:
 *   npx playwright test tests/screenshots.spec.ts --project=desktop
 *
 * Outputs to docs/screenshots/
 */

import { test, type Browser } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT_DIR = path.resolve('docs/screenshots');

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

async function openLogin(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();

  await page.route('**/auth/device/start', (r) =>
    r.fulfill({
      json: {
        user_code: 'B4F2-9AE1',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      },
    }),
  );
  await page.route('**/auth/device/poll', (r) =>
    r.fulfill({ json: { status: 'pending' } }),
  );

  await page.goto('/');
  // Wait for login screen to render with device code
  await page.waitForSelector('.device-code-text', { state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  return { page, ctx };
}

// ── Login screens ─────────────────────────────────────────────────────────────

test('screenshot: login — mobile', async ({ browser }) => {
  test.skip(!!process.env.CI, 'screenshot generation skipped in CI');
  const { page, ctx } = await openLogin(browser, { width: 390, height: 844 });
  await page.screenshot({ path: `${OUT_DIR}/login-mobile.png`, fullPage: false });
  await ctx.close();
});

test('screenshot: login — desktop', async ({ browser }) => {
  test.skip(!!process.env.CI, 'screenshot generation skipped in CI');
  const { page, ctx } = await openLogin(browser, { width: 1280, height: 800 });
  await page.screenshot({ path: `${OUT_DIR}/login-desktop.png`, fullPage: false });
  await ctx.close();
});
