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

    // Login section structure present
    await expect(page.locator('.login-section')).toBeVisible();
    await expect(page.locator('.login-status')).toBeVisible();
  });

  test('error page renders for unknown routes', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    // SvelteKit should render the error page (not a blank page)
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('error page shows error content for 404', async ({ page }) => {
    await page.route('**/_app/immutable/**', (route) => route.abort());

    const response = await page.goto('/nonexistent');
    expect(response).toBeTruthy();
    expect(response!.status()).toBeGreaterThanOrEqual(400);

    await expect(page.locator('.error-page')).toBeVisible();
    await expect(page.locator('.error-page a')).toHaveAttribute('href', '/');
    await expect(page.locator('.error-page')).toContainText('Return home');

    const heading = await page.locator('.error-page h1').textContent();
    const message = await page.locator('.error-page p').textContent();
    expect(heading?.trim().length).toBeGreaterThan(0);
    expect(message?.trim().length).toBeGreaterThan(0);
  });

  test('login screen structure has all expected sections', async ({ page }) => {
    await page.route('**/auth/device/start', (route) =>
      route.fulfill({
        json: {
          user_code: 'SECT-0001',
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
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.login-section')).toBeVisible();
    await expect(page.locator('.device-code-box')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.device-code-text').first()).toHaveText('SECT-0001', {
      timeout: 10000,
    });
  });
});
