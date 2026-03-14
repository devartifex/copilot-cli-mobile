import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatStore } from '$lib/stores/chat.svelte.js';
import type { WsStore } from '$lib/stores/ws.svelte.js';
import type {
  AgentInfo,
  ModelInfo,
  QuotaSnapshots,
  ServerMessage,
  SessionDetail,
  SessionSummary,
  SessionUsageTotals,
  ToolInfo,
} from '$lib/types/index.js';

const { notifyMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
}));

vi.mock('$lib/utils/notifications.js', () => ({
  notify: notifyMock,
}));

function createWsStoreMock(options: {
  connectionState?: WsStore['connectionState'];
  sessionReady?: boolean;
} = {}): WsStore {
  const { connectionState = 'connected', sessionReady = true } = options;

  return {
    get connectionState() { return connectionState; },
    get sessionReady() { return sessionReady; },
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    sendMessage: vi.fn(),
    newSession: vi.fn(),
    resumeSession: vi.fn(),
    setMode: vi.fn(),
    setModel: vi.fn(),
    setReasoning: vi.fn(),
    abort: vi.fn(),
    compact: vi.fn(),
    listModels: vi.fn(),
    listTools: vi.fn(),
    listAgents: vi.fn(),
    listSessions: vi.fn(),
    selectAgent: vi.fn(),
    deselectAgent: vi.fn(),
    deleteSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getQuota: vi.fn(),
    getPlan: vi.fn(),
    updatePlan: vi.fn(),
    deletePlan: vi.fn(),
    respondToUserInput: vi.fn(),
    respondToPermission: vi.fn(),
  };
}

function dispatch(store: ReturnType<typeof createChatStore>, ...messages: ServerMessage[]): void {
  for (const message of messages) {
    store.handleServerMessage(message);
  }
}

