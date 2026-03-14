import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { approveAll } from '@github/copilot-sdk';
import { createCopilotClient } from '../copilot/client.js';
import { createCopilotSession, getAvailableModels } from '../copilot/session.js';
import { enrichSessionMetadata, getSessionDetail, getSessionStateDir, listSessionsFromFilesystem, buildSessionContext, deleteSessionFromFilesystem } from '../copilot/session-metadata.js';
import { config } from '../config.js';
import { logSecurity } from '../security-log.js';
import { validateGitHubToken } from '../auth/github.js';
import { checkAuth } from '../auth/guard.js';
import { clearAuth } from '../auth/session-utils.js';
import {
  sessionPool, createPoolEntry, destroyPoolEntry, poolSend,
  isValidTabId, countUserSessions, evictOldestUserSession,
  type PoolEntry,
} from './session-pool.js';

type SessionMiddleware = (req: any, res: any, next: () => void) => void;

const MAX_MESSAGE_LENGTH = 10_000;
const VALID_MESSAGE_TYPES = new Set([
  'new_session', 'message', 'list_models', 'set_mode',
  'abort', 'set_model', 'set_reasoning', 'user_input_response',
  'permission_response',
  'list_tools', 'list_agents', 'select_agent', 'deselect_agent',
  'get_quota', 'compact', 'list_sessions', 'resume_session',
  'delete_session', 'get_session_detail', 'get_plan', 'update_plan', 'delete_plan',
]);
const VALID_MODES = new Set(['interactive', 'plan', 'autopilot']);
const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);
const HEARTBEAT_INTERVAL = 30_000;

/** Normalize SDK quota snapshots: convert remainingPercentage from 0.0–1.0 to 0–100 and add percentageUsed */
function normalizeQuotaSnapshots(raw: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!raw) return raw;
  console.log('[QUOTA] raw SDK snapshots:', JSON.stringify(raw));
  const result: Record<string, any> = {};
  for (const [key, snap] of Object.entries(raw)) {
    const remaining = snap.remainingPercentage;
    const normalizedRemaining = remaining != null && remaining <= 1 ? remaining * 100 : remaining;
    result[key] = {
      ...snap,
      remainingPercentage: normalizedRemaining,
      percentageUsed: normalizedRemaining != null ? 100 - normalizedRemaining : undefined,
    };
  }
  return result;
}

