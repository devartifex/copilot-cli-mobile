import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  MOCK_MODELS,
} from './helpers';

type WsMessage = Record<string, unknown>;

interface ChatHarness {
  page: Page;
  context: BrowserContext;
  sentMessages: WsMessage[];
}

interface OpenChatOptions {
  defaultModel?: string;
  onMessage?: (msg: WsMessage, ws: { send: (data: string) => void }) => void;
}

async function openAuthenticatedChat(browser: Browser, options: OpenChatOptions = {}): Promise<ChatHarness> {
  const { page, context } = await createAuthenticatedPage(browser);
  const sentMessages: WsMessage[] = [];

  await mockWebSocket(page, {
    defaultModel: options.defaultModel ?? 'gpt-4.1',
    onMessage(msg, ws) {
      sentMessages.push(msg);
      options.onMessage?.(msg, ws);
    },
  });

  await goToChat(page);
  await expect(page.locator('button.model-pill')).toBeVisible();

  return { page, context, sentMessages };
}

async function openModelSheet(page: Page): Promise<void> {
  await page.click('button.model-pill');
  await expect(page.locator('.sheet-overlay')).toBeVisible();
  await expect(page.locator('.sheet-panel')).toBeVisible();
  await expect(page.locator('.model-list')).toBeVisible();
}

async function expectSentMessage(
  sentMessages: WsMessage[],
  predicate: (msg: WsMessage) => boolean,
): Promise<void> {
  await expect.poll(() => sentMessages.some(predicate)).toBe(true);
}

test.describe('Model selection', () => {
  test('model pill shows current model', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser);

    try {
      await expect(page.locator('.conn-dot')).toHaveClass(/dot-connected/);
      await expect(page.locator('.model-name')).toHaveText('gpt-4.1');
    } finally {
      await context.close();
    }
  });

  test('opens model sheet', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser);

    try {
      await page.click('button.model-pill');

      await expect(page.locator('.sheet-overlay')).toBeVisible();
      await expect(page.locator('.sheet-panel')).toBeVisible();
      await expect(page.locator('.sheet-title')).toHaveText('Models');
      await expect(page.locator('button.sheet-close')).toBeVisible();
      await expect(page.locator('.model-list')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('model list displays all models', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser);

    try {
      await openModelSheet(page);

      const items = page.locator('button.model-item');
      await expect(items).toHaveCount(MOCK_MODELS.length);

      for (const model of MOCK_MODELS) {
        await expect(page.locator('button.model-item').filter({ hasText: model.id })).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });

  test('switches model', async ({ browser }) => {
    const { page, context, sentMessages } = await openAuthenticatedChat(browser, {
      onMessage(msg, ws) {
        if (msg.type === 'set_model' && msg.model === 'o3') {
          ws.send(JSON.stringify({ type: 'model_changed', model: 'o3' }));
        }
      },
    });

    try {
      await openModelSheet(page);
      await page.locator('button.model-item').filter({ hasText: 'o3' }).click();

      await expectSentMessage(
        sentMessages,
        (msg) => msg.type === 'set_model' && msg.model === 'o3',
      );
      await expect(page.locator('.model-name')).toHaveText('o3');
    } finally {
      await context.close();
    }
  });

  test('selected model is highlighted', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser);

    try {
      await openModelSheet(page);

      const selectedModel = page.locator('button.model-item.selected');
      await expect(selectedModel).toHaveCount(1);
      await expect(selectedModel).toContainText('gpt-4.1');
    } finally {
      await context.close();
    }
  });

  test('closes model sheet', async ({ browser }) => {
    const { page, context } = await openAuthenticatedChat(browser);

    try {
      await openModelSheet(page);
      await page.click('button.sheet-close');
      await expect(page.locator('.sheet-overlay')).not.toBeVisible();

      await openModelSheet(page);
      await page.locator('.sheet-overlay').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.sheet-overlay')).not.toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('reasoning effort toggle works for reasoning models', async ({ browser }) => {
    const { page, context, sentMessages } = await openAuthenticatedChat(browser, {
      onMessage(msg, ws) {
        if (msg.type === 'set_model' && msg.model === 'o3') {
          ws.send(JSON.stringify({ type: 'model_changed', model: 'o3' }));
        }

        if (msg.type === 'new_session' && msg.model === 'o3' && msg.reasoningEffort === 'high') {
          ws.send(JSON.stringify({ type: 'session_created', model: 'o3' }));
        }
      },
    });

    try {
      await openModelSheet(page);
      await page.locator('button.model-item').filter({ hasText: 'o3' }).click();
      await expect(page.locator('.model-name')).toHaveText('o3');

      const reasoningSection = page.locator('.reasoning-section');
      const mediumButton = page.locator('button.reasoning-opt').filter({ hasText: 'Med' });
      const highButton = page.locator('button.reasoning-opt').filter({ hasText: 'High' });

      await expect(reasoningSection).not.toHaveClass(/disabled/);
      await expect(page.locator('button.model-item.selected')).toContainText('o3');
      await expect(page.locator('button.model-item.selected .model-item-badge')).toHaveText('reasoning');
      await expect(mediumButton).toHaveClass(/active/);

      await highButton.click();

      await expectSentMessage(
        sentMessages,
        (msg) =>
          (msg.type === 'new_session' && msg.model === 'o3' && msg.reasoningEffort === 'high') ||
          (msg.type === 'set_reasoning' && msg.effort === 'high') ||
          (msg.type === 'set_reasoning_effort' && msg.effort === 'high'),
      );
      await expect(highButton).toHaveClass(/active/);
      await expect(mediumButton).not.toHaveClass(/active/);
    } finally {
      await context.close();
    }
  });

  test('switches mode', async ({ browser }) => {
    const { page, context, sentMessages } = await openAuthenticatedChat(browser, {
      onMessage(msg, ws) {
        if (msg.type === 'set_mode') {
          ws.send(JSON.stringify({ type: 'mode_changed', mode: msg.mode }));
        }
      },
    });

    try {
      const askButton = page.locator('button.mode-btn').filter({ hasText: 'Ask' });
      const planButton = page.locator('button.mode-btn').filter({ hasText: 'Plan' });
      const agentButton = page.locator('button.mode-btn').filter({ hasText: 'Agent' });

      await expect(askButton).toHaveClass(/active/);

      await planButton.click();
      await expectSentMessage(
        sentMessages,
        (msg) => msg.type === 'set_mode' && msg.mode === 'plan',
      );
      await expect(planButton).toHaveClass(/active/);
      await expect(askButton).not.toHaveClass(/active/);

      await agentButton.click();
      await expectSentMessage(
        sentMessages,
        (msg) => msg.type === 'set_mode' && msg.mode === 'autopilot',
      );
      await expect(agentButton).toHaveClass(/active/);
      await expect(planButton).not.toHaveClass(/active/);

      await askButton.click();
      await expectSentMessage(
        sentMessages,
        (msg) => msg.type === 'set_mode' && msg.mode === 'interactive',
      );
      await expect(askButton).toHaveClass(/active/);
      await expect(agentButton).not.toHaveClass(/active/);
    } finally {
      await context.close();
    }
  });
});
