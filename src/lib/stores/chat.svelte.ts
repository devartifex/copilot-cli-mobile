import type {
  ChatMessage,
  ChatMessageRole,
  ToolCallState,
  ServerMessage,
  SessionMode,
  ReasoningEffort,
  ModelInfo,
  ToolInfo,
  AgentInfo,
  SessionSummary,
  SessionDetail,
  UserInputState,
  PermissionRequestState,
  ContextInfo,
  PlanState,
  QuotaSnapshots,
  QuotaSnapshot,
  SessionUsageTotals,
} from '$lib/types/index.js';
import type { WsStore } from '$lib/stores/ws.svelte.js';
import { notify } from '$lib/utils/notifications.js';

export interface ChatStore {
  // Message state
  readonly messages: ChatMessage[];
  readonly isStreaming: boolean;
  readonly isWaiting: boolean;
  readonly isReasoningStreaming: boolean;
  readonly currentStreamContent: string;
  readonly currentReasoningContent: string;
  readonly activeToolCalls: Map<string, ToolCallState>;

  // Session state
  readonly mode: SessionMode;
  readonly currentModel: string;
  readonly reasoningEffort: ReasoningEffort | null;
  readonly currentAgent: string | null;
  readonly sessionTitle: string | null;
  readonly pendingUserInput: UserInputState | null;
  readonly pendingPermission: PermissionRequestState | null;

  // Data lists
  readonly models: Map<string, ModelInfo>;
  readonly tools: ToolInfo[];
  readonly agents: (AgentInfo | string)[];
  readonly sessions: SessionSummary[];
  readonly sessionDetail: SessionDetail | null;

  // Context & quota
  readonly contextInfo: ContextInfo | null;
  readonly quotaSnapshots: QuotaSnapshots | null;
  readonly sessionTotals: SessionUsageTotals;

  // Plan
  readonly plan: PlanState;

  // Derived
  readonly isConnected: boolean;
  readonly canSend: boolean;

  // Methods
  handleServerMessage(msg: ServerMessage): void;
  clearMessages(): void;
  addUserMessage(content: string): void;
  clearPendingPermission(): void;
  clearPendingUserInput(): void;
}

let nextId = 0;
function genId(): string {
  return `msg-${Date.now()}-${nextId++}`;
}

