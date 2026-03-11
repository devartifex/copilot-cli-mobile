import { test, expect, type Page } from '@playwright/test';

// SvelteKit renders chat screen only when authenticated (server-side).
// Without a real GitHub session, message rendering tests are limited.
// These tests verify the component structure renders without errors.

test.describe('Message rendering — structural', () => {
  test('login page loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForTimeout(2000);

    // Allow WebSocket/fetch errors (expected without real server session)
    const unexpected = errors.filter(
      (e) =>
        !e.includes('WebSocket') &&
        !e.includes('fetch') &&
        !e.includes('Failed to fetch') &&
        !e.includes('NetworkError'),
    );
    expect(unexpected).toHaveLength(0);
  });

  test('login screen renders device flow UI', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'MSG-0001',
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

    // Device code visible
    const code = page.locator('.device-code-text').first();
    await expect(code).toBeVisible({ timeout: 10000 });

    // Login card structure present
    await expect(page.locator('.login-card')).toBeVisible();
    await expect(page.locator('.login-status')).toBeVisible();
  });

  test('error page renders for unknown routes', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    // SvelteKit should render the error page (not a blank page)
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});