describe('createChatStore', () => {
  beforeEach(() => {
    notifyMock.mockReset();
  });

  it('exposes initial ws-derived flags and clears message-related state', () => {
    const store = createChatStore(createWsStoreMock());

    expect(store.messages).toEqual([]);
    expect(store.isConnected).toBe(true);
    expect(store.canSend).toBe(true);
    expect(store.mode).toBe('interactive');
    expect(store.plan).toEqual({ exists: false, content: '' });

    store.addUserMessage('Hello');
    dispatch(
      store,
      { type: 'session_created', model: 'gpt-4.1', sessionId: 'session-1' },
      { type: 'title_changed', title: 'Current session' },
      { type: 'context_info', tokenLimit: 32000, currentTokens: 1200, messagesLength: 4 },
      { type: 'user_input_request', question: 'Continue?', choices: ['Yes'], allowFreeform: false },
      {
        type: 'permission_request',
        requestId: 'perm-1',
        kind: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'pwd' },
      },
      { type: 'connected', user: 'octocat' },
    );

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]).toMatchObject({ role: 'user', content: 'Hello' });
    expect(store.sessionTitle).toBe('Current session');
    expect(store.contextInfo).toEqual({ tokenLimit: 32000, currentTokens: 1200, messagesLength: 4 });
    expect(store.pendingUserInput).toMatchObject({ pending: true, question: 'Continue?' });
    expect(store.pendingPermission).toMatchObject({ requestId: 'perm-1', toolName: 'bash' });

    store.clearPendingUserInput();
    store.clearPendingPermission();
    store.clearMessages();

    expect(store.messages).toEqual([]);
    expect(store.isStreaming).toBe(false);
    expect(store.isWaiting).toBe(false);
    expect(store.isReasoningStreaming).toBe(false);
    expect(store.currentStreamContent).toBe('');
    expect(store.currentReasoningContent).toBe('');
    expect(store.sessionTitle).toBeNull();
    expect(store.contextInfo).toBeNull();
    expect(store.pendingUserInput).toBeNull();
    expect(store.pendingPermission).toBeNull();
    expect(store.sessionDetail).toBeNull();
  });

  it('handles reasoning and assistant streaming lifecycles', () => {
    const store = createChatStore(createWsStoreMock());

    dispatch(
      store,
      { type: 'turn_start' },
      { type: 'reasoning_delta', reasoningId: 'reason-1', content: 'Thinking' },
      { type: 'reasoning_delta', reasoningId: 'reason-1', content: ' deeply' },
    );

    expect(store.isWaiting).toBe(false);
    expect(store.isReasoningStreaming).toBe(true);
    expect(store.currentReasoningContent).toBe('Thinking deeply');

    dispatch(store, { type: 'reasoning_done', reasoningId: 'reason-1' });

    expect(store.isReasoningStreaming).toBe(false);
    expect(store.currentReasoningContent).toBe('');
    expect(store.messages[0]).toMatchObject({ role: 'reasoning', content: 'Thinking deeply' });

    dispatch(
      store,
      { type: 'delta', content: 'Hello' },
      { type: 'delta', content: ' world' },
    );

    expect(store.isStreaming).toBe(true);
    expect(store.currentStreamContent).toBe('Hello world');

    dispatch(store, { type: 'done' });

    expect(store.isStreaming).toBe(false);
    expect(store.isWaiting).toBe(false);
    expect(store.currentStreamContent).toBe('');
    expect(store.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello world' });
    expect(notifyMock).toHaveBeenCalledWith('Response ready', {
      body: 'Hello world',
      tag: 'response-ready',
    });
  });

  it('uses reasoning fallback content, skips blank streams, and updates duplicate tool ids consistently', () => {
    const store = createChatStore(createWsStoreMock());

    dispatch(store, { type: 'reasoning_done', reasoningId: 'reason-2', content: 'Direct reasoning' });
    expect(store.messages[0]).toMatchObject({ role: 'reasoning', content: 'Direct reasoning' });

    dispatch(store, { type: 'tool_progress', toolCallId: 'missing', message: 'Queued' });
    expect(store.messages).toHaveLength(1);

    dispatch(
      store,
      {
        type: 'tool_start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        mcpServerName: 'local',
        mcpToolName: 'exec',
      },
      { type: 'tool_progress', toolCallId: 'tool-1', message: 'Running' },
      { type: 'tool_progress', toolCallId: 'tool-1', message: 'Collecting output' },
      { type: 'tool_end', toolCallId: 'tool-1' },
      { type: 'tool_start', toolCallId: 'duplicate', toolName: 'grep' },
      { type: 'tool_start', toolCallId: 'duplicate', toolName: 'grep' },
      { type: 'tool_end', toolCallId: 'duplicate' },
    );

    expect(store.messages[1]).toMatchObject({
      role: 'tool',
      content: 'bash',
      toolCallId: 'tool-1',
      toolName: 'bash',
      toolStatus: 'complete',
      toolProgressMessage: 'Collecting output',
      toolProgressMessages: ['Running', 'Collecting output'],
      mcpServerName: 'local',
      mcpToolName: 'exec',
    });
    expect(store.messages.slice(-2)).toEqual([
      expect.objectContaining({ toolCallId: 'duplicate', toolStatus: 'complete' }),
      expect.objectContaining({ toolCallId: 'duplicate', toolStatus: 'complete' }),
    ]);

    dispatch(store, { type: 'delta', content: '   ' }, { type: 'turn_end' });

    expect(store.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
    expect(notifyMock).toHaveBeenLastCalledWith('Response ready', {
      body: undefined,
      tag: 'response-ready',
    });
  });

  it('tracks model, tool, agent, and session metadata updates', () => {
    const store = createChatStore(createWsStoreMock());
    const modelInfo: ModelInfo = { id: 'claude-sonnet', name: 'Claude Sonnet' };
    const tools: ToolInfo[] = [{ name: 'bash', description: 'Run shell commands' }];
    const agents: (AgentInfo | string)[] = ['explore', { name: 'reviewer', description: 'Reviews code' }];
    const sessions: SessionSummary[] = [
      { id: 'session-1', title: 'Old title' },
      { id: 'session-2', title: 'Keep me' },
    ];
    const detail: SessionDetail = {
      id: 'session-1',
      checkpoints: [],
    };

    dispatch(
      store,
      { type: 'session_created', model: 'gpt-4.1', sessionId: 'session-1' },
      { type: 'models', models: ['gpt-4.1', modelInfo] },
      { type: 'mode_changed', mode: 'plan' },
      { type: 'model_changed', model: 'gpt-5' },
      { type: 'tools', tools },
      { type: 'agents', agents, current: 'explore' },
      { type: 'agent_changed', agent: 'reviewer' },
      { type: 'sessions', sessions },
      { type: 'title_changed', title: 'Renamed session' },
      { type: 'session_detail', detail },
      { type: 'session_reconnected', user: 'octocat', hasSession: true },
      { type: 'session_reconnected', user: 'octocat', hasSession: false },
      { type: 'session_resumed', sessionId: 'session-2' },
      { type: 'session_deleted', sessionId: 'session-1' },
    );

    expect(store.mode).toBe('plan');
    expect(store.currentModel).toBe('gpt-5');
    expect([...store.models.entries()]).toEqual([
      ['gpt-4.1', { id: 'gpt-4.1', name: 'gpt-4.1' }],
      ['claude-sonnet', modelInfo],
    ]);
    expect(store.tools).toEqual(tools);
    expect(store.agents).toEqual(agents);
    expect(store.currentAgent).toBe('reviewer');
    expect(store.sessionTitle).toBe('Renamed session');
    expect(store.sessions).toEqual([{ id: 'session-2', title: 'Keep me' }]);
    expect(store.sessionDetail).toEqual(detail);
    expect(store.messages).toEqual([
      expect.objectContaining({ role: 'info', content: 'Mode changed to Plan' }),
      expect.objectContaining({ role: 'info', content: 'Model changed to gpt-5' }),
      expect.objectContaining({ role: 'info', content: 'Agent selected: @reviewer' }),
      expect.objectContaining({ role: 'info', content: 'Session reconnected' }),
      expect.objectContaining({ role: 'info', content: 'Session resumed: session-2' }),
      expect.objectContaining({ role: 'info', content: 'Session deleted' }),
    ]);
    expect(notifyMock).toHaveBeenCalledWith('Session restored — ready to continue', {
      tag: 'session-resumed',
    });
  });

  it('records usage, quota, context, plan, compaction, and reasoning-effort updates', () => {
    const store = createChatStore(createWsStoreMock());
    const initialQuota: QuotaSnapshots = {
      chat: { remainingPercentage: 85, resetDate: '2025-01-01T00:00:00Z' },
    };
    const updatedQuota: QuotaSnapshots = {
      chat: { percentageUsed: 25, usedRequests: 10 },
    };

    dispatch(
      store,
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 250,
        reasoningTokens: 40,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        duration: 1200,
        cost: 0.12,
        quotaSnapshots: initialQuota,
        copilotUsage: [{ type: 'prompt', tokens: 100 }],
      },
      { type: 'quota' },
      { type: 'quota', quotaSnapshots: updatedQuota },
      { type: 'context_info', tokenLimit: 64000, currentTokens: 4000, messagesLength: 12 },
      { type: 'plan', exists: true, content: '1. Investigate\n2. Ship', path: '/tmp/plan.md' },
      { type: 'plan_changed' },
      { type: 'plan_updated', content: '1. Investigate\n2. Ship\n3. Verify', path: '/tmp/plan.md' },
      { type: 'compaction_start' },
      { type: 'compaction_complete', tokensRemoved: 120, messagesRemoved: 3, preCompactionTokens: 5000, postCompactionTokens: 4880 },
      { type: 'compaction_result', messagesRemoved: 1 },
      { type: 'reasoning_changed', effort: 'high' },
    );

    expect(store.messages[0]).toMatchObject({
      role: 'usage',
      inputTokens: 100,
      outputTokens: 250,
      reasoningTokens: 40,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      duration: 1200,
      cost: 0.12,
      quotaSnapshots: initialQuota,
      copilotUsage: [{ type: 'prompt', tokens: 100 }],
    });
    expect(store.quotaSnapshots).toEqual(updatedQuota);
    expect(store.contextInfo).toEqual({ tokenLimit: 64000, currentTokens: 4000, messagesLength: 12 });
    expect(store.plan).toEqual({ exists: true, content: '1. Investigate\n2. Ship\n3. Verify', path: '/tmp/plan.md' });
    expect(store.reasoningEffort).toBe('high');

    dispatch(store, { type: 'plan_deleted' });

    expect(store.plan).toEqual({ exists: false, content: '' });
    expect(store.messages.slice(1)).toEqual([
      expect.objectContaining({ role: 'info', content: 'Plan updated' }),
      expect.objectContaining({ role: 'info', content: 'Plan saved' }),
      expect.objectContaining({ role: 'info', content: 'Compacting conversation…' }),
      expect.objectContaining({ role: 'info', content: 'Compaction complete: 5,000 → 4,880 tokens, removed 120 tokens, 3 messages' }),
      expect.objectContaining({ role: 'info', content: 'Compaction result, 1 messages' }),
      expect.objectContaining({ role: 'info', content: 'Reasoning effort set to high' }),
      expect.objectContaining({ role: 'info', content: 'Plan deleted' }),
    ]);
  });

  it('manages warning, user input, permission, error, and abort flows', () => {
    const store = createChatStore(createWsStoreMock());

    dispatch(
      store,
      { type: 'warning', message: 'Careful now' },
      { type: 'user_input_request', question: 'Need approval?', choices: ['Yes', 'No'], allowFreeform: true },
      {
        type: 'permission_request',
        requestId: 'perm-2',
        kind: 'tool',
        toolName: 'grep',
        toolArgs: { pattern: 'TODO' },
      },
      { type: 'turn_start' },
      { type: 'delta', content: 'Partial response' },
      { type: 'error', message: 'Something exploded' },
      { type: 'elicitation_completed', answer: 'Yes' },
      { type: 'elicitation_requested', question: 'Pick one', choices: ['A'], allowFreeform: false },
      {
        type: 'permission_request',
        requestId: 'perm-3',
        kind: 'tool',
        toolName: 'bash',
        toolArgs: { command: 'ls' },
      },
      { type: 'aborted' },
    );

    expect(store.messages).toEqual([
      expect.objectContaining({ role: 'warning', content: 'Careful now' }),
      expect.objectContaining({ role: 'error', content: 'Something exploded' }),
      expect.objectContaining({ role: 'info', content: 'Response stopped' }),
    ]);
    expect(store.isStreaming).toBe(false);
    expect(store.isWaiting).toBe(false);
    expect(store.currentStreamContent).toBe('');
    expect(store.pendingUserInput).toBeNull();
    expect(store.pendingPermission).toBeNull();
    expect(notifyMock).toHaveBeenCalledWith('Copilot is asking you something', {
      body: 'Need approval?',
      tag: 'user-input',
      requireInteraction: true,
    });
    expect(notifyMock).toHaveBeenCalledWith('Tool approval needed: tool', {
      body: 'grep',
      tag: 'perm-2',
      requireInteraction: true,
    });
    expect(notifyMock).toHaveBeenCalledWith('Something went wrong', {
      body: 'Something exploded',
      tag: 'error',
    });
  });

  it('records intent, skill, subagent, info, and exit-plan events', () => {
    const store = createChatStore(createWsStoreMock());

    dispatch(
      store,
      { type: 'intent', intent: 'Exploring codebase' },
      { type: 'skill_invoked', skillName: 'explain' },
      { type: 'subagent_start', agentName: 'reviewer' },
      { type: 'subagent_end', agentName: 'reviewer' },
      { type: 'subagent_failed', agentName: 'triager', error: 'boom' },
      { type: 'subagent_selected', agentName: 'reviewer' },
      { type: 'subagent_deselected' },
      { type: 'info', message: '' },
      { type: 'exit_plan_mode_requested' },
      { type: 'exit_plan_mode_completed' },
    );

    expect(store.currentAgent).toBeNull();
    expect(store.messages).toEqual([
      expect.objectContaining({ role: 'intent', content: 'Exploring codebase' }),
      expect.objectContaining({ role: 'skill', content: 'explain', skillName: 'explain' }),
      expect.objectContaining({ role: 'subagent', content: 'reviewer started', agentName: 'reviewer' }),
      expect.objectContaining({ role: 'subagent', content: 'reviewer completed', agentName: 'reviewer' }),
      expect.objectContaining({ role: 'error', content: 'Sub-agent triager failed: boom' }),
      expect.objectContaining({ role: 'info', content: 'Info' }),
      expect.objectContaining({ role: 'info', content: 'Exiting plan mode…' }),
      expect.objectContaining({ role: 'info', content: 'Exited plan mode' }),
    ]);
  });

  it('accumulates session usage totals across multiple usage messages', () => {
    const store = createChatStore(createWsStoreMock());

    expect(store.sessionTotals).toEqual({
      inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
      cacheReadTokens: 0, cacheWriteTokens: 0,
      totalCost: 0, totalDurationMs: 0, apiCalls: 0, premiumRequests: 0,
    });

    dispatch(store, {
      type: 'usage',
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 30,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      duration: 500,
      cost: 2,
    });

    expect(store.sessionTotals).toEqual({
      inputTokens: 100, outputTokens: 200, reasoningTokens: 30,
      cacheReadTokens: 50, cacheWriteTokens: 10,
      totalCost: 2, totalDurationMs: 500, apiCalls: 1, premiumRequests: 0,
    });

    dispatch(store, {
      type: 'usage',
      inputTokens: 150,
      outputTokens: 300,
      cost: 3,
      duration: 700,
    });

    expect(store.sessionTotals).toEqual({
      inputTokens: 250, outputTokens: 500, reasoningTokens: 30,
      cacheReadTokens: 50, cacheWriteTokens: 10,
      totalCost: 5, totalDurationMs: 1200, apiCalls: 2, premiumRequests: 0,
    });

    // clearMessages resets totals
    store.clearMessages();
    expect(store.sessionTotals.apiCalls).toBe(0);
    expect(store.sessionTotals.inputTokens).toBe(0);
  });

  it('handles session_shutdown and updates premium requests', () => {
    const store = createChatStore(createWsStoreMock());

    dispatch(store, {
      type: 'usage',
      inputTokens: 100,
      outputTokens: 200,
      cost: 1,
    });

    dispatch(store, {
      type: 'session_shutdown',
      totalPremiumRequests: 5,
      totalApiDurationMs: 3200,
      sessionStartTime: '2026-01-01T00:00:00Z',
    });

    expect(store.sessionTotals.premiumRequests).toBe(5);
    expect(store.sessionTotals.totalDurationMs).toBe(3200);
    expect(store.messages).toEqual([
      expect.objectContaining({ role: 'usage' }),
      expect.objectContaining({ role: 'info', content: 'Session ended · 5 premium requests · 3.2s total API time' }),
    ]);
  });

  it('handles session_idle, task_complete, truncation, and workspace_file_changed events', () => {
    const store = createChatStore(createWsStoreMock());

    // session.idle clears streaming/waiting flags
    dispatch(store, { type: 'turn_start' });
    expect(store.isWaiting).toBe(true);
    dispatch(store, { type: 'delta', content: 'data' });
    expect(store.isStreaming).toBe(true);
    dispatch(store, { type: 'session_idle' });
    expect(store.isStreaming).toBe(false);
    expect(store.isWaiting).toBe(false);

    store.clearMessages();

    // task_complete with summary adds info message
    dispatch(store, { type: 'task_complete', summary: 'Refactored auth module' });
    expect(store.messages).toEqual([
      expect.objectContaining({ role: 'info', content: 'Task complete: Refactored auth module' }),
    ]);

    store.clearMessages();

    // task_complete without summary adds nothing
    dispatch(store, { type: 'task_complete' });
    expect(store.messages).toEqual([]);

    store.clearMessages();

    // truncation adds descriptive info message
    dispatch(store, {
      type: 'truncation',
      tokenLimit: 128000,
      preTruncationTokens: 100000,
      preTruncationMessages: 50,
      postTruncationTokens: 60000,
      postTruncationMessages: 30,
    });
    expect(store.messages).toEqual([
      expect.objectContaining({
        role: 'info',
        content: 'Context truncated: 50 → 30 messages (100000 → 60000 tokens)',
      }),
    ]);

    store.clearMessages();

    // context_changed and workspace_file_changed are accepted without error
    dispatch(
      store,
      { type: 'context_changed', cwd: '/tmp', gitRoot: '/tmp', repository: 'o/r', branch: 'main' },
      { type: 'workspace_file_changed', path: 'plan.md', operation: 'update' },
      { type: 'tool_partial_result', toolCallId: 'tc-1', partialOutput: 'partial data' },
    );
    // These events don't produce visible messages but should not throw
    expect(store.messages).toEqual([]);
  });
});
