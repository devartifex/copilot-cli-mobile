import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  createAuthenticatedPage,
  mockWebSocket,
  goToChat,
  MOCK_SESSIONS,
} from './helpers';

interface TestSessionSummary {
  id: string;
  title?: string;
  model?: string;
  updatedAt?: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  checkpointCount?: number;
  hasPlan?: boolean;
  isRemote?: boolean;
  source?: 'sdk' | 'filesystem';
}

interface TestSessionDetail {
  id: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
  checkpoints: Array<{
    number: number;
    title: string;
    filename: string;
  }>;
  plan?: string;
  isRemote?: boolean;
}

interface SessionHarnessOptions {
  sessions?: TestSessionSummary[];
  detail?: TestSessionDetail;
}

const DEFAULT_SESSIONS: TestSessionSummary[] = MOCK_SESSIONS.map((session) => ({
  id: session.id,
  title: session.title,
  model: session.model,
  updatedAt: session.updatedAt,
  branch: session.branch,
  checkpointCount: session.checkpointCount,
}));

const DEFAULT_SESSION_DETAIL: TestSessionDetail = {
  id: 'session-1',
  repository: 'copilot-unleashed',
  branch: 'main',
  cwd: '/home/user/project',
  summary: 'Refactored TypeScript utilities, tightened session typing, and prepared follow-up cleanup.',
  createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  checkpoints: [
    { number: 1, title: 'Before refactor', filename: 'checkpoint-1.md' },
    { number: 2, title: 'Typed session cleanup', filename: 'checkpoint-2.md' },
  ],
  plan: '- Review typed changes\n- Resume implementation\n- Run verification',
};

const SEARCHABLE_SESSIONS: TestSessionSummary[] = [
  { id: 'search-1', title: 'Alpha planning', model: 'gpt-4.1', updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), branch: 'feat/alpha' },
  { id: 'search-2', title: 'Beta follow-up', model: 'gpt-4.1', updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), branch: 'feat/beta' },
  { id: 'search-3', title: 'Gamma docs', model: 'claude-sonnet-4-6', updatedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), branch: 'docs/gamma' },
  { id: 'search-4', title: 'Beta regression fix', model: 'o3', updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), branch: 'fix/beta-regression' },
  { id: 'search-5', title: 'Delta polish', model: 'claude-haiku-4-6', updatedAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(), branch: 'chore/delta' },
  { id: 'search-6', title: 'Epsilon deploy', model: 'gemini-2.5-pro', updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), branch: 'ops/epsilon' },
];

async function createSessionManagementPage(
  browser: Browser,
  options: SessionHarnessOptions = {},
) {
  const { page, context } = await createAuthenticatedPage(browser);
  const sentMessages: Array<Record<string, unknown>> = [];
  const detail = options.detail ?? DEFAULT_SESSION_DETAIL;
  let currentSessions = [...(options.sessions ?? DEFAULT_SESSIONS)];

  await mockWebSocket(page, {
    onMessage: (msg, ws) => {
      sentMessages.push(msg);

      if (msg.type === 'list_sessions') {
        ws.send(JSON.stringify({ type: 'sessions', sessions: currentSessions }));
      }

      if (msg.type === 'get_session_detail' && typeof msg.sessionId === 'string') {
        const responseDetail = msg.sessionId === detail.id
          ? detail
          : { ...detail, id: msg.sessionId };
        ws.send(JSON.stringify({
          type: 'session_detail',
          detail: responseDetail,
          session: responseDetail,
        }));
      }

      if (msg.type === 'resume_session' && typeof msg.sessionId === 'string') {
        ws.send(JSON.stringify({ type: 'session_resumed', sessionId: msg.sessionId }));
      }

      if (msg.type === 'delete_session' && typeof msg.sessionId === 'string') {
        currentSessions = currentSessions.filter((session) => session.id !== msg.sessionId);
        ws.send(JSON.stringify({ type: 'session_deleted', sessionId: msg.sessionId }));
      }
    },
  });

  await goToChat(page);

  return { page, context, sentMessages };
}

async function openSessionsSheet(page: Page) {
  await page.click('button.hamburger-btn');
  await expect(page.locator('.sidebar-overlay')).toBeVisible();
  await expect(page.locator('.sidebar-panel')).toBeVisible();

  await page.click('button.sidebar-action:has-text("Sessions")');
  await expect(page.locator('.sheet-overlay')).toBeVisible();
  await expect(page.locator('.sheet-panel')).toBeVisible();
}

