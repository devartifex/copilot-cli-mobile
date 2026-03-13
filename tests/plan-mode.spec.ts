import { test, expect, type Browser } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  sendMessage,
  createMessageSequence,
} from './helpers';

const DEFAULT_PLAN =
  '## My Plan\n\n- [x] Step 1: Setup\n- [ ] Step 2: Implement\n- [ ] Step 3: Test';

type WsMessage = Record<string, unknown>;
type WsController = { send: (data: string) => void };

interface OpenPlanChatOptions {
  initialPlan?: string | null;
  onMessage?: (msg: WsMessage, ws: WsController) => void;
}

async function openPlanChat(browser: Browser, options: OpenPlanChatOptions = {}) {
  const { page, context } = await createAuthenticatedPage(browser);
  const sentMessages: WsMessage[] = [];
  let serverWs: WsController | null = null;

  await mockWebSocket(page, {
    autoCreateSession: false,
    onMessage: (msg, ws) => {
      serverWs = ws;
      sentMessages.push(msg);

      if (msg.type === 'new_session') {
        ws.send(JSON.stringify({ type: 'session_created', model: 'gpt-4.1' }));

        const planContent = options.initialPlan === undefined ? DEFAULT_PLAN : options.initialPlan;
        if (planContent !== null) {
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'plan', exists: true, content: planContent }));
          }, 100);
        }
      }

      options.onMessage?.(msg, ws);
    },
  });

  await goToChat(page);
  await expect.poll(() => serverWs !== null).toBe(true);

  return {
    page,
    context,
    sentMessages,
    sendServerMessage: (msg: WsMessage) => {
      if (!serverWs) {
        throw new Error('WebSocket not ready');
      }
      serverWs.send(JSON.stringify(msg));
    },
  };
}

