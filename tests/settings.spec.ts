import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  MOCK_TOOLS,
  MOCK_AGENTS,
} from './helpers';

interface MockSettings {
  model: string;
  mode: 'interactive' | 'plan' | 'autopilot';
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
  customInstructions: string;
  excludedTools: string[];
  customTools: unknown[];
  mcpServers: Array<{
    name: string;
    url: string;
    type: 'http' | 'sse';
    headers: Record<string, string>;
    tools: string[];
    enabled: boolean;
  }>;
}

interface SetupOptions {
  settings?: Partial<MockSettings>;
  onMessage?: (msg: Record<string, unknown>, ws: { send: (data: string) => void }) => void;
}

interface SetupResult {
  page: Page;
  close: () => Promise<void>;
  clientMessages: Record<string, unknown>[];
  putPayloads: MockSettings[];
}

function createDefaultSettings(overrides: Partial<MockSettings> = {}): MockSettings {
  return {
    model: '',
    mode: 'interactive',
    reasoningEffort: 'medium',
    customInstructions: '',
    excludedTools: [],
    customTools: [],
    mcpServers: [],
    ...overrides,
  };
}

async function mockSettingsApi(page: Page, initial: Partial<MockSettings> = {}) {
  let current = createDefaultSettings(initial);
  const putPayloads: MockSettings[] = [];

  await page.route('**/api/settings', async (route, request) => {
    if (request.method() === 'GET') {
      await route.fulfill({
        json: { settings: current },
      });
      return;
    }

    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { settings?: MockSettings };

      if (body.settings) {
        current = body.settings;
        putPayloads.push(body.settings);
      }

      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.continue();
  });

  return { putPayloads };
}

async function setupSettingsPage(browser: Browser, options: SetupOptions = {}): Promise<SetupResult> {
  const { page, context } = await createAuthenticatedPage(browser);
  const clientMessages: Record<string, unknown>[] = [];
  const { putPayloads } = await mockSettingsApi(page, options.settings);

  await mockWebSocket(page, {
    onMessage: (msg, ws) => {
      clientMessages.push(msg);
      options.onMessage?.(msg, ws);
    },
  });

  await goToChat(page);

  return {
    page,
    clientMessages,
    putPayloads,
    close: () => context.close(),
  };
}

async function openSettings(page: Page) {
  await page.click('button.hamburger-btn');
  await expect(page.locator('.sidebar-panel')).toBeVisible();

  await page.click('button.sidebar-action:has-text("Settings")');

  await expect(page.locator('.settings-overlay')).toBeVisible();
  await expect(page.locator('.settings-panel')).toBeVisible();
}

function hasMessageType(messages: Record<string, unknown>[], type: string): boolean {
  return messages.some((msg) => msg.type === type);
}