function wireSessionEvents(session: any, entry: PoolEntry, sessionId?: string): void {
  session.on('assistant.message_delta', (event: any) => {
    poolSend(entry, { type: 'delta', content: event.data.deltaContent });
  });
  session.on('assistant.reasoning_delta', (event: any) => {
    poolSend(entry, { type: 'reasoning_delta', content: event.data.deltaContent, reasoningId: event.data.reasoningId });
  });
  session.on('assistant.reasoning', (event: any) => {
    poolSend(entry, { type: 'reasoning_done', reasoningId: event.data.reasoningId, content: event.data.content });
  });
  session.on('assistant.intent', (event: any) => {
    poolSend(entry, { type: 'intent', intent: event.data.intent });
  });
  session.on('assistant.turn_start', () => { poolSend(entry, { type: 'turn_start' }); });
  session.on('assistant.turn_end', () => {
    entry.isProcessing = false;
    poolSend(entry, { type: 'turn_end' });
    poolSend(entry, { type: 'done' });
  });
  session.on('tool.execution_start', (event: any) => {
    console.log('[TOOL] execution_start:', event.data.toolName, 'mcp:', event.data.mcpServerName, '/', event.data.mcpToolName);
    poolSend(entry, { type: 'tool_start', toolCallId: event.data.toolCallId, toolName: event.data.toolName, mcpServerName: event.data.mcpServerName, mcpToolName: event.data.mcpToolName });
  });
  session.on('tool.execution_complete', (event: any) => {
    console.log('[TOOL] execution_complete:', event.data.toolCallId);
    poolSend(entry, { type: 'tool_end', toolCallId: event.data.toolCallId });
  });
  session.on('tool.execution_progress', (event: any) => {
    console.log('[TOOL] execution_progress:', event.data.toolCallId, event.data.message);
    poolSend(entry, { type: 'tool_progress', toolCallId: event.data.toolCallId, message: event.data.message });
  });
  session.on('session.mode_changed', (event: any) => {
    poolSend(entry, { type: 'mode_changed', mode: event.data.newMode });
  });
  session.on('session.error', (event: any) => {
    console.error('[SESSION] error event:', event.data.message);
    poolSend(entry, { type: 'error', message: event.data.message });
  });
  session.on('session.title_changed', (event: any) => {
    poolSend(entry, { type: 'title_changed', title: event.data.title });
  });
  session.on('assistant.usage', (event: any) => {
    poolSend(entry, {
      type: 'usage',
      inputTokens: event.data.inputTokens,
      outputTokens: event.data.outputTokens,
      totalTokens: event.data.totalTokens,
      reasoningTokens: event.data.reasoningTokens,
      cacheReadTokens: event.data.cacheReadTokens,
      cacheWriteTokens: event.data.cacheWriteTokens,
      duration: event.data.duration,
      cost: event.data.cost,
      quotaSnapshots: normalizeQuotaSnapshots(event.data.quotaSnapshots),
      copilotUsage: event.data.copilotUsage,
    });
  });
  session.on('session.warning', (event: any) => {
    poolSend(entry, { type: 'warning', message: event.data.message });
  });
  session.on('session.usage_info', (event: any) => {
    poolSend(entry, {
      type: 'context_info',
      tokenLimit: event.data.tokenLimit,
      currentTokens: event.data.currentTokens,
      messagesLength: event.data.messagesLength,
    });
  });
  session.on('subagent.started', (event: any) => {
    poolSend(entry, { type: 'subagent_start', agentName: event.data.agentName });
  });
  session.on('subagent.completed', (event: any) => {
    poolSend(entry, { type: 'subagent_end', agentName: event.data.agentName });
  });
  session.on('session.info', (event: any) => {
    poolSend(entry, { type: 'info', message: event.data?.message || event.data });
  });
  session.on('session.plan_changed', (event: any) => {
    poolSend(entry, { type: 'plan_changed', content: event.data?.content, path: event.data?.path });
    // Read the full plan to sync UI + persist to disk
    session.rpc.plan.read()
      .then((plan: { exists?: boolean; content?: string; path?: string }) => {
        if (plan?.exists && plan.content != null) {
          // Send full plan to UI so the panel stays in sync
          poolSend(entry, { type: 'plan', exists: true, content: plan.content, path: plan.path });
          // Persist plan changes to disk for CLI bidirectional sync
          if (sessionId) {
            const sessionDir = join(getSessionStateDir(), sessionId);
            writeFile(join(sessionDir, 'plan.md'), plan.content, 'utf-8')
              .catch((err: Error) => console.warn(`[PLAN] Failed to sync plan.md for ${sessionId}:`, err.message));
          }
        }
      })
      .catch((err: Error) => console.warn(`[PLAN] Failed to read plan:`, err.message));
  });
  session.on('session.compaction_start', () => { poolSend(entry, { type: 'compaction_start' }); });
  session.on('session.compaction_complete', (event: any) => {
    poolSend(entry, {
      type: 'compaction_complete',
      tokensRemoved: event.data?.tokensRemoved,
      messagesRemoved: event.data?.messagesRemoved,
      preCompactionTokens: event.data?.preCompactionTokens,
      postCompactionTokens: event.data?.postCompactionTokens,
    });
  });
  session.on('session.shutdown', (event: any) => {
    poolSend(entry, {
      type: 'session_shutdown',
      totalPremiumRequests: event.data?.totalPremiumRequests,
      totalApiDurationMs: event.data?.totalApiDurationMs,
      sessionStartTime: event.data?.sessionStartTime,
    });
  });
  session.on('skill.invoked', (event: any) => {
    poolSend(entry, { type: 'skill_invoked', skillName: event.data?.skillName });
  });
  session.on('subagent.failed', (event: any) => {
    poolSend(entry, { type: 'subagent_failed', agentName: event.data?.agentName, error: event.data?.error });
  });
  session.on('subagent.selected', (event: any) => {
    poolSend(entry, { type: 'subagent_selected', agentName: event.data?.agentName });
  });
  session.on('subagent.deselected', (event: any) => {
    poolSend(entry, { type: 'subagent_deselected', agentName: event.data?.agentName });
  });
  session.on('session.model_change', (event: any) => {
    poolSend(entry, { type: 'model_changed', model: event.data?.model || event.data?.newModel, source: 'sdk' });
  });
  session.on('elicitation.requested', (event: any) => {
    poolSend(entry, { type: 'elicitation_requested', question: event.data?.question, choices: event.data?.choices, allowFreeform: event.data?.allowFreeform });
  });
  session.on('elicitation.completed', (event: any) => {
    poolSend(entry, { type: 'elicitation_completed', answer: event.data?.answer });
  });
  session.on('exit_plan_mode.requested', () => { poolSend(entry, { type: 'exit_plan_mode_requested' }); });
  session.on('exit_plan_mode.completed', () => { poolSend(entry, { type: 'exit_plan_mode_completed' }); });
  session.on('session.idle', (event: any) => {
    poolSend(entry, { type: 'session_idle', backgroundTasks: event.data?.backgroundTasks });
  });
  session.on('session.task_complete', (event: any) => {
    poolSend(entry, { type: 'task_complete', summary: event.data?.summary });
  });
  session.on('session.truncation', (event: any) => {
    poolSend(entry, {
      type: 'truncation',
      tokenLimit: event.data?.tokenLimit,
      preTruncationTokens: event.data?.preTruncationTokensInMessages,
      preTruncationMessages: event.data?.preTruncationMessagesLength,
      postTruncationTokens: event.data?.postTruncationTokensInMessages,
      postTruncationMessages: event.data?.postTruncationMessagesLength,
    });
  });
  session.on('tool.execution_partial_result', (event: any) => {
    poolSend(entry, { type: 'tool_partial_result', toolCallId: event.data?.toolCallId, partialOutput: event.data?.partialOutput });
  });
  session.on('session.context_changed', (event: any) => {
    poolSend(entry, {
      type: 'context_changed',
      cwd: event.data?.cwd,
      gitRoot: event.data?.gitRoot,
      repository: event.data?.repository,
      branch: event.data?.branch,
    });
  });
  session.on('session.workspace_file_changed', (event: any) => {
    poolSend(entry, { type: 'workspace_file_changed', path: event.data?.path, operation: event.data?.operation });
  });

  // Catch-all: log unhandled event types for debugging / future audit
  const handledTypes = new Set([
    'assistant.message_delta', 'assistant.reasoning_delta', 'assistant.reasoning',
    'assistant.intent', 'assistant.turn_start', 'assistant.turn_end', 'assistant.usage',
    'tool.execution_start', 'tool.execution_complete', 'tool.execution_progress',
    'tool.execution_partial_result',
    'session.mode_changed', 'session.error', 'session.title_changed',
    'session.warning', 'session.usage_info', 'session.info',
    'session.plan_changed', 'session.compaction_start', 'session.compaction_complete',
    'session.shutdown', 'session.model_change', 'session.idle', 'session.task_complete',
    'session.truncation', 'session.context_changed', 'session.workspace_file_changed',
    'subagent.started', 'subagent.completed', 'subagent.failed',
    'subagent.selected', 'subagent.deselected',
    'skill.invoked',
    'elicitation.requested', 'elicitation.completed',
    'exit_plan_mode.requested', 'exit_plan_mode.completed',
  ]);
  session.on((event: any) => {
    if (!handledTypes.has(event.type)) {
      console.log('[EVENT] unhandled SDK event:', event.type, JSON.stringify(event.data ?? {}).slice(0, 200));
    }
  });
}

