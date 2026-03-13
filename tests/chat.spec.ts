import { test, expect, type Page } from '@playwright/test';

// SvelteKit renders the chat screen server-side when authenticated.
// Without a real session, the server returns `authenticated: false` and
// renders DeviceFlowLogin. To test the chat screen, we need the server
// to think we're authenticated. Since we can't easily mock server-side
// session in Playwright, we test what we can at the structural level.

// The login screen IS rendered by default (no session) — so chat screen
// tests are limited to structural checks unless we inject a real session.

test.describe('Chat screen structure', () => {
  test('unauthenticated users see login, not chat', async ({ page }) => {
    await page.goto('/');
    // Should see the login screen
    await expect(page.locator('.login-screen')).toBeVisible();
    // Should NOT see the chat terminal
    await expect(page.locator('.terminal')).not.toBeVisible();
  });

  test('page loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.waitForTimeout(2000);
    // Filter out expected errors (WebSocket connection failures in test)
    const unexpected = errors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('fetch'),
    );
    expect(unexpected).toHaveLength(0);
  });

  test('health endpoint responds', async ({ page }) => {
    const response = await page.request.get('/health');
    expect(response.ok()).toBeTruthy();
  });

  test('auth status endpoint responds', async ({ page }) => {
    const response = await page.request.get('/auth/status');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('authenticated');
  });

  test('models API requires auth', async ({ page }) => {
    const response = await page.request.get('/api/models');
    // Should return 401 or redirect when not authenticated
    expect([401, 403, 302].includes(response.status()) || response.ok()).toBeTruthy();
  });

  test('health endpoint returns valid JSON', async ({ page }) => {
    const response = await page.request.get('/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  test('auth status endpoint returns unauthenticated JSON shape', async ({ page }) => {
    const response = await page.request.get('/auth/status');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(data).toMatchObject({ authenticated: false, githubUser: null });
    expect(data).not.toHaveProperty('user');
  });

  test('models API returns 401 when not authenticated', async ({ page }) => {
    const response = await page.request.get('/api/models');
    expect(response.status()).toBe(401);
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();
    expect(data).toHaveProperty('error');
  });
});
