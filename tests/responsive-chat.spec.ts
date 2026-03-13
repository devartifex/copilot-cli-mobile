import { test, expect, type Browser } from '@playwright/test';
import {
  createAuthenticatedPage, mockWebSocket, goToChat, sendMessage,
  createMessageSequence,
} from './helpers';

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const TABLET_VIEWPORT = { width: 768, height: 1024 } as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

const VIEWPORT_CASES = [
  { label: 'mobile', viewport: MOBILE_VIEWPORT },
  { label: 'tablet', viewport: TABLET_VIEWPORT },
  { label: 'desktop', viewport: DESKTOP_VIEWPORT },
] as const;

type Viewport = { width: number; height: number };
type AuthenticatedChat = Awaited<ReturnType<typeof createAuthenticatedPage>>;
type MockWsOptions = Parameters<typeof mockWebSocket>[1];

async function openAuthenticatedChat(
  browser: Browser,
  viewport: Viewport,
  wsOptions?: MockWsOptions,
): Promise<AuthenticatedChat> {
  const session = await createAuthenticatedPage(browser, viewport);
  await mockWebSocket(session.page, wsOptions);
  await goToChat(session.page);
  return session;
}

async function expectCoreChatUI(page: AuthenticatedChat['page']) {
  await expect(page.locator('.top-bar')).toBeVisible();
  await expect(page.locator('.terminal')).toBeVisible();
  await expect(page.locator('.input-area textarea')).toBeVisible();
  await expect(page.locator('button.send-btn')).toBeVisible();
}

test.describe('Responsive — authenticated chat', () => {
  test('Chat renders at mobile viewport', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      await expectCoreChatUI(page);
    } finally {
      await context.close();
    }
  });

  test('Chat renders at tablet viewport', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, TABLET_VIEWPORT);

    try {
      await expectCoreChatUI(page);
    } finally {
      await context.close();
    }
  });

  test('Chat renders at desktop viewport', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, DESKTOP_VIEWPORT);

    try {
      await expectCoreChatUI(page);
    } finally {
      await context.close();
    }
  });

  test('No horizontal overflow at mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      const bodyWidth = await page.locator('body').evaluate((el) => el.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
    } finally {
      await context.close();
    }
  });

  test('Sidebar opens on mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      await page.locator('button.hamburger-btn').click();

      await expect(page.locator('.sidebar-overlay')).toBeVisible();
      await expect(page.locator('.sidebar-panel')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('Sidebar closes on mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      await page.locator('button.hamburger-btn').click();
      await expect(page.locator('.sidebar-panel')).toBeVisible();

      await page.locator('.sidebar-overlay').click({
        position: {
          x: MOBILE_VIEWPORT.width - 20,
          y: 100,
        },
      });

      await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
      await expect(page.locator('.sidebar-panel')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('Can send message on mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT, {
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          createMessageSequence(ws)
            .send({ type: 'turn_start' }, 100)
            .send({ type: 'delta', content: 'Mobile response!' }, 100)
            .send({ type: 'turn_end' }, 100)
            .send({ type: 'done' }, 100);
        }
      },
    });

    try {
      await sendMessage(page, 'Hello from mobile');

      await expect(page.locator('.message.user')).toContainText('Hello from mobile');
      await expect(page.locator('.message.assistant .content')).toContainText('Mobile response!');
    } finally {
      await context.close();
    }
  });

  test('TopBar elements visible on all viewports', async ({ browser }) => {
    for (const { label, viewport } of VIEWPORT_CASES) {
      const { page, context } = await openAuthenticatedChat(browser, viewport);

      try {
        await test.step(`checks top bar controls at ${label}`, async () => {
          await expect(page.locator('button.hamburger-btn')).toBeVisible();
          await expect(page.locator('button.model-pill')).toBeVisible();
          await expect(page.locator('button.newchat-btn')).toBeVisible();
        });
      } finally {
        await context.close();
      }
    }
  });

  test('Mode selector accessible on mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      const modeSelector = page.locator('.mode-selector');
      const modeButtons = page.locator('button.mode-btn');

      await expect(modeSelector).toBeVisible();
      await expect(modeButtons).toHaveCount(3);
      await expect(modeButtons.nth(0)).toBeVisible();
      await expect(modeButtons.nth(1)).toBeVisible();
      await expect(modeButtons.nth(2)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('Input area stays at bottom on mobile', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser, MOBILE_VIEWPORT);

    try {
      const viewportHeight = page.viewportSize()?.height ?? MOBILE_VIEWPORT.height;
      const inputAreaBox = await page.locator('.input-area').boundingBox();

      expect(inputAreaBox).not.toBeNull();

      const bottomGap = viewportHeight - ((inputAreaBox?.y ?? 0) + (inputAreaBox?.height ?? 0));
      expect(inputAreaBox?.y ?? 0).toBeGreaterThan(viewportHeight * 0.65);
      expect(bottomGap).toBeLessThanOrEqual(24);
    } finally {
      await context.close();
    }
  });
});