function makeUserInputHandler(entry: PoolEntry) {
  return (request: any) => {
    return new Promise<{ answer: string; wasFreeform: boolean }>((resolve) => {
      entry.userInputResolve = resolve;
      poolSend(entry, {
        type: 'user_input_request',
        question: request.question,
        choices: request.choices,
        allowFreeform: request.allowFreeform ?? true,
      });
    });
  };
}

const PERMISSION_TIMEOUT_MS = 300_000; // 5 minutes

function extractPermissionDisplay(request: any): {
  kind: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
} {
  const kind: string = request.kind ?? 'unknown';

  switch (kind) {
    case 'shell':
      return {
        kind,
        toolName: request.fullCommandText ?? 'shell command',
        toolArgs: {
          ...(request.intention && { intention: request.intention }),
          ...(request.possiblePaths?.length && { paths: request.possiblePaths }),
          ...(request.possibleUrls?.length && { urls: request.possibleUrls.map((u: any) => u.url) }),
          ...(request.warning && { warning: request.warning }),
        },
      };
    case 'write':
      return {
        kind,
        toolName: request.fileName ?? 'file',
        toolArgs: {
          ...(request.intention && { intention: request.intention }),
          ...(request.diff && { diff: request.diff }),
        },
      };
    case 'read':
      return {
        kind,
        toolName: request.path ?? 'file',
        toolArgs: {
          ...(request.intention && { intention: request.intention }),
        },
      };
    case 'mcp':
      return {
        kind,
        toolName: request.toolName ?? request.toolTitle ?? request.serverName ?? 'mcp tool',
        toolArgs: request.args ?? {},
      };
    case 'url':
      return {
        kind,
        toolName: request.url ?? 'url',
        toolArgs: {
          ...(request.intention && { intention: request.intention }),
        },
      };
    case 'custom-tool':
      return {
        kind,
        toolName: request.toolName ?? 'custom tool',
        toolArgs: request.args ?? {},
      };
    case 'memory':
      return {
        kind,
        toolName: request.subject ?? 'memory',
        toolArgs: {
          ...(request.fact && { fact: request.fact }),
          ...(request.citations && { citations: request.citations }),
        },
      };
    default:
      return {
        kind,
        toolName: request.toolName ?? request.tool?.name ?? kind,
        toolArgs: request.args ?? request.tool?.args ?? {},
      };
  }
}

function makePermissionHandler(entry: PoolEntry) {
  return (request: any) => {
    const { kind, toolName, toolArgs } = extractPermissionDisplay(request);

    // Check remembered preferences keyed by kind (so "always allow shell" covers all shell cmds)
    const prefKey = kind;
    const remembered = entry.permissionPreferences.get(prefKey);
    if (remembered === 'allow') return Promise.resolve({ kind: 'approved' as const });
    if (remembered === 'deny') return Promise.resolve({ kind: 'denied-interactively-by-user' as const });

    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<{ kind: 'approved' } | { kind: 'denied-interactively-by-user'; feedback?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        entry.permissionResolve = null;
        resolve({ kind: 'denied-interactively-by-user', feedback: 'Permission request timed out' });
      }, PERMISSION_TIMEOUT_MS);

      entry.permissionResolve = (decision: string) => {
        clearTimeout(timeout);
        resolve(
          decision === 'allow'
            ? { kind: 'approved' }
            : { kind: 'denied-interactively-by-user', feedback: 'User denied' },
        );
      };

      poolSend(entry, {
        type: 'permission_request',
        requestId,
        kind,
        toolName,
        toolArgs,
      });
    });
  };
}

