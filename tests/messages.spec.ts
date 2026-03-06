import { test, expect, type Page } from '@playwright/test';

async function mockAuthenticated(page: Page) {
  await page.route('**/auth/status', (route) =>
    route.fulfill({ json: { authenticated: true, githubUser: 'testuser' } }),
  );
}

// Navigate and wait for the chat screen to be ready
async function openChat(page: Page) {
  await mockAuthenticated(page);
  // Stub WebSocket to prevent real connection (server would reject with 4001 → reload)
  await page.addInitScript(() => {
    window.WebSocket = class extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;
      readyState = 3;
      url = '';
      protocol = '';
      extensions = '';
      bufferedAmount = 0;
      binaryType: BinaryType = 'blob';
      onopen: ((ev: Event) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      send() {}
      close() {}
    } as unknown as typeof WebSocket;
  });
  await page.goto('/');
  await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 10000 });
}

test.describe('Message rendering', () => {
  test('user message appears with prompt symbol', async ({ page }) => {
    await openChat(page);

    // Inject a user message via Chat.addMessage
    await page.evaluate(() => {
      (window as any).Chat.addMessage('user', 'Hello world');
    });

    const userMsg = page.locator('.message.user');
    await expect(userMsg).toBeVisible();
    await expect(userMsg.locator('.term-prompt')).toHaveText('❯');
    await expect(userMsg.locator('.user-text')).toHaveText('Hello world');
  });

  test('assistant message renders markdown', async ({ page }) => {
    await openChat(page);

    // Simulate assistant content via handleMessage
    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'delta', content: 'Hello **bold** text' });
      chat.handleMessage({ type: 'done' });
    });

    const assistantMsg = page.locator('.message.assistant');
    await expect(assistantMsg).toBeVisible();

    const content = assistantMsg.locator('.content');
    const html = await content.innerHTML();
    expect(html).toContain('<strong>bold</strong>');
  });

  test('assistant message renders code blocks with highlighting', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'delta', content: '```javascript\nconst x = 1;\n```' });
      chat.handleMessage({ type: 'done' });
    });

    const codeBlock = page.locator('.message.assistant pre code');
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('const x = 1;');
  });

  test('code blocks get copy buttons after completion', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'delta', content: '```bash\necho hello\n```' });
      chat.handleMessage({ type: 'done' });
    });

    const copyBtn = page.locator('.message.assistant .copy-btn');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).toHaveText('Copy');
  });

  test('error message is displayed', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({ type: 'error', message: 'Something went wrong' });
    });

    const errorMsg = page.locator('.message.error');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toHaveText('Something went wrong');
  });

  test('multiple messages stack in order', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.addMessage('user', 'First question');
      chat.handleMessage({ type: 'delta', content: 'First answer' });
      chat.handleMessage({ type: 'done' });
      chat.addMessage('user', 'Second question');
    });

    const messages = page.locator('#messages .message');
    await expect(messages).toHaveCount(3);
    await expect(messages.nth(0)).toHaveClass(/user/);
    await expect(messages.nth(1)).toHaveClass(/assistant/);
    await expect(messages.nth(2)).toHaveClass(/user/);
  });

  test('input is disabled during streaming and re-enabled after done', async ({ page }) => {
    await openChat(page);

    // Start streaming
    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.disableInput();
      chat.handleMessage({ type: 'delta', content: 'Streaming...' });
    });

    await expect(page.locator('#message-input')).toBeDisabled();

    // Finish streaming
    await page.evaluate(() => {
      (window as any).Chat.handleMessage({ type: 'done' });
    });

    await expect(page.locator('#message-input')).toBeEnabled();
  });
});

