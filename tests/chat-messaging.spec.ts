import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  sendMessage,
  createMessageSequence,
  MOCK_USER,
  MOCK_MODELS,
  type MockWsOptions,
} from './helpers';

async function withAuthenticatedChat(
  browser: Browser,
  options: MockWsOptions,
  run: (page: Page) => Promise<void>,
) {
  const { page, context } = await createAuthenticatedPage(browser);

  await mockWebSocket(page, {
    defaultModel: MOCK_MODELS[0].id,
    ...options,
  });

  await goToChat(page);

  try {
    await run(page);
  } finally {
    await context.close();
  }
}

test.describe('Chat messaging', () => {
  test('shows the banner before the first message', async ({ browser }) => {
    await withAuthenticatedChat(browser, {}, async (page) => {
      await expect(page.locator('.banner-box')).toBeVisible();
      await expect(page.locator('button.send-btn')).toBeVisible();
    });
  });

  test('sends a message and receives a response', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'delta', content: 'Hello!' }, 120)
              .send({ type: 'turn_end' }, 120)
              .send({ type: 'done' }, 50);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Hi there');

        await expect(page.locator('.message.user .user-marker')).toContainText(MOCK_USER.login);
        await expect(page.locator('.message.user .user-text')).toContainText('Hi there');
        await expect(page.locator('.message.assistant .content')).toContainText('Hello!');
      },
    );
  });

  test('shows streaming state while assistant text is arriving', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'delta', content: 'Hello' }, 150)
              .send({ type: 'delta', content: ' there' }, 180)
              .send({ type: 'turn_end' }, 350)
              .send({ type: 'done' }, 50);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Stream a response');

        const streamingMessage = page.locator('.message.assistant.streaming');
        await expect(streamingMessage).toBeVisible();
        await expect(streamingMessage.locator('.content')).toContainText('Hello');
        await expect(page.locator('button.stop-btn')).toBeVisible();

        await expect(streamingMessage).toHaveCount(0);
        await expect(page.locator('.message.assistant .content')).toContainText('Hello there');
      },
    );
  });

  test('renders tool call progress and completion', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'tool_start', toolCallId: 'tool-1', toolName: 'read_file', mcpServerName: 'filesystem' }, 80)
              .send({ type: 'tool_progress', toolCallId: 'tool-1', message: 'Reading src/lib/app.ts…' }, 120)
              .send({ type: 'tool_end', toolCallId: 'tool-1' }, 160)
              .send({ type: 'delta', content: 'Finished reading the file.' }, 120)
              .send({ type: 'turn_end' }, 80)
              .send({ type: 'done' }, 50);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Inspect the app file');

        await expect(page.locator('.tool-call-wrapper')).toBeVisible();
        await expect(page.locator('.tool-call-wrapper .tool-name')).toContainText('read_file');
        await expect(page.locator('.tool-call-wrapper .tool-status')).toContainText('Reading src/lib/app.ts…');

        await page.locator('.tool-call.expandable').click();
        await expect(page.locator('.tool-progress-item')).toContainText('Reading src/lib/app.ts…');
        await expect(page.locator('.tool-call-wrapper .tool-status')).toContainText('done');
        await expect(page.locator('.message.assistant .content')).toContainText('Finished reading the file.');
      },
    );
  });

  test('shows the reasoning block before the final answer', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'reasoning_delta', content: 'Thinking through the request. ', reasoningId: 'reasoning-1' }, 100)
              .send({ type: 'reasoning_delta', content: 'Checking the best approach.', reasoningId: 'reasoning-1' }, 160)
              .send({ type: 'delta', content: 'Here is the final answer.' }, 260)
              .send({ type: 'turn_end' }, 320)
              .send({ type: 'done' }, 50);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Explain your approach');

        await expect(page.locator('.reasoning-block')).toBeVisible();
        await expect(page.locator('.reasoning-block .reasoning-content')).toContainText(
          'Thinking through the request. Checking the best approach.',
        );
        await expect(page.locator('.message.assistant .content')).toContainText('Here is the final answer.');
      },
    );
  });

  test('renders usage information after a completed turn', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'delta', content: 'Usage details coming up.' }, 100)
              .send({ type: 'turn_end' }, 120)
              .send({ type: 'done' }, 50)
              .send({ type: 'usage', inputTokens: 12, outputTokens: 8 }, 50);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Show usage');

        await expect(page.locator('.usage-line')).toBeVisible();
        await expect(page.locator('.usage-line')).toContainText('in: 12');
        await expect(page.locator('.usage-line')).toContainText('out: 8');
      },
    );
  });

  test('shows the stop button during streaming and sends abort when clicked', async ({ browser }) => {
    const outboundMessages: Array<Record<string, unknown>> = [];

    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          outboundMessages.push(msg);

          if (msg.type === 'message') {
            const seq = createMessageSequence(ws);
            seq
              .send({ type: 'turn_start' }, 20)
              .send({ type: 'delta', content: 'Still working…' }, 150);
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Start streaming');

        await expect(page.locator('.message.assistant.streaming')).toBeVisible();
        await expect(page.locator('button.stop-btn')).toBeVisible();

        await page.locator('button.stop-btn').click();

        await expect.poll(() => outboundMessages.filter((msg) => msg.type === 'abort').length).toBe(1);
      },
    );
  });

  test('renders websocket error messages', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            ws.send(JSON.stringify({ type: 'error', message: 'Something went wrong.' }));
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Trigger an error');

        await expect(page.locator('.message.error')).toBeVisible();
        await expect(page.locator('.message.error')).toContainText('Something went wrong.');
      },
    );
  });

  test('renders websocket warning messages', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'message') {
            ws.send(JSON.stringify({ type: 'warning', message: 'Model context is almost full.' }));
          }
        },
      },
      async (page) => {
        await sendMessage(page, 'Trigger a warning');

        await expect(page.locator('.message.warning')).toBeVisible();
        await expect(page.locator('.message.warning')).toContainText('Model context is almost full.');
      },
    );
  });

  test('updates the top bar title when the session title changes', async ({ browser }) => {
    await withAuthenticatedChat(
      browser,
      {
        onMessage: (msg, ws) => {
          if (msg.type === 'new_session') {
            ws.send(JSON.stringify({ type: 'title_changed', title: 'Refactor websocket handling' }));
          }
        },
      },
      async (page) => {
        await expect(page.locator('.title-text')).toBeVisible();
        await expect(page.locator('.title-text')).toContainText('Refactor websocket handling');
      },
    );
  });
});