export function setupWebSocket(
  server: Server,
  sessionMiddleware: SessionMiddleware
): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat — detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: WebSocket & { isAlive?: boolean }) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    console.log('[WS-SERVER] New connection attempt from', req.socket.remoteAddress);
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });

    // Validate WebSocket origin
    const origin = req.headers.origin;
    if (origin && !config.isDev) {
      const baseOrigin = new URL(config.baseUrl).origin;
      if (origin !== baseOrigin) {
        logSecurity('warn', 'ws_forbidden_origin', { origin, expected: baseOrigin });
        ws.close(1008, 'Forbidden origin');
        return;
      }
    }

    // Extract Express session from the upgrade request
    await new Promise<void>((resolve) => {
      sessionMiddleware(req, {} as any, resolve);
    });

    const session = (req as any).session;
    console.log('[WS-SERVER] Session extracted:', !!session, 'token:', !!session?.githubToken, 'user:', session?.githubUser?.login);
    const auth = checkAuth(session);
    console.log('[WS-SERVER] Auth check result:', auth.authenticated, auth.error || 'ok');
    if (!auth.authenticated) {
      logSecurity('warn', 'ws_unauthorized', {
        ip: req.socket.remoteAddress,
        reason: auth.error,
      });
      ws.close(4001, auth.error ?? 'Unauthorized');
      return;
    }

    // Validate token is still valid with GitHub (catches revoked tokens)
    // Skip for tokens authenticated within the last 30 seconds (just validated by poll endpoint)
    const authAge = session.githubAuthTime ? Date.now() - session.githubAuthTime : Infinity;
    if (authAge > 30_000) {
      const validation = await validateGitHubToken(session.githubToken);
      if (!validation.valid && validation.reason === 'invalid_token') {
        logSecurity('warn', 'ws_token_revoked', { user: session.githubUser?.login });
        await clearAuth(session);
        ws.close(4001, 'Token revoked');
        return;
      }
      // Transient API errors are not treated as revocation — allow connection
    }

    const githubToken: string = session.githubToken;
    const userLogin: string = session.githubUser?.login || 'unknown';
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const rawTabId = reqUrl.searchParams.get('tabId') || 'default';
    const tabId = isValidTabId(rawTabId) ? rawTabId : 'default';
    const poolKey = `${userLogin}:${tabId}`;
    console.log('[WS-SERVER] Authenticated user:', userLogin, 'tab:', tabId, 'checking pool...');
    let entry = sessionPool.get(poolKey);

    if (entry) {
      console.log('[WS-SERVER] Existing pool entry found for', poolKey);
      // Reattach to existing pool entry
      if (entry.ws && entry.ws !== ws && entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.close(4002, 'Replaced by new connection');
      }
      if (entry.ttlTimer) {
        clearTimeout(entry.ttlTimer);
        entry.ttlTimer = null;
      }
      entry.ws = ws;

      // Replay buffered messages
      const buffer = entry.messageBuffer.splice(0);
      for (const msg of buffer) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }

      console.log('[WS-SERVER] Sending session_reconnected to', poolKey, 'hasSession:', !!entry.session);
      poolSend(entry, {
        type: 'session_reconnected',
        user: userLogin,
        hasSession: !!entry.session,
        isProcessing: entry.isProcessing,
      });
    } else {
      // Create new pool entry — enforce per-user session cap
      if (countUserSessions(userLogin) >= config.maxSessionsPerUser) {
        console.log('[WS-SERVER] Session cap reached for', userLogin, '— evicting oldest');
        await evictOldestUserSession(userLogin);
      }
      console.log('[WS-SERVER] Creating new pool entry for', poolKey);
      const client = createCopilotClient(githubToken, config.copilotConfigDir);
      entry = createPoolEntry(client, ws);
      sessionPool.set(poolKey, entry);

      console.log('[WS-SERVER] Sending connected to', poolKey);
      poolSend(entry, {
        type: 'connected',
        user: userLogin,
      });
    }

    // Capture entry reference for this connection's handlers
    const connectionEntry = entry;

    ws.on('close', (code: number, reason: Buffer) => {
      console.log('[WS-SERVER] Client disconnected:', poolKey, 'code:', code, 'reason:', reason?.toString());
      if (connectionEntry.ws === ws) {
        connectionEntry.ws = null;
        connectionEntry.ttlTimer = setTimeout(async () => {
          await destroyPoolEntry(connectionEntry);
          sessionPool.delete(poolKey);
        }, config.sessionPoolTtl);
      }
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log('[WS-SERVER] Message from', userLogin, ':', msg.type);

        if (!msg.type || !VALID_MESSAGE_TYPES.has(msg.type)) {
          poolSend(connectionEntry, { type: 'error', message: 'Unknown message type' });
          return;
        }

        switch (msg.type) {
          case 'new_session': {
            if (connectionEntry.session) {
              try { await connectionEntry.session.disconnect(); } catch { /* ignore */ }
              connectionEntry.session = null;
            }
            connectionEntry.userInputResolve = null;
            connectionEntry.permissionResolve = null;

            try {
              const customInstructions = typeof msg.customInstructions === 'string'
                ? msg.customInstructions.slice(0, 2000)
                : undefined;

              const excludedTools = Array.isArray(msg.excludedTools)
                ? msg.excludedTools.filter((t: unknown) => typeof t === 'string')
                : undefined;

              const infiniteSessions = msg.infiniteSessions && typeof msg.infiniteSessions === 'object'
                ? {
                    enabled: msg.infiniteSessions.enabled !== false,
                    ...(typeof msg.infiniteSessions.backgroundCompactionThreshold === 'number' && {
                      backgroundCompactionThreshold: Math.max(0, Math.min(1, msg.infiniteSessions.backgroundCompactionThreshold)),
                    }),
                    ...(typeof msg.infiniteSessions.bufferExhaustionThreshold === 'number' && {
                      bufferExhaustionThreshold: Math.max(0, Math.min(1, msg.infiniteSessions.bufferExhaustionThreshold)),
                    }),
                  }
                : undefined;

              const permissionMode = msg.mode === 'autopilot' ? 'approve_all' as const : 'prompt' as const;

              const customTools = Array.isArray(msg.customTools) ? msg.customTools.slice(0, 10) : undefined;

              const mcpServers = Array.isArray(msg.mcpServers)
                ? msg.mcpServers
                    .filter((s: unknown) => {
                      if (!s || typeof s !== 'object') return false;
                      const obj = s as Record<string, unknown>;
                      return (
                        typeof obj.name === 'string' &&
                        typeof obj.url === 'string' &&
                        (obj.type === 'http' || obj.type === 'sse') &&
                        typeof obj.headers === 'object' && obj.headers !== null &&
                        Array.isArray(obj.tools)
                      );
                    })
                    .slice(0, 10)
                    .map((s: unknown) => {
                      const obj = s as Record<string, unknown>;
                      return {
                        name: obj.name as string,
                        url: obj.url as string,
                        type: obj.type as 'http' | 'sse',
                        headers: obj.headers as Record<string, string>,
                        tools: (obj.tools as unknown[]).filter((t): t is string => typeof t === 'string'),
                      };
                    })
                : undefined;

              connectionEntry.session = await createCopilotSession(connectionEntry.client, githubToken, {
                model: msg.model,
                reasoningEffort: msg.reasoningEffort,
                customInstructions,
                excludedTools,
                customTools,
                infiniteSessions,
                onUserInputRequest: makeUserInputHandler(connectionEntry),
                permissionMode,
                onPermissionRequest: makePermissionHandler(connectionEntry),
                mcpServers,
                configDir: config.copilotConfigDir,
              });

              wireSessionEvents(connectionEntry.session, connectionEntry, connectionEntry.session?.sessionId);

              // Set initial mode on the SDK session
              if (msg.mode && VALID_MODES.has(msg.mode)) {
                try {
                  await connectionEntry.session.rpc.mode.set({ mode: msg.mode });
                } catch (modeErr: any) {
                  console.warn('Initial mode set failed:', modeErr.message);
                }
              }

              poolSend(connectionEntry, {
                type: 'session_created',
                model: msg.model,
                sessionId: connectionEntry.session?.sessionId,
              });
            } catch (err: any) {
              console.error('Session creation error:', err.message);
              poolSend(connectionEntry, {
                type: 'error',
                message: `Failed to create session: ${err.message}`,
              });
            }
            break;
          }

          case 'message': {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content.trim() || content.length > MAX_MESSAGE_LENGTH) {
              poolSend(connectionEntry, { type: 'error', message: `Message must be 1-${MAX_MESSAGE_LENGTH} characters` });
              return;
            }

            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }

            const attachments = Array.isArray(msg.attachments)
              ? msg.attachments
                  .filter((a: unknown) => {
                    const att = a as Record<string, unknown>;
                    return typeof att.path === 'string' && typeof att.name === 'string';
                  })
                  .map((a: unknown) => {
                    const att = a as Record<string, unknown>;
                    return {
                      type: 'file' as const,
                      path: att.path as string,
                      displayName: att.name as string,
                    };
                  })
              : undefined;

            connectionEntry.isProcessing = true;
            await connectionEntry.session.send({
              prompt: content,
              ...(attachments?.length ? { attachments } : {}),
            });
            break;
          }

          case 'list_models': {
            const models = await getAvailableModels(connectionEntry.client);
            const modelArray = Array.isArray(models) ? models : [];
            poolSend(connectionEntry, { type: 'models', models: modelArray });
            break;
          }

          case 'set_mode': {
            const mode = msg.mode;
            if (!mode || !VALID_MODES.has(mode)) {
              poolSend(connectionEntry, { type: 'error', message: 'Invalid mode. Use: interactive, plan, or autopilot' });
              return;
            }

            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }

            try {
              await connectionEntry.session.rpc.mode.set({ mode });

              // Update permission handler: autopilot auto-approves, others prompt the user
              if (mode === 'autopilot') {
                connectionEntry.session.registerPermissionHandler(approveAll);
              } else {
                connectionEntry.session.registerPermissionHandler(makePermissionHandler(connectionEntry));
              }

              // Note: mode_changed is sent by the SDK event handler (session.mode_changed)
            } catch (err: any) {
              console.error('Mode switch error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to switch mode: ${err.message}` });
            }
            break;
          }

          case 'abort': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session.' });
              return;
            }
            try {
              await connectionEntry.session.abort();
              connectionEntry.isProcessing = false;

              // Resolve any dangling input/permission promises to prevent leaks
              if (connectionEntry.userInputResolve) {
                const resolve = connectionEntry.userInputResolve;
                connectionEntry.userInputResolve = null;
                resolve({ answer: '', wasFreeform: false });
              }
              if (connectionEntry.permissionResolve) {
                const resolve = connectionEntry.permissionResolve;
                connectionEntry.permissionResolve = null;
                resolve('deny');
              }

              poolSend(connectionEntry, { type: 'aborted' });
            } catch (err: any) {
              console.error('Abort error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to abort: ${err.message}` });
            }
            break;
          }

          case 'set_model': {
            const newModel = typeof msg.model === 'string' ? msg.model.trim() : '';
            if (!newModel) {
              poolSend(connectionEntry, { type: 'error', message: 'Model ID is required' });
              return;
            }
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await connectionEntry.session.setModel(newModel);
              // Note: model_changed is sent by the SDK event handler (session.model_change)
            } catch (err: any) {
              console.error('Model change error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to change model: ${err.message}` });
            }
            break;
          }

          case 'set_reasoning': {
            const effort = msg.effort as string;
            if (!effort || !VALID_REASONING.has(effort)) {
              poolSend(connectionEntry, { type: 'error', message: 'Invalid reasoning effort. Use: low, medium, high, or xhigh' });
              return;
            }
            poolSend(connectionEntry, { type: 'reasoning_changed', effort });
            break;
          }

          case 'user_input_response': {
            if (!connectionEntry.userInputResolve) {
              poolSend(connectionEntry, { type: 'error', message: 'No pending input request' });
              return;
            }
            const answer = typeof msg.answer === 'string' ? msg.answer : '';
            if (!answer.trim()) {
              poolSend(connectionEntry, { type: 'error', message: 'Answer is required' });
              return;
            }
            const resolve = connectionEntry.userInputResolve;
            connectionEntry.userInputResolve = null;
            resolve({ answer, wasFreeform: msg.wasFreeform ?? true });
            break;
          }

          case 'permission_response': {
            if (!connectionEntry.permissionResolve) {
              poolSend(connectionEntry, { type: 'error', message: 'No pending permission request' });
              return;
            }
            const decision = msg.decision;
            if (!['allow', 'deny', 'always_allow', 'always_deny'].includes(decision)) {
              poolSend(connectionEntry, { type: 'error', message: 'Invalid decision' });
              return;
            }
            // Key preferences by kind so "always allow shell" covers all shell commands
            const prefKey = msg.kind ?? msg.toolName;
            if (decision === 'always_allow') {
              connectionEntry.permissionPreferences.set(prefKey, 'allow');
            }
            if (decision === 'always_deny') {
              connectionEntry.permissionPreferences.set(prefKey, 'deny');
            }
            const permResolve = connectionEntry.permissionResolve;
            connectionEntry.permissionResolve = null;
            permResolve(decision.replace('always_', ''));
            break;
          }

          case 'list_tools': {
            try {
              const model = typeof msg.model === 'string' ? msg.model : undefined;
              const result = await connectionEntry.client.rpc.tools.list({ model });
              poolSend(connectionEntry, { type: 'tools', tools: result?.tools || [] });
            } catch (err: any) {
              console.error('List tools error:', err.message);
              poolSend(connectionEntry, { type: 'tools', tools: [] });
            }
            break;
          }

          case 'list_agents': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const agents = await connectionEntry.session.rpc.agent.list();
              let current = null;
              try {
                current = await connectionEntry.session.rpc.agent.getCurrent();
              } catch { /* no current agent */ }
              poolSend(connectionEntry, { type: 'agents', agents: agents?.agents || [], current: current?.agent || null });
            } catch (err: any) {
              console.error('List agents error:', err.message);
              poolSend(connectionEntry, { type: 'agents', agents: [], current: null });
            }
            break;
          }

          case 'select_agent': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            const agentName = typeof msg.name === 'string' ? msg.name.trim() : '';
            if (!agentName) {
              poolSend(connectionEntry, { type: 'error', message: 'Agent name is required' });
              return;
            }
            try {
              await connectionEntry.session.rpc.agent.select({ name: agentName });
              poolSend(connectionEntry, { type: 'agent_changed', agent: agentName });
            } catch (err: any) {
              console.error('Select agent error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to select agent: ${err.message}` });
            }
            break;
          }

          case 'deselect_agent': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await connectionEntry.session.rpc.agent.deselect();
              poolSend(connectionEntry, { type: 'agent_changed', agent: null });
            } catch (err: any) {
              console.error('Deselect agent error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to deselect agent: ${err.message}` });
            }
            break;
          }

          case 'get_quota': {
            try {
              const result = await connectionEntry.client.rpc.account.getQuota();
              poolSend(connectionEntry, {
                type: 'quota',
                quotaSnapshots: normalizeQuotaSnapshots(result.quotaSnapshots),
              });
            } catch (err: any) {
              console.error('Get quota error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to get quota: ${err.message}` });
            }
            break;
          }

          case 'compact': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const result = await connectionEntry.session.rpc.compaction.compact();
              poolSend(connectionEntry, { type: 'compaction_result', ...result });
            } catch (err: any) {
              console.error('Compaction error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to compact: ${err.message}` });
            }
            break;
          }

          case 'list_sessions': {
            try {
              // start() is idempotent — no-op if already connected
              console.log('[DEBUG list_sessions] Starting client…');
              await connectionEntry.client.start();
              console.log('[DEBUG list_sessions] client.listSessions()…');
              const sessions = await connectionEntry.client.listSessions();
              const rawList = Array.isArray(sessions) ? sessions : [];
              console.log('[DEBUG list_sessions] SDK returned', rawList.length, 'sessions');

              // Enrich each session with filesystem metadata in parallel
              const sdkSessions = await Promise.all(
                rawList.map(async (s: any) => {
                  const id = s.sessionId ?? s.id;
                  const enriched = await enrichSessionMetadata(id, s.context, s.isRemote);
                  return {
                    id,
                    title: s.summary ?? s.title,
                    updatedAt: s.modifiedTime ?? s.updatedAt,
                    model: s.model,
                    source: 'sdk' as const,
                    ...enriched,
                  };
                }),
              );

              // Merge with filesystem sessions the SDK may not know about
              // (e.g. bundled sessions copied into a fresh container)
              console.log('[DEBUG list_sessions] Scanning filesystem…');
              const fsSessions = await listSessionsFromFilesystem();
              console.log('[DEBUG list_sessions] Filesystem found', fsSessions.length, 'sessions');
              const sdkIds = new Set(sdkSessions.map((s) => s.id));
              const extraSessions = fsSessions.filter((s) => !sdkIds.has(s.id)).map((s) => ({ ...s, source: 'filesystem' as const }));
              const list = [...sdkSessions, ...extraSessions];
              console.log('[DEBUG list_sessions] Sending', list.length, 'total (SDK:', sdkSessions.length, '+ FS extra:', extraSessions.length, ')');

              poolSend(connectionEntry, { type: 'sessions', sessions: list });
            } catch (err: any) {
              console.error('[DEBUG list_sessions] SDK error:', err.message);
              // SDK failed — fall back to filesystem-only listing
              try {
                const fsSessions = await listSessionsFromFilesystem();
                console.log('[DEBUG list_sessions] Fallback: filesystem found', fsSessions.length, 'sessions');
                poolSend(connectionEntry, { type: 'sessions', sessions: fsSessions.map((s) => ({ ...s, source: 'filesystem' as const })) });
              } catch (fsErr: any) {
                console.error('[DEBUG list_sessions] Filesystem fallback also failed:', fsErr.message);
                poolSend(connectionEntry, { type: 'sessions', sessions: [] });
              }
            }
            break;
          }

          case 'delete_session': {
            const deleteId = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : '';
            if (!deleteId) {
              poolSend(connectionEntry, { type: 'error', message: 'Session ID is required' });
              return;
            }

            // Prevent deleting the active session
            if (connectionEntry.session?.sessionId === deleteId) {
              poolSend(connectionEntry, { type: 'error', message: 'Cannot delete the active session' });
              return;
            }

            try {
              await connectionEntry.client.deleteSession(deleteId);
              poolSend(connectionEntry, { type: 'session_deleted', sessionId: deleteId });
            } catch (err: any) {
              // SDK doesn't know this session — try filesystem deletion
              // (e.g. bundled or filesystem-only sessions)
              try {
                const deleted = await deleteSessionFromFilesystem(deleteId);
                if (deleted) {
                  poolSend(connectionEntry, { type: 'session_deleted', sessionId: deleteId });
                } else {
                  poolSend(connectionEntry, { type: 'error', message: `Session not found: ${deleteId}` });
                }
              } catch (fsErr: any) {
                console.error('Delete session error:', err.message, '| Filesystem fallback:', fsErr.message);
                poolSend(connectionEntry, { type: 'error', message: `Failed to delete session: ${err.message}` });
              }
            }
            break;
          }

          case 'get_session_detail': {
            const detailId = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : '';
            console.log('[DEBUG get_session_detail] Requested:', JSON.stringify(detailId));
            if (!detailId) {
              console.log('[DEBUG get_session_detail] Empty ID, sending error');
              poolSend(connectionEntry, { type: 'error', message: 'Session ID is required' });
              return;
            }

            try {
              console.log('[DEBUG get_session_detail] Calling getSessionDetail…');
              const detail = await getSessionDetail(detailId);
              console.log('[DEBUG get_session_detail] Result:', detail ? `found (id=${detail.id})` : 'null');
              if (!detail) {
                poolSend(connectionEntry, { type: 'error', message: 'Session not found' });
                return;
              }
              poolSend(connectionEntry, { type: 'session_detail', detail });
              console.log('[DEBUG get_session_detail] Sent session_detail response');
            } catch (err: any) {
              console.error('[DEBUG get_session_detail] Error:', err.message, err.stack);
              poolSend(connectionEntry, { type: 'error', message: `Failed to get session detail: ${err.message}` });
            }
            break;
          }

          case 'resume_session': {
            const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : '';
            if (!sessionId) {
              poolSend(connectionEntry, { type: 'error', message: 'Session ID is required' });
              return;
            }

            if (connectionEntry.session) {
              try { await connectionEntry.session.disconnect(); } catch { /* ignore */ }
              connectionEntry.session = null;
            }
            connectionEntry.userInputResolve = null;
            connectionEntry.permissionResolve = null;

            try {
              // start() is idempotent — ensures the SDK has indexed all local sessions
              await connectionEntry.client.start();

              const resolvedConfigDir = config.copilotConfigDir || join((await import('node:os')).homedir(), '.copilot');

              // Read filesystem plan for injection into resumed session context
              const detail = await getSessionDetail(sessionId);

              let resumed = false;

              // Try native SDK resume first
              try {
                connectionEntry.session = await connectionEntry.client.resumeSession(sessionId, {
                  onPermissionRequest: (await import('@github/copilot-sdk')).approveAll,
                  streaming: true,
                  onUserInputRequest: makeUserInputHandler(connectionEntry),
                  configDir: resolvedConfigDir,
                  ...(detail?.plan && {
                    systemMessage: {
                      mode: 'append' as const,
                      content: `## Current Plan\n${detail.plan}`,
                    },
                  }),
                });
                resumed = true;
              } catch (resumeErr: any) {
                console.log(`[RESUME] SDK resumeSession failed for ${sessionId}: ${resumeErr.message}`);
              }

              // Fallback: create a new session with context from the filesystem session
              if (!resumed) {
                console.log(`[RESUME] Attempting context-based fallback for ${sessionId}…`);
                const context = await buildSessionContext(sessionId);
                if (!context) {
                  throw new Error(`Session not found: ${sessionId}`);
                }

                connectionEntry.session = await createCopilotSession(connectionEntry.client, githubToken, {
                  customInstructions: context,
                  onUserInputRequest: makeUserInputHandler(connectionEntry),
                  permissionMode: 'approve_all',
                  configDir: resolvedConfigDir,
                });
                console.log(`[RESUME] Fallback session created for ${sessionId} with context injection`);
              }

              wireSessionEvents(connectionEntry.session, connectionEntry, sessionId);

              // Read and send the restored session's mode to the client
              try {
                const modeResult = await connectionEntry.session.rpc.mode.get();
                if (modeResult?.mode && VALID_MODES.has(modeResult.mode)) {
                  poolSend(connectionEntry, { type: 'mode_changed', mode: modeResult.mode });
                  // Restore correct permission handler for resumed mode
                  if (modeResult.mode === 'autopilot') {
                    connectionEntry.session.registerPermissionHandler(approveAll);
                  } else {
                    connectionEntry.session.registerPermissionHandler(makePermissionHandler(connectionEntry));
                  }
                }
              } catch {
                // Non-critical: mode will default to interactive on client
              }

              // Restore the plan INTO the SDK so the agent's tools can access it
              if (detail?.plan) {
                try {
                  await connectionEntry.session.rpc.plan.update({ content: detail.plan });
                  console.log(`[RESUME] Plan restored into SDK for session ${sessionId}`);
                } catch (planErr: any) {
                  console.warn(`[RESUME] Failed to restore plan into SDK: ${planErr.message}`);
                }
              }

              // Read and send the restored session's plan to the client
              try {
                const planResult = await connectionEntry.session.rpc.plan.read();
                if (planResult?.exists) {
                  poolSend(connectionEntry, { type: 'plan', exists: true, content: planResult.content, path: planResult.path });
                }
              } catch {
                // Non-critical: plan panel will stay hidden
              }

              poolSend(connectionEntry, { type: 'session_resumed', sessionId });
            } catch (err: any) {
              console.error('Resume session error:', err.message);
              console.error('Resume session stack:', err.stack);
              poolSend(connectionEntry, { type: 'error', message: `Failed to resume session: ${err.message}` });
            }
            break;
          }

          case 'get_plan': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const result = await connectionEntry.session.rpc.plan.read();
              poolSend(connectionEntry, { type: 'plan', exists: result?.exists ?? false, content: result?.content, path: result?.path });
            } catch (err: any) {
              console.error('Get plan error:', err.message);
              poolSend(connectionEntry, { type: 'plan', exists: false });
            }
            break;
          }

          case 'update_plan': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            const planContent = typeof msg.content === 'string' ? msg.content : '';
            try {
              await connectionEntry.session.rpc.plan.update({ content: planContent });
              poolSend(connectionEntry, { type: 'plan_updated' });
            } catch (err: any) {
              console.error('Update plan error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to update plan: ${err.message}` });
            }
            break;
          }

          case 'delete_plan': {
            if (!connectionEntry.session) {
              poolSend(connectionEntry, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await connectionEntry.session.rpc.plan.delete();
              poolSend(connectionEntry, { type: 'plan_deleted' });
            } catch (err: any) {
              console.error('Delete plan error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to delete plan: ${err.message}` });
            }
            break;
          }
        }
      } catch (err: any) {
        console.error('WS message error:', err.message);
        connectionEntry.isProcessing = false;
        const errMsg = err?.message || 'An internal error occurred';
        const isTimeout = typeof errMsg === 'string' && errMsg.toLowerCase().includes('timeout');
        poolSend(connectionEntry, {
          type: 'error',
          message: isTimeout
            ? `Request timed out. The model took too long to respond — try again or start a new session. (${errMsg})`
            : errMsg,
        });
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });
  });
}