test.describe('Plan mode', () => {
  test('plan panel appears when plan exists', async ({ browser }) => {
    const { page, context } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.plan-title')).toContainText('Plan');
      await expect(page.locator('.plan-content')).toContainText('Step 1: Setup');
      await expect(page.locator('.plan-content')).toContainText('Step 3: Test');
    } finally {
      await context.close();
    }
  });

  test('plan content renders markdown', async ({ browser }) => {
    const markdownPlan =
      '## Markdown Plan\n\nThis is **bold** and _italic_.\n\n- First item\n- Second item';
    const { page, context } = await openPlanChat(browser, { initialPlan: markdownPlan });

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.plan-content h2')).toHaveText('Markdown Plan');
      await expect(page.locator('.plan-content strong')).toHaveText('bold');
      await expect(page.locator('.plan-content em')).toHaveText('italic');
      await expect(page.locator('.plan-content ul li')).toHaveCount(2);
    } finally {
      await context.close();
    }
  });

  test('plan panel hidden when no plan exists', async ({ browser }) => {
    const { page, context } = await openPlanChat(browser, { initialPlan: null });

    try {
      await page.waitForTimeout(200);
      await expect(page.locator('.plan-panel')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('collapse and expand plan', async ({ browser }) => {
    const { page, context } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('button.plan-collapse-btn').click();
      await expect(page.locator('.plan-panel.collapsed')).toHaveCount(1);
      await expect(page.locator('.plan-body')).toBeHidden();

      await page.locator('button.plan-collapse-btn').click();
      await expect(page.locator('.plan-panel.collapsed')).toHaveCount(0);
      await expect(page.locator('.plan-body')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('edit plan', async ({ browser }) => {
    const updatedPlan = '## Updated Plan\n\n- [x] Step 1\n- [x] Step 2\n- [ ] Step 3';
    const { page, context, sentMessages } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('button.action-btn:has-text("Edit")').click();
      await expect(page.locator('textarea.plan-textarea')).toBeVisible();
      await expect(page.locator('textarea.plan-textarea')).toHaveValue(DEFAULT_PLAN);
      await expect(page.locator('.plan-edit-actions')).toBeVisible();

      await page.locator('textarea.plan-textarea').fill(updatedPlan);
      await page.locator('button.action-btn:has-text("Save")').click();

      await expect(page.locator('textarea.plan-textarea')).toHaveCount(0);
      await expect.poll(() => sentMessages.find((msg) => msg.type === 'update_plan') ?? null).not.toBeNull();
      expect(sentMessages.find((msg) => msg.type === 'update_plan')).toEqual({
        type: 'update_plan',
        content: updatedPlan,
      });
    } finally {
      await context.close();
    }
  });

  test('cancel edit', async ({ browser }) => {
    const { page, context } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('button.action-btn:has-text("Edit")').click();
      await expect(page.locator('textarea.plan-textarea')).toBeVisible();

      await page.locator('textarea.plan-textarea').fill('## Draft\n\n- [ ] Throw away changes');
      await page.locator('button.action-btn:has-text("Cancel")').click();

      await expect(page.locator('textarea.plan-textarea')).toHaveCount(0);
      await expect(page.locator('.plan-content')).toBeVisible();
      await expect(page.locator('.plan-content')).toContainText('Step 1: Setup');
    } finally {
      await context.close();
    }
  });

  test('delete plan uses two-step confirm', async ({ browser }) => {
    const { page, context, sentMessages } = await openPlanChat(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'delete_plan') {
          ws.send(JSON.stringify({ type: 'plan_deleted' }));
        }
      },
    });

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('button.action-btn.danger:has-text("Delete")').click();
      await expect(page.locator('button.action-btn.danger:has-text("Confirm")')).toBeVisible();
      await expect(page.locator('button.action-btn:has-text("Cancel")')).toBeVisible();

      await page.locator('button.action-btn.danger:has-text("Confirm")').click();

      await expect.poll(() => sentMessages.find((msg) => msg.type === 'delete_plan') ?? null).not.toBeNull();
      await expect(page.locator('.plan-panel')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('cancel delete', async ({ browser }) => {
    const { page, context, sentMessages } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });

      await page.locator('button.action-btn.danger:has-text("Delete")').click();
      await expect(page.locator('button.action-btn.danger:has-text("Confirm")')).toBeVisible();

      await page.locator('button.action-btn:has-text("Cancel")').click();

      await expect(page.locator('button.action-btn.danger:has-text("Delete")')).toBeVisible();
      await expect(page.locator('button.action-btn.danger:has-text("Confirm")')).toHaveCount(0);
      expect(sentMessages.some((msg) => msg.type === 'delete_plan')).toBe(false);
    } finally {
      await context.close();
    }
  });

  test('plan updates from server', async ({ browser }) => {
    const updatedPlan = '## Revised Plan\n\n- [x] Step 1: Setup\n- [x] Step 2: Implement\n- [ ] Step 3: Verify';
    const { page, context, sendServerMessage } = await openPlanChat(browser);

    try {
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.plan-content')).toContainText('Step 2: Implement');

      sendServerMessage({ type: 'plan_updated', content: updatedPlan });

      await expect(page.locator('.plan-content h2')).toHaveText('Revised Plan');
      await expect(page.locator('.plan-content')).toContainText('Step 3: Verify');
    } finally {
      await context.close();
    }
  });

  test('plan can appear during chat', async ({ browser }) => {
    const inTurnPlan = '## In-Flight Plan\n\n- [x] Understand request\n- [ ] Implement solution';
    const { page, context } = await openPlanChat(browser, {
      initialPlan: null,
      onMessage: (msg, ws) => {
        if (msg.type === 'message') {
          createMessageSequence(ws)
            .send({ type: 'turn_start' }, 50)
            .send({
              type: 'plan',
              exists: true,
              content: inTurnPlan,
            }, 75)
            .send({ type: 'delta', content: 'I have outlined the work and started implementing it.' }, 75)
            .send({ type: 'turn_end' }, 50)
            .send({ type: 'done' }, 50);
        }
      },
    });

    try {
      await sendMessage(page, 'Help me plan this feature');

      await expect(page.locator('.message.user')).toContainText('Help me plan this feature');
      await expect(page.locator('.plan-panel')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.plan-content h2')).toHaveText('In-Flight Plan');
      await expect(page.locator('.message.assistant')).toContainText('started implementing it');
    } finally {
      await context.close();
    }
  });
});
