/**
 * Shared Playwright test helpers for authenticated E2E tests.
 *
 * Provides:
 * - createAuthenticatedPage() — patches SSR + __data.json + auth status
 * - mockWebSocket() — standard WS mock with configurable handlers
 * - MOCK_MODELS, MOCK_USER — shared test data
 */

import type { Browser, Page, BrowserContext } from '@playwright/test';

// ── Shared test data ──────────────────────────────────────────────────────────

export const MOCK_USER = { login: 'testuser', name: 'Test User' };

export const MOCK_MODELS = [
  { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: { supports: {} } },
  { id: 'o3', name: 'o3', vendor: 'OpenAI', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', vendor: 'Anthropic', capabilities: { supports: { reasoningEffort: true } } },
  { id: 'claude-haiku-4-6', name: 'Claude Haiku 4.6', vendor: 'Anthropic', capabilities: { supports: {} } },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'Google', capabilities: { supports: { reasoningEffort: true } } },
];

export const MOCK_TOOLS = [
  { name: 'read_file', enabled: true, description: 'Read file contents' },
  { name: 'write_file', enabled: true, description: 'Write file contents' },
  { name: 'run_terminal', enabled: false, description: 'Execute terminal commands' },
];

export const MOCK_AGENTS = [
  { slug: 'copilot', name: 'Copilot', description: 'Default assistant', current: true },
  { slug: 'reviewer', name: 'Code Reviewer', description: 'Reviews code changes', current: false },
];

export const MOCK_SESSIONS = [
  {
    id: 'session-1',
    title: 'TypeScript refactoring',
    model: 'gpt-4.1',
    mode: 'ask',
    branch: 'main',
    workspacePath: '/home/user/project',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
    messageCount: 12,
    checkpointCount: 3,
  },
  {
    id: 'session-2',
    title: 'Fix login bug',
    model: 'claude-sonnet-4-6',
    mode: 'agent',
    branch: 'fix/login',
    workspacePath: '/home/user/project',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 43200000).toISOString(),
    messageCount: 25,
    checkpointCount: 5,
  },
  {
    id: 'session-3',
    title: 'Add unit tests',
    model: 'o3',
    mode: 'plan',
    branch: 'feat/tests',
    workspacePath: '/home/user/project',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
    messageCount: 8,
    checkpointCount: 1,
  },
];

// ── Authenticated page helper ─────────────────────────────────────────────────

export interface AuthenticatedPage {
  page: Page;
  context: BrowserContext;
}

/**
 * Creates a page with mocked authentication.
 * Patches SSR HTML, __data.json, and /auth/status to simulate logged-in state.
 */
export async function createAuthenticatedPage(
  browser: Browser,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<AuthenticatedPage> {
  const context = await browser.newContext({
    viewport,
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:3001',
  });
  const page = await context.newPage();

  // Patch SSR HTML to set authenticated=true
  await page.route((url) => url.pathname === '/', async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    html = html.replace(
      /authenticated:false,user:null/g,
      `authenticated:true,user:{login:"${MOCK_USER.login}",name:"${MOCK_USER.name}"}`,
    );
    await route.fulfill({ response, body: html });
  });

  // Mock __data.json for client-side navigations
  await page.route('**/__data.json*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'data',
        nodes: [
          null,
          {
            type: 'data',
            data: [
              { authenticated: true, user: { login: MOCK_USER.login, name: MOCK_USER.name } },
              1,
            ],
          },
        ],
      }),
    }),
  );

  // Mock auth status
  await page.route('**/auth/status', (route) =>
    route.fulfill({
      json: { authenticated: true, githubUser: MOCK_USER.login },
    }),
  );

  return { page, context };
}

// ── WebSocket mock helpers ────────────────────────────────────────────────────

export interface WsMessageHandler {
  (msg: Record<string, unknown>, ws: { send: (data: string) => void }): void;
}

export interface MockWsOptions {
  /** Called when a WS message is received from the client */
  onMessage?: WsMessageHandler;
  /** Override the default model list */
  models?: typeof MOCK_MODELS;
  /** Default model for new sessions */
  defaultModel?: string;
  /** Whether to auto-respond to new_session */
  autoCreateSession?: boolean;
  /** Whether to auto-respond to list_models */
  autoListModels?: boolean;
}

/**
 * Sets up a WebSocket mock on the page.
 * By default: sends 'connected', auto-responds to list_models and new_session.
 */
export async function mockWebSocket(page: Page, options: MockWsOptions = {}) {
  const {
    onMessage,
    models = MOCK_MODELS,
    defaultModel = 'gpt-4.1',
    autoCreateSession = true,
    autoListModels = true,
  } = options;

  await page.context().routeWebSocket('**/ws**', (ws) => {
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'connected', user: MOCK_USER.login }));
    }, 10);

    ws.onMessage((data) => {
      const msg = JSON.parse(data as string);

      if (autoListModels && msg.type === 'list_models') {
        ws.send(JSON.stringify({ type: 'models', models }));
      }

      if (autoCreateSession && msg.type === 'new_session') {
        ws.send(JSON.stringify({ type: 'session_created', model: defaultModel }));
      }

      if (onMessage) {
        onMessage(msg, { send: (d: string) => ws.send(d) });
      }
    });
  });
}

/**
 * Navigates to the authenticated chat and waits for the terminal to be ready.
 */
export async function goToChat(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/', { waitUntil: 'networkidle' });

    if (await page.locator('.terminal').isVisible().catch(() => false)) {
      await page.waitForSelector('textarea:not([disabled])', { state: 'visible', timeout: 30000 });
      return;
    }

    await page.waitForTimeout(1000);
  }

  await page.waitForSelector('.terminal', { state: 'visible', timeout: 30000 });
  await page.waitForSelector('textarea:not([disabled])', { state: 'visible', timeout: 30000 });
}

/**
 * Sends a chat message by filling textarea and pressing Enter.
 */
export async function sendMessage(page: Page, text: string) {
  await page.fill('textarea', text);
  await page.keyboard.press('Enter');
}

/**
 * Creates a delayed message sender for simulating server response sequences.
 */
export function createMessageSequence(ws: { send: (data: string) => void }) {
  let delay = 0;
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  return {
    send(msg: Record<string, unknown>, additionalDelay = 50) {
      delay += additionalDelay;
      const t = setTimeout(() => ws.send(JSON.stringify(msg)), delay);
      timeouts.push(t);
      return this;
    },
    cleanup() {
      timeouts.forEach(clearTimeout);
    },
  };
}
