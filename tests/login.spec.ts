import { test, expect, type Page } from '@playwright/test';

// SvelteKit uses server-side auth check via +layout.server.ts.
// In test mode with no real session, the server returns unauthenticated,
// so the DeviceFlowLogin component renders by default.

test.describe('Login screen', () => {
  test('shows login screen by default (unauthenticated)', async ({ page }) => {
    await page.goto('/');
    const loginScreen = page.locator('.login-screen');
    await expect(loginScreen).toBeVisible();
  });

  test('displays login title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.login-title')).toContainText('Copilot CLI Mobile');
  });

  test('shows device code placeholder before flow starts', async ({ page }) => {
    await page.goto('/');
    const placeholder = page.locator('.device-code-text.placeholder');
    // Either the placeholder shows or the real code loads quickly
    const codeText = page.locator('.device-code-text');
    await expect(codeText.first()).toBeVisible();
  });

  test('shows copy button once device code loads', async ({ page }) => {
    // Mock device flow start
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'ABCD-1234',
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
    const copyBtn = page.locator('.copy-code-btn');
    await expect(copyBtn).toBeVisible({ timeout: 10000 });
  });

  test('shows device code from server', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'TEST-9999',
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
    const codeText = page.locator('.device-code-text').first();
    await expect(codeText).toHaveText('TEST-9999', { timeout: 10000 });
  });

  test('shows GitHub device link', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'LINK-0001',
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
    const link = page.locator('.device-link-btn');
    await expect(link).toBeVisible({ timeout: 10000 });
    await expect(link).toHaveAttribute('href', 'https://github.com/login/device');
  });

  test('shows spinner while polling', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'SPIN-0001',
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
    const spinner = page.locator('.spinner-char');
    await expect(spinner.first()).toBeVisible({ timeout: 10000 });
  });
});
