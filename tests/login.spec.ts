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
    await expect(page.locator('.hero-title')).toContainText('Copilot Unleashed');
  });

  test('shows device code area before flow completes', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'PLCH-0001',
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
    const codeText = page.locator('.device-code-text');
    await expect(codeText.first()).toBeVisible({ timeout: 10000 });
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

  test('shows error state when device flow start fails', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to start device flow' }),
      }),
    );

    await page.goto('/');
    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.login-status')).toContainText('Failed to start device flow', {
      timeout: 10000,
    });
  });

  test('login screen has hero section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.hero-tagline')).toContainText(
      'Multi-model AI chat powered by GitHub Copilot SDK',
    );
    await expect(page.locator('.feature')).toHaveCount(3);
    await expect(page.locator('.hero-features')).toContainText('GPT, Claude, Gemini — one interface');
    await expect(page.locator('.hero-features')).toContainText('Real-time streaming responses');
    await expect(page.locator('.hero-features')).toContainText('GitHub tools & MCP servers built-in');
  });
});
