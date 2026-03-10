import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { createCopilotClient } from '$lib/server/copilot/client';
import { createCopilotSession, getAvailableModels } from '$lib/server/copilot/session';
import { config } from '$lib/server/config';
import { logSecurity } from '$lib/server/security-log';
import { validateGitHubToken } from '$lib/server/auth/github';
import {
  sessionPool, createPoolEntry, destroyPoolEntry, poolSend,
  type PoolEntry,
} from '$lib/server/ws/session-pool';

type SessionMiddleware = (req: any, res: any, next: () => void) => void;

const MAX_MESSAGE_LENGTH = 10_000;
const VALID_MESSAGE_TYPES = new Set([
  'new_session', 'message', 'list_models', 'set_mode',
  'abort', 'set_model', 'set_reasoning', 'user_input_response',
  'list_tools', 'list_agents', 'select_agent', 'deselect_agent',
  'get_quota', 'compact', 'list_sessions', 'resume_session',
  'delete_session', 'get_plan', 'update_plan', 'delete_plan',
]);
const VALID_MODES = new Set(['interactive', 'plan', 'autopilot']);
const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);
const HEARTBEAT_INTERVAL = 30_000;

function wireSessionEvents(session: any, entry: PoolEntry): void {
  session.on('assistant.message_delta', (event: any) => {
    poolSend(entry, { type: 'delta', content: event.data.deltaContent });
  });
  session.on('assistant.reasoning_delta', (event: any) => {
    poolSend(entry, { type: 'reasoning_delta', content: event.data.deltaContent, reasoningId: event.data.reasoningId });
  });
  session.on('assistant.reasoning', (event: any) => {
    poolSend(entry, { type: 'reasoning_done', reasoningId: event.data.reasoningId });
  });
  session.on('assistant.intent', (event: any) => {
    poolSend(entry, { type: 'intent', intent: event.data.intent });
  });
  session.on('assistant.turn_start', () => { poolSend(entry, { type: 'turn_start' }); });
  session.on('assistant.turn_end', () => {
    entry.isProcessing = false;
    poolSend(entry, { type: 'turn_end' });
  });
  session.on('tool.execution_start', (event: any) => {
    poolSend(entry, { type: 'tool_start', toolCallId: event.data.toolCallId, toolName: event.data.toolName, mcpServerName: event.data.mcpServerName, mcpToolName: event.data.mcpToolName });
  });
  session.on('tool.execution_complete', (event: any) => {
    poolSend(entry, { type: 'tool_end', toolCallId: event.data.toolCallId });
  });
  session.on('tool.execution_progress', (event: any) => {
    poolSend(entry, { type: 'tool_progress', toolCallId: event.data.toolCallId, message: event.data.message });
  });
  session.on('session.mode_changed', (event: any) => {
    poolSend(entry, { type: 'mode_changed', mode: event.data.newMode });
  });
  session.on('session.error', (event: any) => {
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
      cost: event.data.cost,
      quotaSnapshots: event.data.quotaSnapshots,
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
  });
  session.on('session.compaction_start', () => { poolSend(entry, { type: 'compaction_start' }); });
  session.on('session.compaction_complete', (event: any) => {
    poolSend(entry, { type: 'compaction_complete', tokensRemoved: event.data?.tokensRemoved, messagesRemoved: event.data?.messagesRemoved });
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
    if (!session?.githubToken) {
      logSecurity('warn', 'ws_unauthorized', { ip: req.socket.remoteAddress });
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Token freshness check for WebSocket connections
    const authTime = session.githubAuthTime;
    if (authTime && Date.now() - authTime > config.tokenMaxAge) {
      logSecurity('info', 'ws_token_expired', { user: session.githubUser?.login });
      ws.close(4001, 'Session expired');
      return;
    }

    // Validate token is still valid with GitHub (catches revoked tokens)
    const tokenUser = await validateGitHubToken(session.githubToken);
    if (!tokenUser) {
      logSecurity('warn', 'ws_token_revoked', { user: session.githubUser?.login });
      session.destroy(() => {});
      ws.close(4001, 'Token revoked');
      return;
    }

    const githubToken: string = session.githubToken;
    const userLogin: string = session.githubUser?.login || 'unknown';
    let entry = sessionPool.get(userLogin);

    if (entry) {
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

      poolSend(entry, {
        type: 'session_reconnected',
        user: userLogin,
        hasSession: !!entry.session,
        isProcessing: entry.isProcessing,
      });
    } else {
      // Create new pool entry
      const client = createCopilotClient(githubToken);
      entry = createPoolEntry(client, ws);
      sessionPool.set(userLogin, entry);

      poolSend(entry, {
        type: 'connected',
        user: userLogin,
      });
    }

    // Capture entry reference for this connection's handlers
    const connectionEntry = entry;

    ws.on('close', () => {
      if (connectionEntry.ws === ws) {
        connectionEntry.ws = null;
        connectionEntry.ttlTimer = setTimeout(async () => {
          await destroyPoolEntry(connectionEntry);
          sessionPool.delete(userLogin);
        }, config.sessionPoolTtl);
      }
    });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

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

              connectionEntry.session = await createCopilotSession(connectionEntry.client, githubToken, {
                model: msg.model,
                reasoningEffort: msg.reasoningEffort,
                customInstructions,
                excludedTools,
                infiniteSessions,
                onUserInputRequest: makeUserInputHandler(connectionEntry),
              });

              wireSessionEvents(connectionEntry.session, connectionEntry);

              poolSend(connectionEntry, { type: 'session_created', model: msg.model });
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

            connectionEntry.isProcessing = true;
            await connectionEntry.session.sendAndWait({ prompt: content });
            connectionEntry.isProcessing = false;
            poolSend(connectionEntry, { type: 'done' });
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
              const result = await connectionEntry.session.rpc.mode.set({ mode });
              poolSend(connectionEntry, { type: 'mode_changed', mode: result.mode });
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
              poolSend(connectionEntry, { type: 'model_changed', model: newModel });
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
              poolSend(connectionEntry, { type: 'quota', ...result });
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
              const sessions = await connectionEntry.client.listSessions();
              const list = Array.isArray(sessions) ? sessions.map((s: any) => ({
                id: s.sessionId ?? s.id,
                title: s.summary ?? s.title,
                updatedAt: s.modifiedTime ?? s.updatedAt,
                model: s.model,
              })) : [];
              poolSend(connectionEntry, { type: 'sessions', sessions: list });
            } catch (err: any) {
              console.error('List sessions error:', err.message);
              poolSend(connectionEntry, { type: 'sessions', sessions: [] });
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
              console.error('Delete session error:', err.message);
              poolSend(connectionEntry, { type: 'error', message: `Failed to delete session: ${err.message}` });
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

            try {
              connectionEntry.session = await connectionEntry.client.resumeSession(sessionId, {
                onPermissionRequest: (await import('@github/copilot-sdk')).approveAll,
                streaming: true,
                onUserInputRequest: makeUserInputHandler(connectionEntry),
              });

              wireSessionEvents(connectionEntry.session, connectionEntry);

              poolSend(connectionEntry, { type: 'session_resumed', sessionId });
            } catch (err: any) {
              console.error('Resume session error:', err.message);
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
        poolSend(connectionEntry, { type: 'error', message: 'An internal error occurred' });
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });
  });
}
