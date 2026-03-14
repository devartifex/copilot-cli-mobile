import type {
  ConnectionState,
  SessionMode,
  ReasoningEffort,
  ClientMessage,
  ServerMessage,
  NewSessionConfig,
  MessageDeliveryMode,
  McpServerDefinition,
} from '$lib/types/index.js';
import { notify } from '$lib/utils/notifications.js';

const INITIAL_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60_000;
const UNAUTHORIZED_CODE = 4001;
const REPLACED_CODE = 4002;

// Unique ID for this browser tab — persisted in sessionStorage to survive hard refreshes
const TAB_ID = typeof sessionStorage !== 'undefined'
  ? sessionStorage.getItem('copilot-tab-id') ?? (() => {
      const id = crypto.randomUUID();
      sessionStorage.setItem('copilot-tab-id', id);
      return id;
    })()
  : crypto.randomUUID();

export interface WsStore {
  readonly connectionState: ConnectionState;
  readonly sessionReady: boolean;

  connect(): void;
  disconnect(): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;

  send(data: ClientMessage): void;

  // Typed send helpers
  sendMessage(
    content: string,
    attachments?: Array<{ path: string; name: string; type: string }>,
    mode?: MessageDeliveryMode,
  ): void;
  newSession(config: NewSessionConfig): void;
  resumeSession(sessionId: string, mcpServers?: McpServerDefinition[]): void;
  setMode(mode: SessionMode): void;
  setModel(model: string): void;
  setReasoning(effort: ReasoningEffort): void;
  abort(): void;
  compact(): void;
  listModels(): void;
  listTools(model?: string): void;
  listAgents(): void;
  listSessions(): void;
  selectAgent(name: string): void;
  deselectAgent(): void;
  deleteSession(sessionId: string): void;
  getSessionDetail(sessionId: string): void;
  getQuota(): void;
  getPlan(): void;
  updatePlan(content: string): void;
  deletePlan(): void;
  respondToUserInput(answer: string, wasFreeform: boolean): void;
  respondToPermission(requestId: string, kind: string, toolName: string, decision: 'allow' | 'deny' | 'always_allow' | 'always_deny'): void;
}