export function createChatStore(wsStore: WsStore): ChatStore {
  // ── Message state ───────────────────────────────────────────────────────
  let messages = $state<ChatMessage[]>([]);
  let isStreaming = $state(false);
  let isWaiting = $state(false);
  let isReasoningStreaming = $state(false);
  let currentStreamContent = $state('');
  let currentReasoningContent = $state('');
  let activeToolCalls = $state(new Map<string, ToolCallState>());

  // ── Session state ───────────────────────────────────────────────────────
  let mode = $state<SessionMode>('interactive');
  let currentModel = $state('');
  let reasoningEffort = $state<ReasoningEffort | null>(null);
  let currentAgent = $state<string | null>(null);
  let sessionTitle = $state<string | null>(null);
  let currentSessionId = $state<string | null>(null);
  let pendingUserInput = $state<UserInputState | null>(null);
  let pendingPermission = $state<PermissionRequestState | null>(null);

  // ── Data lists ──────────────────────────────────────────────────────────
  let models = $state(new Map<string, ModelInfo>());
  let tools = $state<ToolInfo[]>([]);
  let agents = $state<(AgentInfo | string)[]>([]);
  let sessions = $state<SessionSummary[]>([]);
  let sessionDetail = $state<SessionDetail | null>(null);

  // ── Context & quota ─────────────────────────────────────────────────────
  let contextInfo = $state<ContextInfo | null>(null);
  let quotaSnapshots = $state<QuotaSnapshots | null>(null);

  const emptyTotals: SessionUsageTotals = {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0,
    totalCost: 0, totalDurationMs: 0, apiCalls: 0, premiumRequests: 0,
  };
  let sessionTotals = $state<SessionUsageTotals>({ ...emptyTotals });

  // ── Plan ────────────────────────────────────────────────────────────────
  let plan = $state<PlanState>({ exists: false, content: '' });

  // ── Derived values ──────────────────────────────────────────────────────
  const isConnected = $derived(wsStore.connectionState === 'connected');
  const canSend = $derived(isConnected && !isStreaming && wsStore.sessionReady);

  // ── Internal helpers ────────────────────────────────────────────────────

  function addMessage(role: ChatMessageRole, content: string, extra?: Partial<ChatMessage>): void {
    const msg: ChatMessage = {
      id: genId(),
      role,
      content,
      timestamp: Date.now(),
      ...extra,
    };
    messages = [...messages, msg];
  }

  function addInfoMessage(content: string): void {
    addMessage('info', content);
  }

  function finalizeStream(): void {
    // Commit the streamed content as a complete assistant message (skip empty/whitespace-only)
    if (currentStreamContent.trim()) {
      addMessage('assistant', currentStreamContent);
    }
    isStreaming = false;
    isWaiting = false;
    currentStreamContent = '';
    currentReasoningContent = '';
    activeToolCalls = new Map();
  }

  // ── Server message handler ──────────────────────────────────────────────

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'connected':
        break;

      case 'session_created':
        currentModel = msg.model;
        if (msg.sessionId) currentSessionId = msg.sessionId;
        break;

      case 'session_reconnected':
        if (msg.hasSession) {
          addInfoMessage('Session reconnected');
        }
        break;

      case 'turn_start':
        currentReasoningContent = '';
        isReasoningStreaming = false;
        isWaiting = true;
        activeToolCalls = new Map();
        break;

      case 'reasoning_delta':
        isWaiting = false;
        isReasoningStreaming = true;
        currentReasoningContent += msg.content;
        break;

      case 'reasoning_done': {
        const reasoningText = currentReasoningContent.trim() || msg.content?.trim() || '';
        if (reasoningText) {
          addMessage('reasoning', reasoningText);
        }
        isReasoningStreaming = false;
        currentReasoningContent = '';
        break;
      }

      case 'intent':
        addMessage('intent', msg.intent);
        break;

      case 'tool_start':
        isWaiting = false;
        addMessage('tool', msg.toolName, {
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          toolStatus: 'running',
          mcpServerName: msg.mcpServerName,
          mcpToolName: msg.mcpToolName,
        });
        break;

      case 'tool_progress':
        messages = messages.map(m =>
          m.toolCallId === msg.toolCallId
            ? {
                ...m,
                toolStatus: 'progress' as const,
                toolProgressMessage: msg.message,
                toolProgressMessages: [...(m.toolProgressMessages ?? []), msg.message],
              }
            : m,
        );
        break;

      case 'tool_end':
        messages = messages.map(m =>
          m.toolCallId === msg.toolCallId ? { ...m, toolStatus: 'complete' as const } : m,
        );
        break;

      case 'delta':
        isWaiting = false;
        if (!isStreaming) {
          isStreaming = true;
          currentStreamContent = '';
        }
        currentStreamContent += msg.content;
        break;

      case 'turn_end':
      case 'done':
        notify('Response ready', {
          body: currentStreamContent.trim().slice(0, 100) || undefined,
          tag: 'response-ready',
        });
        finalizeStream();
        break;

      case 'models': {
        const newModels = new Map<string, ModelInfo>();
        for (const m of msg.models) {
          if (typeof m === 'string') {
            newModels.set(m, { id: m, name: m });
          } else {
            newModels.set(m.id, m);
          }
        }
        models = newModels;
        break;
      }

      case 'mode_changed': {
        const modeLabels: Record<string, string> = {
          interactive: 'Ask',
          plan: 'Plan',
          autopilot: 'Auto',
        };
        mode = msg.mode;
        addInfoMessage(`Mode changed to ${modeLabels[msg.mode] ?? msg.mode}`);
        break;
      }

      case 'model_changed':
        if (msg.model) {
          currentModel = msg.model;
        }
        addInfoMessage(`Model changed to ${msg.model}`);
        break;

      case 'title_changed':
        sessionTitle = msg.title;
        if (currentSessionId) {
          sessions = sessions.map((s) =>
            s.id === currentSessionId ? { ...s, title: msg.title } : s,
          );
        }
        break;

      case 'usage':
        addMessage('usage', '', {
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
          reasoningTokens: msg.reasoningTokens,
          cacheReadTokens: msg.cacheReadTokens,
          cacheWriteTokens: msg.cacheWriteTokens,
          duration: msg.duration,
          cost: msg.cost,
          quotaSnapshots: msg.quotaSnapshots,
          copilotUsage: msg.copilotUsage,
        });
        // Accumulate session totals
        sessionTotals = {
          inputTokens: sessionTotals.inputTokens + (msg.inputTokens ?? 0),
          outputTokens: sessionTotals.outputTokens + (msg.outputTokens ?? 0),
          reasoningTokens: sessionTotals.reasoningTokens + (msg.reasoningTokens ?? 0),
          cacheReadTokens: sessionTotals.cacheReadTokens + (msg.cacheReadTokens ?? 0),
          cacheWriteTokens: sessionTotals.cacheWriteTokens + (msg.cacheWriteTokens ?? 0),
          totalCost: sessionTotals.totalCost + (msg.cost ?? 0),
          totalDurationMs: sessionTotals.totalDurationMs + (msg.duration ?? 0),
          apiCalls: sessionTotals.apiCalls + 1,
          premiumRequests: sessionTotals.premiumRequests,
        };
        if (msg.quotaSnapshots) {
          quotaSnapshots = msg.quotaSnapshots;
        }
        break;

      case 'warning':
        addMessage('warning', msg.message);
        break;

      case 'error':
        addMessage('error', msg.message);
        isStreaming = false;
        isWaiting = false;
        currentStreamContent = '';
        // Don't clear pendingUserInput — the error may be unrelated to the ask_user flow
        pendingPermission = null;
        notify('Something went wrong', {
          body: msg.message,
          tag: 'error',
        });
        break;

      case 'aborted':
        isStreaming = false;
        isWaiting = false;
        currentStreamContent = '';
        pendingUserInput = null;
        pendingPermission = null;
        addInfoMessage('Response stopped');
        break;

      case 'user_input_request':
      case 'elicitation_requested':
        pendingUserInput = {
          pending: true,
          question: msg.question,
          choices: msg.choices,
          allowFreeform: msg.allowFreeform,
        };
        notify('Copilot is asking you something', {
          body: msg.question,
          tag: 'user-input',
          requireInteraction: true,
        });
        break;

      case 'elicitation_completed':
        pendingUserInput = null;
        break;

      case 'permission_request':
        pendingPermission = {
          requestId: msg.requestId,
          kind: msg.kind,
          toolName: msg.toolName,
          toolArgs: msg.toolArgs,
        };
        notify(`Tool approval needed: ${msg.kind}`, {
          body: msg.toolName,
          tag: msg.requestId,
          requireInteraction: true,
        });
        break;

      case 'tools':
        tools = msg.tools;
        break;

      case 'agents':
        agents = msg.agents;
        if (msg.current !== undefined) {
          currentAgent = msg.current;
        }
        break;

      case 'agent_changed':
        currentAgent = msg.agent;
        addInfoMessage(msg.agent ? `Agent selected: @${msg.agent}` : 'Agent deselected');
        break;

      case 'quota':
        if (msg.quotaSnapshots) {
          quotaSnapshots = msg.quotaSnapshots;
        }
        break;

      case 'sessions':
        sessions = msg.sessions;
        break;

      case 'session_detail':
        sessionDetail = msg.detail;
        break;

      case 'session_resumed':
        currentSessionId = msg.sessionId;
        addInfoMessage(`Session resumed: ${msg.sessionId}`);
        notify('Session restored — ready to continue', {
          tag: 'session-resumed',
        });
        break;

      case 'session_deleted':
        sessions = sessions.filter((s) => s.id !== msg.sessionId);
        addInfoMessage('Session deleted');
        break;

      case 'plan':
        plan = {
          exists: msg.exists,
          content: msg.content ?? '',
          path: msg.path,
        };
        break;

      case 'plan_changed':
        addInfoMessage('Plan updated');
        break;

      case 'plan_updated':
        if (msg.content !== undefined || msg.path !== undefined) {
          plan = {
            exists: true,
            content: msg.content ?? plan.content,
            path: msg.path ?? plan.path,
          };
        }
        addInfoMessage('Plan saved');
        break;

      case 'plan_deleted':
        addInfoMessage('Plan deleted');
        plan = { exists: false, content: '' };
        break;

      case 'compaction_start':
        addInfoMessage('Compacting conversation…');
        break;

      case 'compaction_complete': {
        let compactionMsg = 'Compaction complete';
        if (msg.preCompactionTokens != null && msg.postCompactionTokens != null) {
          compactionMsg += `: ${msg.preCompactionTokens.toLocaleString()} → ${msg.postCompactionTokens.toLocaleString()} tokens`;
        }
        if (msg.tokensRemoved) {
          compactionMsg += (msg.preCompactionTokens != null ? ', ' : ': ') + `removed ${msg.tokensRemoved.toLocaleString()} tokens`;
        }
        if (msg.messagesRemoved) {
          compactionMsg += `, ${msg.messagesRemoved} messages`;
        }
        addInfoMessage(compactionMsg);
        break;
      }

      case 'compaction_result':
        addInfoMessage(
          'Compaction result' +
          (msg.tokensRemoved ? `: removed ${msg.tokensRemoved} tokens` : '') +
          (msg.messagesRemoved ? `, ${msg.messagesRemoved} messages` : ''),
        );
        break;

      case 'skill_invoked':
        addMessage('skill', msg.skillName, { skillName: msg.skillName });
        break;

      case 'subagent_start':
        addMessage('subagent', `${msg.agentName} started`, { agentName: msg.agentName });
        break;

      case 'subagent_end':
        addMessage('subagent', `${msg.agentName} completed`, { agentName: msg.agentName });
        break;

      case 'subagent_failed':
        addMessage('error', `Sub-agent ${msg.agentName ?? 'unknown'} failed${msg.error ? `: ${msg.error}` : ''}`);
        break;

      case 'subagent_selected':
        currentAgent = msg.agentName;
        break;

      case 'subagent_deselected':
        currentAgent = null;
        break;

      case 'info':
        addInfoMessage(msg.message || 'Info');
        break;

      case 'exit_plan_mode_requested':
        addInfoMessage('Exiting plan mode…');
        break;

      case 'exit_plan_mode_completed':
        addInfoMessage('Exited plan mode');
        break;

      case 'context_info':
        contextInfo = {
          tokenLimit: msg.tokenLimit,
          currentTokens: msg.currentTokens,
          messagesLength: msg.messagesLength,
        };
        break;

      case 'session_shutdown':
        if (msg.totalPremiumRequests != null) {
          sessionTotals = { ...sessionTotals, premiumRequests: msg.totalPremiumRequests };
        }
        if (msg.totalApiDurationMs != null) {
          sessionTotals = { ...sessionTotals, totalDurationMs: msg.totalApiDurationMs };
        }
        addInfoMessage(
          'Session ended' +
          (msg.totalPremiumRequests != null ? ` · ${msg.totalPremiumRequests} premium requests` : '') +
          (msg.totalApiDurationMs != null ? ` · ${(msg.totalApiDurationMs / 1000).toFixed(1)}s total API time` : ''),
        );
        break;

      case 'reasoning_changed':
        reasoningEffort = msg.effort;
        addInfoMessage(`Reasoning effort set to ${msg.effort}`);
        break;

      case 'session_idle':
        isStreaming = false;
        isWaiting = false;
        break;

      case 'task_complete':
        if (msg.summary) {
          addInfoMessage(`Task complete: ${msg.summary}`);
        }
        break;

      case 'truncation':
        addInfoMessage(
          `Context truncated: ${msg.preTruncationMessages} → ${msg.postTruncationMessages} messages` +
          ` (${msg.preTruncationTokens} → ${msg.postTruncationTokens} tokens)`,
        );
        break;

      case 'tool_partial_result':
        messages = messages.map(m =>
          m.toolCallId === msg.toolCallId
            ? {
                ...m,
                toolProgressMessages: [...(m.toolProgressMessages ?? []), msg.partialOutput],
              }
            : m,
        );
        break;

      case 'context_changed':
        addInfoMessage(
          `Context: ${msg.repository ?? msg.cwd}` +
          (msg.branch ? ` (${msg.branch})` : ''),
        );
        break;

      case 'workspace_file_changed':
        addInfoMessage(`Workspace file ${msg.operation}d: ${msg.path}`);
        break;
    }
  }

  // ── Public mutations ────────────────────────────────────────────────────

  function clearMessages(): void {
    messages = [];
    isStreaming = false;
    isWaiting = false;
    isReasoningStreaming = false;
    currentStreamContent = '';
    currentReasoningContent = '';
    activeToolCalls = new Map();
    sessionTitle = null;
    currentSessionId = null;
    pendingUserInput = null;
    pendingPermission = null;
    contextInfo = null;
    sessionDetail = null;
    sessionTotals = { ...emptyTotals };
  }

  function addUserMessage(content: string): void {
    addMessage('user', content);
  }

  function clearPendingPermission(): void {
    pendingPermission = null;
  }

  function clearPendingUserInput(): void {
    pendingUserInput = null;
  }

  // ── Return public interface ─────────────────────────────────────────────

  return {
    get messages() { return messages; },
    get isStreaming() { return isStreaming; },
    get isWaiting() { return isWaiting; },
    get isReasoningStreaming() { return isReasoningStreaming; },
    get currentStreamContent() { return currentStreamContent; },
    get currentReasoningContent() { return currentReasoningContent; },
    get activeToolCalls() { return activeToolCalls; },

    get mode() { return mode; },
    get currentModel() { return currentModel; },
    get reasoningEffort() { return reasoningEffort; },
    get currentAgent() { return currentAgent; },
    get sessionTitle() { return sessionTitle; },
    get pendingUserInput() { return pendingUserInput; },
    get pendingPermission() { return pendingPermission; },

    get models() { return models; },
    get tools() { return tools; },
    get agents() { return agents; },
    get sessions() { return sessions; },
    get sessionDetail() { return sessionDetail; },

    get contextInfo() { return contextInfo; },
    get quotaSnapshots() { return quotaSnapshots; },
    get sessionTotals() { return sessionTotals; },

    get plan() { return plan; },

    get isConnected() { return isConnected; },
    get canSend() { return canSend; },

    handleServerMessage,
    clearMessages,
    addUserMessage,
    clearPendingPermission,
    clearPendingUserInput,
  };
}