test.describe('Session management', () => {
  test('opens sessions sheet via sidebar', async ({ browser }) => {
    const { page, context, sentMessages } = await createSessionManagementPage(browser);

    await openSessionsSheet(page);

    await expect(page.locator('.sheet-title')).toHaveText('Sessions');
    await expect(page.locator('.session-list')).toBeVisible();
    expect(sentMessages).toContainEqual(expect.objectContaining({ type: 'list_sessions' }));

    await context.close();
  });

  test('renders the session list', async ({ browser }) => {
    const { page, context } = await createSessionManagementPage(browser);

    await openSessionsSheet(page);

    await expect(page.locator('button.session-item')).toHaveCount(DEFAULT_SESSIONS.length);
    await expect(page.locator('.session-item-title')).toHaveText([
      'TypeScript refactoring',
      'Fix login bug',
      'Add unit tests',
    ]);
    await expect(page.locator('.session-item-meta').first()).toContainText('gpt-4.1');
    await expect(page.locator('.session-item-meta').nth(1)).toContainText('claude-sonnet-4-6');

    await context.close();
  });

  test('searches sessions when enough items are present', async ({ browser }) => {
    const { page, context } = await createSessionManagementPage(browser, {
      sessions: SEARCHABLE_SESSIONS,
    });

    await openSessionsSheet(page);

    await expect(page.locator('input.search-input')).toBeVisible();
    await page.fill('input.search-input', 'beta');

    await expect(page.locator('button.session-item')).toHaveCount(2);
    await expect(page.locator('.session-item-title')).toHaveText([
      'Beta follow-up',
      'Beta regression fix',
    ]);

    await context.close();
  });

  test('shows session detail', async ({ browser }) => {
    const { page, context, sentMessages } = await createSessionManagementPage(browser, {
      detail: DEFAULT_SESSION_DETAIL,
    });

    await openSessionsSheet(page);
    await page.click('button.session-item:has-text("TypeScript refactoring")');

    await expect(page.locator('.sheet-detail')).toBeVisible();
    await expect(page.locator('button.sheet-back')).toBeVisible();
    await expect(page.locator('.preview-summary')).toContainText('Refactored TypeScript utilities');
    await expect(page.locator('.checkpoint-title').first()).toContainText('Before refactor');
    expect(sentMessages).toContainEqual(
      expect.objectContaining({ type: 'get_session_detail', sessionId: 'session-1' }),
    );

    await context.close();
  });

  test('resumes a session from detail view', async ({ browser }) => {
    const { page, context, sentMessages } = await createSessionManagementPage(browser, {
      detail: DEFAULT_SESSION_DETAIL,
    });

    page.on('dialog', (dialog) => dialog.accept());

    await openSessionsSheet(page);
    await page.click('button.session-item:has-text("TypeScript refactoring")');
    await expect(page.locator('.sheet-detail')).toBeVisible();

    await page.click('button.resume-btn');

    await expect(page.locator('.sheet-overlay')).toHaveCount(0);
    expect(sentMessages).toContainEqual(
      expect.objectContaining({ type: 'resume_session', sessionId: 'session-1' }),
    );

    await context.close();
  });

  test('deletes a session', async ({ browser }) => {
    const { page, context, sentMessages } = await createSessionManagementPage(browser);

    page.on('dialog', (dialog) => dialog.accept());

    await openSessionsSheet(page);
    await expect(page.locator('button.session-item')).toHaveCount(DEFAULT_SESSIONS.length);

    const sessionToDelete = page.locator('button.session-item', { hasText: 'TypeScript refactoring' });
    await sessionToDelete.locator('.session-delete-btn').click();

    await expect(page.locator('button.session-item')).toHaveCount(DEFAULT_SESSIONS.length - 1);
    await expect(page.locator('button.session-item', { hasText: 'TypeScript refactoring' })).toHaveCount(0);
    expect(sentMessages).toContainEqual(
      expect.objectContaining({ type: 'delete_session', sessionId: 'session-1' }),
    );

    await context.close();
  });

  test('shows empty state when there are no sessions', async ({ browser }) => {
    const { page, context } = await createSessionManagementPage(browser, {
      sessions: [],
    });

    await openSessionsSheet(page);

    await expect(page.locator('.sheet-empty')).toBeVisible();
    await expect(page.locator('.sheet-empty')).toHaveText('No previous sessions found.');

    await context.close();
  });

  test('closes the sessions sheet', async ({ browser }) => {
    const { page, context } = await createSessionManagementPage(browser);

    await openSessionsSheet(page);
    await page.click('button.sheet-close');

    await expect(page.locator('.sheet-overlay')).toHaveCount(0);

    await context.close();
  });
});