export function createWsStore(): WsStore {
  let connectionState = $state<ConnectionState>('disconnected');
  let sessionReady = $state(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = INITIAL_RECONNECT_DELAY;
  let messageHandlers: Array<(msg: ServerMessage) => void> = [];
  let visibilityCleanup: (() => void) | null = null;

  // ── Internal helpers ────────────────────────────────────────────────────

  function send(msg: ClientMessage): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function dispatchMessage(msg: ServerMessage): void {
    // Track session readiness from protocol messages
    if (msg.type === 'session_created' || msg.type === 'session_resumed') {
      sessionReady = true;
    }
    if (msg.type === 'session_reconnected') {
      sessionReady = msg.hasSession;
    }

    for (const handler of messageHandlers) {
      handler(msg);
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => connect(), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  }

  function buildWsUrl(): string {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws?tabId=${TAB_ID}`;
  }

  function setupVisibilityHandler(): void {
    if (typeof document === 'undefined' || visibilityCleanup) return;

    const handler = () => {
      if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
        clearReconnectTimer();
        connect();
      }
    };
    document.addEventListener('visibilitychange', handler);
    visibilityCleanup = () => document.removeEventListener('visibilitychange', handler);
  }

  // ── Connection lifecycle ────────────────────────────────────────────────

  function connect(): void {
    if (typeof window === 'undefined') return;
    console.log(`[WS-STORE] connect() called, existing ws=${!!ws}, readyState=${ws?.readyState}`);

    // Close existing connection without triggering reconnect logic
    if (ws) {
      console.log('[WS-STORE] Closing existing connection before reconnect');
      ws.onclose = null;
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }

    connectionState = 'connecting';
    const socket = new WebSocket(buildWsUrl());

    socket.onopen = () => {
      console.log(`[WS-STORE] WebSocket connected`);
      connectionState = 'connected';
      reconnectDelay = INITIAL_RECONNECT_DELAY;
      clearReconnectTimer();
    };

    socket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        console.log(`[WS-STORE] Received message: type=${msg.type}`);
        dispatchMessage(msg);
      } catch {
        console.error('WS: failed to parse message');
      }
    };

    socket.onclose = (event: CloseEvent) => {
      console.log(`[WS-STORE] WebSocket closed code=${event.code} reason=${event.reason}`);
      connectionState = 'disconnected';
      sessionReady = false;
      ws = null;

      if (event.code === UNAUTHORIZED_CODE) {
        window.location.reload();
        return;
      }

      // 4002 = replaced by a newer connection we opened — don't reconnect
      // (the newer socket is already active)
      if (event.code === REPLACED_CODE) {
        return;
      }

      notify('Session disconnected — trying to reconnect…', {
        tag: 'session-disconnected',
      });
      scheduleReconnect();
    };

    socket.onerror = () => {
      console.error(`[WS-STORE] WebSocket error`);
      connectionState = 'error';
    };

    ws = socket;
    setupVisibilityHandler();
  }

  function disconnect(): void {
    console.log(`[WS-STORE] disconnect() called, ws=${!!ws}`);
    clearReconnectTimer();
    if (visibilityCleanup) {
      visibilityCleanup();
      visibilityCleanup = null;
    }
    if (ws) {
      ws.onclose = null; // prevent onclose from scheduling a reconnect
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    }
    connectionState = 'disconnected';
    sessionReady = false;
  }

  // ── Message subscription ────────────────────────────────────────────────

  function onMessage(handler: (msg: ServerMessage) => void): () => void {
    messageHandlers.push(handler);
    return () => {
      messageHandlers = messageHandlers.filter((h) => h !== handler);
    };
  }

  // ── Typed send functions ────────────────────────────────────────────────

  function sendMessage(
    content: string,
    attachments?: Array<{ path: string; name: string; type: string }>,
    mode?: MessageDeliveryMode,
  ): void {
    send({
      type: 'message',
      content,
      ...(attachments?.length ? { attachments } : {}),
      ...(mode ? { mode } : {}),
    });
  }

  function newSession(config: NewSessionConfig): void {
    sessionReady = false;
    const msg: ClientMessage = {
      type: 'new_session',
      model: config.model,
      ...(config.mode && { mode: config.mode }),
      ...(config.reasoningEffort && { reasoningEffort: config.reasoningEffort }),
      ...(config.customInstructions?.trim() && { customInstructions: config.customInstructions.trim() }),
      ...(config.excludedTools?.length && { excludedTools: config.excludedTools }),
      ...(config.customTools?.length && { customTools: config.customTools }),
      ...(config.customAgents?.length && { customAgents: config.customAgents }),
      ...(config.mcpServers?.length && { mcpServers: config.mcpServers }),
      ...(config.disabledSkills?.length && { disabledSkills: config.disabledSkills }),
    };
    send(msg);
  }

  function resumeSession(sessionId: string, mcpServers?: McpServerDefinition[]): void {
    sessionReady = false;
    const enabledServers = mcpServers?.filter(s => s.enabled);
    send({
      type: 'resume_session',
      sessionId,
      ...(enabledServers?.length && { mcpServers: enabledServers }),
    });
  }

  function setMode(mode: SessionMode): void {
    send({ type: 'set_mode', mode });
  }

  function setModel(model: string): void {
    send({ type: 'set_model', model });
  }

  function setReasoning(effort: ReasoningEffort): void {
    send({ type: 'set_reasoning', effort });
  }

  function abort(): void {
    send({ type: 'abort' });
  }

  function compact(): void {
    send({ type: 'compact' });
  }

  function listModels(): void {
    send({ type: 'list_models' });
  }

  function listTools(model?: string): void {
    const msg: ClientMessage = model
      ? { type: 'list_tools', model }
      : { type: 'list_tools' };
    send(msg);
  }

  function listAgents(): void {
    send({ type: 'list_agents' });
  }

  function listSessions(): void {
    send({ type: 'list_sessions' });
  }

  function deleteSession(sessionId: string): void {
    send({ type: 'delete_session', sessionId });
  }

  function getSessionDetail(sessionId: string): void {
    send({ type: 'get_session_detail', sessionId });
  }

  function selectAgent(name: string): void {
    send({ type: 'select_agent', name });
  }

  function deselectAgent(): void {
    send({ type: 'deselect_agent' });
  }

  function getQuota(): void {
    send({ type: 'get_quota' });
  }

  function getPlan(): void {
    send({ type: 'get_plan' });
  }

  function updatePlan(content: string): void {
    send({ type: 'update_plan', content });
  }

  function deletePlan(): void {
    send({ type: 'delete_plan' });
  }

  function respondToUserInput(answer: string, wasFreeform: boolean): void {
    send({ type: 'user_input_response', answer, wasFreeform });
  }

  function respondToPermission(requestId: string, kind: string, toolName: string, decision: 'allow' | 'deny' | 'always_allow' | 'always_deny'): void {
    send({ type: 'permission_response', requestId, kind, toolName, decision });
  }

  // ── Return public interface ─────────────────────────────────────────────

  return {
    get connectionState() { return connectionState; },
    get sessionReady() { return sessionReady; },

    connect,
    disconnect,
    onMessage,

    send,
    sendMessage,
    newSession,
    resumeSession,
    setMode,
    setModel,
    setReasoning,
    abort,
    compact,
    listModels,
    listTools,
    listAgents,
    listSessions,
    deleteSession,
    getSessionDetail,
    selectAgent,
    deselectAgent,
    getQuota,
    getPlan,
    updatePlan,
    deletePlan,
    respondToUserInput,
    respondToPermission,
  };
}