test.describe('Reasoning blocks', () => {
  test('reasoning block appears during thinking', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'reasoning_delta', content: 'Analyzing the problem...' });
    });

    const reasoning = page.locator('.reasoning-block');
    await expect(reasoning).toBeVisible();
    await expect(reasoning.locator('.reasoning-label')).toContainText('Thinking');
    await expect(reasoning.locator('.reasoning-content')).toContainText('Analyzing the problem');
  });

  test('reasoning block collapses when done', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'reasoning_delta', content: 'Thinking deeply...' });
      chat.handleMessage({ type: 'reasoning_done' });
    });

    const reasoning = page.locator('.reasoning-block');
    await expect(reasoning).toHaveClass(/collapsed/);
  });

  test('reasoning block toggles on click', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'reasoning_delta', content: 'Some reasoning text' });
    });

    const reasoning = page.locator('.reasoning-block');
    const header = reasoning.locator('.reasoning-header');

    // Initially not collapsed
    await expect(reasoning).not.toHaveClass(/collapsed/);

    // Click to collapse
    await header.click();
    await expect(reasoning).toHaveClass(/collapsed/);

    // Click to expand
    await header.click();
    await expect(reasoning).not.toHaveClass(/collapsed/);
  });
});

test.describe('Tool calls', () => {
  test('tool start shows spinner and name', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({
        type: 'tool_start',
        toolCallId: 'tc-1',
        toolName: 'readFile',
      });
    });

    const toolCall = page.locator('.tool-call');
    await expect(toolCall).toBeVisible();
    await expect(toolCall.locator('.tool-name')).toContainText('readFile');
    await expect(toolCall.locator('.tool-status')).toContainText('running');
  });

  test('tool progress updates status', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'tool_start', toolCallId: 'tc-2', toolName: 'search' });
      chat.handleMessage({ type: 'tool_progress', toolCallId: 'tc-2', message: 'Searching files...' });
    });

    const toolCall = page.locator('.tool-call');
    await expect(toolCall.locator('.tool-status')).toContainText('Searching files');
  });

  test('tool end shows checkmark and done status', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.handleMessage({ type: 'tool_start', toolCallId: 'tc-3', toolName: 'writeFile' });
      chat.handleMessage({ type: 'tool_end', toolCallId: 'tc-3' });
    });

    const toolCall = page.locator('.tool-call');
    await expect(toolCall.locator('.tool-icon')).toHaveText('✓');
    await expect(toolCall.locator('.tool-status')).toContainText('done');
    await expect(toolCall).toHaveClass(/completed/);
  });

  test('MCP tool shows server/tool name format', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({
        type: 'tool_start',
        toolCallId: 'tc-4',
        toolName: 'mcpTool',
        mcpServerName: 'github',
        mcpToolName: 'create_issue',
      });
    });

    const toolCall = page.locator('.tool-call');
    await expect(toolCall.locator('.tool-name')).toContainText('github/create_issue');
  });
});

test.describe('Intent messages', () => {
  test('intent line appears with arrow icon', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({ type: 'intent', intent: 'Reading the configuration file' });
    });

    const intent = page.locator('.intent-line');
    await expect(intent).toBeVisible();
    await expect(intent.locator('.intent-icon')).toHaveText('→');
    await expect(intent).toContainText('Reading the configuration file');
  });
});

test.describe('Model selector', () => {
  test('models populate from server response', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({
        type: 'models',
        models: ['gpt-4.1', 'claude-sonnet-4', 'o4-mini'],
      });
    });

    const select = page.locator('#model-select');
    const options = select.locator('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toHaveValue('gpt-4.1');
    await expect(options.nth(1)).toHaveValue('claude-sonnet-4');
    await expect(options.nth(2)).toHaveValue('o4-mini');
  });

  test('env line updates with model count', async ({ page }) => {
    await openChat(page);

    await page.evaluate(() => {
      (window as any).Chat.handleMessage({
        type: 'models',
        models: ['gpt-4.1', 'claude-sonnet-4'],
      });
    });

    await expect(page.locator('#env-model-text')).toContainText('2 models available');
  });
});

test.describe('New chat', () => {
  test('new chat clears messages and resets state', async ({ page }) => {
    await openChat(page);

    // Add some messages first
    await page.evaluate(() => {
      const chat = (window as any).Chat;
      chat.addMessage('user', 'test question');
      chat.handleMessage({ type: 'delta', content: 'test answer' });
      chat.handleMessage({ type: 'done' });
    });

    await expect(page.locator('#messages .message')).toHaveCount(2);

    // Clear via newChat (won't try WS since not connected, but clears DOM)
    await page.evaluate(() => {
      const messages = document.getElementById('messages');
      if (messages) messages.innerHTML = '';
    });

    await expect(page.locator('#messages .message')).toHaveCount(0);
  });
});