test.describe('Settings', () => {
  test('opens settings via sidebar', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;

    try {
      await page.click('button.hamburger-btn');
      await expect(page.locator('.sidebar-panel')).toBeVisible();

      await page.click('button.sidebar-action:has-text("Settings")');

      await expect(page.locator('.settings-overlay')).toBeVisible();
      await expect(page.locator('.settings-panel')).toBeVisible();
      await expect(page.locator('.sidebar-panel')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('shows the settings title', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;

    try {
      await openSettings(page);
      await expect(page.locator('.settings-title')).toHaveText('Settings');
    } finally {
      await app.close();
    }
  });

  test('shows all accordion sections in order', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;
    const expectedSections = [
      'Custom Instructions',
      'Tools',
      'MCP Servers',
      'Agents',
      'Custom Tools',
      'Quota',
      'Compaction',
    ];

    try {
      await openSettings(page);

      const sections = page.locator('button.settings-accordion-btn');
      await expect(sections).toHaveCount(expectedSections.length);

      for (const [index, title] of expectedSections.entries()) {
        await expect(sections.nth(index)).toContainText(title);
      }
    } finally {
      await app.close();
    }
  });

  test('expands and collapses an accordion section', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;
    const instructionsButton = page.locator('button.settings-accordion-btn', { hasText: 'Custom Instructions' });

    try {
      await openSettings(page);
      await expect(page.locator('.settings-accordion-body')).toHaveCount(0);

      await instructionsButton.click();

      await expect(instructionsButton).toHaveClass(/open/);
      await expect(page.locator('.settings-accordion-body')).toHaveCount(1);
      await expect(page.locator('textarea.settings-textarea')).toBeVisible();

      await instructionsButton.click();

      await expect(instructionsButton).not.toHaveClass(/open/);
      await expect(page.locator('.settings-accordion-body')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('keeps only one accordion section open at a time', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;
    const instructionsButton = page.locator('button.settings-accordion-btn', { hasText: 'Custom Instructions' });
    const toolsButton = page.getByRole('button', { name: /^Tools\b/ });

    try {
      await openSettings(page);

      await instructionsButton.click();
      await expect(instructionsButton).toHaveClass(/open/);
      await expect(page.locator('textarea.settings-textarea')).toBeVisible();

      await toolsButton.click();

      await expect(toolsButton).toHaveClass(/open/);
      await expect(instructionsButton).not.toHaveClass(/open/);
      await expect(page.locator('textarea.settings-textarea')).toHaveCount(0);
      await expect(page.locator('.settings-accordion-body')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('saves custom instructions', async ({ browser }) => {
    const app = await setupSettingsPage(browser, {
      settings: { customInstructions: 'Keep answers concise.' },
    });
    const { page, putPayloads } = app;
    const instructionsText = 'Always explain code changes briefly and include validation steps.';

    try {
      await openSettings(page);
      await page.locator('button.settings-accordion-btn', { hasText: 'Custom Instructions' }).click();

      const textarea = page.locator('textarea.settings-textarea');
      await expect(textarea).toHaveValue('Keep answers concise.');

      await textarea.fill(instructionsText);
      await page.locator('.settings-accordion-body .action-btn.save').click();

      await expect.poll(() => putPayloads.length).toBe(1);
      expect(putPayloads[0]?.customInstructions).toBe(instructionsText);
      await expect(textarea).toHaveValue(instructionsText);
    } finally {
      await app.close();
    }
  });

  test('loads and renders tool toggles', async ({ browser }) => {
    const app = await setupSettingsPage(browser, {
      settings: { excludedTools: ['run_terminal'] },
      onMessage: (msg, ws) => {
        if (msg.type === 'list_tools') {
          ws.send(JSON.stringify({ type: 'tools', tools: MOCK_TOOLS }));
        }
      },
    });
    const { page, clientMessages } = app;

    try {
      await openSettings(page);
      await page.getByRole('button', { name: /^Tools\b/ }).click();

      await expect.poll(() => hasMessageType(clientMessages, 'list_tools')).toBe(true);
      await expect(page.locator('input.tool-toggle-check')).toHaveCount(MOCK_TOOLS.length);
      await expect(page.locator('.tool-toggle-name')).toHaveText(MOCK_TOOLS.map((tool) => tool.name));
      await expect(page.locator('input.tool-toggle-check').nth(0)).toBeChecked();
      await expect(page.locator('input.tool-toggle-check').nth(1)).toBeChecked();
      await expect(page.locator('input.tool-toggle-check').nth(2)).not.toBeChecked();
    } finally {
      await app.close();
    }
  });

  test('loads and renders agents with the active indicator', async ({ browser }) => {
    const currentAgent = MOCK_AGENTS[0].name;
    const app = await setupSettingsPage(browser, {
      onMessage: (msg, ws) => {
        if (msg.type === 'list_agents') {
          ws.send(JSON.stringify({ type: 'agents', agents: MOCK_AGENTS, current: currentAgent }));
        }
      },
    });
    const { page, clientMessages } = app;

    try {
      await openSettings(page);
      await page.locator('button.settings-accordion-btn', { hasText: 'Agents' }).click();

      await expect.poll(() => hasMessageType(clientMessages, 'list_agents')).toBe(true);
      await expect(page.locator('.agent-item')).toHaveCount(MOCK_AGENTS.length);
      await expect(page.locator('.agent-name')).toHaveText(MOCK_AGENTS.map((agent) => agent.name));
      await expect(page.locator('.agent-item.active')).toHaveCount(1);
      await expect(page.locator('.agent-item.active .agent-name')).toHaveText(currentAgent);
      await expect(page.locator('.agent-item.active .agent-current')).toHaveText('active');
    } finally {
      await app.close();
    }
  });

  test('closes settings from the close button', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;

    try {
      await openSettings(page);
      await page.click('button.settings-close');
      await expect(page.locator('.settings-overlay')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('closes settings when the overlay is clicked', async ({ browser }) => {
    const app = await setupSettingsPage(browser);
    const { page } = app;

    try {
      await openSettings(page);

      await page.locator('.settings-overlay').evaluate((overlay) => {
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await expect(page.locator('.settings-overlay')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});
