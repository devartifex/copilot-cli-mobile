import { test, expect, type Browser } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  sendMessage,
  MOCK_USER,
} from './helpers';

async function setupAuthenticatedChat(
  browser: Browser,
  options: Parameters<typeof mockWebSocket>[1] = {},
) {
  const session = await createAuthenticatedPage(browser);
  await mockWebSocket(session.page, options);

  try {
    await goToChat(session.page);
  } catch {
    await session.page.waitForSelector('.terminal', { state: 'visible', timeout: 10000 });
    await session.page.click('.newchat-btn');
    await session.page.waitForSelector('textarea:not([disabled])', {
      state: 'visible',
      timeout: 10000,
    });
  }

  return session;
}

test.describe('Error handling', () => {
  test('404 page renders for unknown routes', async ({ page }) => {
    const response = await page.goto('/nonexistent-route');

    expect(response).not.toBeNull();
    expect(response?.status()).toBe(404);

    const bodyText = (await page.textContent('body'))?.trim() ?? '';
    expect(bodyText.length).toBeGreaterThan(0);
    await expect(page.locator('.login-screen')).toHaveCount(0);
  });

  test('server error message displays in chat', async ({ browser }) => {
    const { page, context } = await setupAuthenticatedChat(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Something went wrong' }));
          }, 100);
        }
      },
    });

    try {
      await sendMessage(page, 'trigger an error');

      await expect(page.locator('.message.user').last()).toContainText(MOCK_USER.login);
      await expect(page.locator('.message.error')).toBeVisible();
      await expect(page.locator('.message.error')).toContainText('Something went wrong');
    } finally {
      await context.close();
    }
  });

  test('warning message displays in chat', async ({ browser }) => {
    const { page, context } = await setupAuthenticatedChat(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'warning', message: 'Rate limit approaching' }));
          }, 100);
        }
      },
    });

    try {
      await sendMessage(page, 'warn me');

      await expect(page.locator('.message.warning')).toBeVisible();
      await expect(page.locator('.message.warning')).toContainText('Rate limit approaching');
    } finally {
      await context.close();
    }
  });

  test('connection indicator shows connected', async ({ browser }) => {
    const { page, context } = await setupAuthenticatedChat(browser);

    try {
      await expect(page.locator('.conn-dot.dot-connected')).toBeVisible();
      await expect(page.locator('.conn-dot.dot-disconnected')).toHaveCount(0);
      await expect(page.locator('.conn-dot.dot-connecting')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('health endpoint returns OK', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('auth status shows unauthenticated', async ({ request }) => {
    const response = await request.get('/auth/status');
    const data = await response.json();

    expect(response.status()).toBe(200);
    expect(data).toEqual({ authenticated: false, githubUser: null });
  });

  test('API routes require auth', async ({ request }) => {
    const response = await request.get('/api/models');
    const bodyText = await response.text();

    expect(response.status()).not.toBe(200);
    expect(bodyText.trim().length).toBeGreaterThan(0);
  });

  test('multiple errors display', async ({ browser }) => {
    const { page, context } = await setupAuthenticatedChat(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'First error' }));
          }, 50);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Second error' }));
          }, 100);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Third error' }));
          }, 150);
        }
      },
    });

    try {
      await sendMessage(page, 'trigger multiple errors');

      const errors = page.locator('.message.error');
      await expect(errors).toHaveCount(3);
      await expect(errors.nth(0)).toContainText('First error');
      await expect(errors.nth(1)).toContainText('Second error');
      await expect(errors.nth(2)).toContainText('Third error');
    } finally {
      await context.close();
    }
  });

  test('error after streaming', async ({ browser }) => {
    const { page, context } = await setupAuthenticatedChat(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'turn_start' }));
          }, 50);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'delta', content: 'Partial response' }));
          }, 100);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'delta', content: ' before failure' }));
          }, 150);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Stream interrupted' }));
          }, 200);
        }
      },
    });

    try {
      await sendMessage(page, 'start streaming');

      await expect(page.locator('.message.error')).toBeVisible();
      await expect(page.locator('.message.error')).toContainText('Stream interrupted');
      await expect(page.locator('.message.assistant.streaming')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('page loads without unexpected JS errors', async ({ browser }) => {
    const { page, context } = await createAuthenticatedPage(browser);
    const errors: string[] = [];

    page.on('pageerror', (err) => errors.push(err.message));

    await mockWebSocket(page, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'turn_start' }));
          }, 50);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'delta', content: 'All good here' }));
          }, 100);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'turn_end' }));
          }, 150);
        }
      },
    });

    try {
      await goToChat(page);
      await expect(page.locator('.conn-dot.dot-connected')).toBeVisible();
      await sendMessage(page, 'sanity check');
      await expect(page.locator('.message.assistant')).toContainText('All good here');

      const unexpected = errors.filter(
        (e) =>
          !e.includes('WebSocket') &&
          !e.includes('fetch') &&
          !e.includes('Failed to fetch') &&
          !e.includes('NetworkError'),
      );
      expect(unexpected).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});
