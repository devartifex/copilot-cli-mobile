import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { createCopilotClient } from '../copilot/client.js';
import { createCopilotSession, getAvailableModels } from '../copilot/session.js';
import { config } from '../config.js';
import { logSecurity } from '../security-log.js';

type SessionMiddleware = (req: any, res: any, next: () => void) => void;

const MAX_MESSAGE_LENGTH = 10_000;
const VALID_MESSAGE_TYPES = new Set([
  'new_session', 'message', 'list_models', 'set_mode',
  'abort', 'set_model', 'set_reasoning', 'user_input_response',
  'list_tools', 'list_agents', 'select_agent', 'deselect_agent',
  'get_quota', 'compact', 'list_sessions', 'resume_session',
  'get_plan', 'update_plan', 'delete_plan',
]);
const VALID_MODES = new Set(['interactive', 'plan', 'autopilot']);
const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function wireSessionEvents(session: any, ws: WebSocket): void {
  session.on('assistant.message_delta', (event: any) => {
    send(ws, { type: 'delta', content: event.data.deltaContent });
  });
  session.on('assistant.reasoning_delta', (event: any) => {
    send(ws, { type: 'reasoning_delta', content: event.data.deltaContent, reasoningId: event.data.reasoningId });
  });
  session.on('assistant.reasoning', (event: any) => {
    send(ws, { type: 'reasoning_done', reasoningId: event.data.reasoningId });
  });
  session.on('assistant.intent', (event: any) => {
    send(ws, { type: 'intent', intent: event.data.intent });
  });
  session.on('assistant.turn_start', () => { send(ws, { type: 'turn_start' }); });
  session.on('assistant.turn_end', () => { send(ws, { type: 'turn_end' }); });
  session.on('tool.execution_start', (event: any) => {
    send(ws, { type: 'tool_start', toolCallId: event.data.toolCallId, toolName: event.data.toolName, mcpServerName: event.data.mcpServerName, mcpToolName: event.data.mcpToolName });
  });
  session.on('tool.execution_complete', (event: any) => {
    send(ws, { type: 'tool_end', toolCallId: event.data.toolCallId });
  });
  session.on('tool.execution_progress', (event: any) => {
    send(ws, { type: 'tool_progress', toolCallId: event.data.toolCallId, message: event.data.message });
  });
  session.on('session.mode_changed', (event: any) => {
    send(ws, { type: 'mode_changed', mode: event.data.newMode });
  });
  session.on('session.error', (event: any) => {
    send(ws, { type: 'error', message: event.data.message });
  });
  session.on('session.title_changed', (event: any) => {
    send(ws, { type: 'title_changed', title: event.data.title });
  });
  session.on('assistant.usage', (event: any) => {
    send(ws, { type: 'usage', inputTokens: event.data.inputTokens, outputTokens: event.data.outputTokens, totalTokens: event.data.totalTokens, reasoningTokens: event.data.reasoningTokens });
  });
  session.on('session.warning', (event: any) => {
    send(ws, { type: 'warning', message: event.data.message });
  });
  session.on('subagent.started', (event: any) => {
    send(ws, { type: 'subagent_start', agentName: event.data.agentName });
  });
  session.on('subagent.completed', (event: any) => {
    send(ws, { type: 'subagent_end', agentName: event.data.agentName });
  });
  session.on('session.info', (event: any) => {
    send(ws, { type: 'info', message: event.data?.message || event.data });
  });
  session.on('session.plan_changed', (event: any) => {
    send(ws, { type: 'plan_changed', content: event.data?.content, path: event.data?.path });
  });
  session.on('session.compaction_start', () => { send(ws, { type: 'compaction_start' }); });
  session.on('session.compaction_complete', (event: any) => {
    send(ws, { type: 'compaction_complete', tokensRemoved: event.data?.tokensRemoved, messagesRemoved: event.data?.messagesRemoved });
  });
  session.on('skill.invoked', (event: any) => {
    send(ws, { type: 'skill_invoked', skillName: event.data?.skillName });
  });
  session.on('subagent.failed', (event: any) => {
    send(ws, { type: 'subagent_failed', agentName: event.data?.agentName, error: event.data?.error });
  });
  session.on('subagent.selected', (event: any) => {
    send(ws, { type: 'subagent_selected', agentName: event.data?.agentName });
  });
  session.on('subagent.deselected', (event: any) => {
    send(ws, { type: 'subagent_deselected', agentName: event.data?.agentName });
  });
  session.on('session.model_change', (event: any) => {
    send(ws, { type: 'model_changed', model: event.data?.model || event.data?.newModel, source: 'sdk' });
  });
  session.on('elicitation.requested', (event: any) => {
    send(ws, { type: 'elicitation_requested', question: event.data?.question, choices: event.data?.choices, allowFreeform: event.data?.allowFreeform });
  });
  session.on('elicitation.completed', (event: any) => {
    send(ws, { type: 'elicitation_completed', answer: event.data?.answer });
  });
  session.on('exit_plan_mode.requested', () => { send(ws, { type: 'exit_plan_mode_requested' }); });
  session.on('exit_plan_mode.completed', () => { send(ws, { type: 'exit_plan_mode_completed' }); });
}

export function setupWebSocket(
  server: Server,
  sessionMiddleware: SessionMiddleware
): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
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

    const githubToken: string = session.githubToken;
    const client = createCopilotClient(githubToken);
    let copilotSession: any = null;
    let userInputResolve: ((response: { answer: string; wasFreeform: boolean }) => void) | null = null;

    const cleanup = async () => {
      if (copilotSession) {
        try { await copilotSession.destroy(); } catch { /* ignore */ }
        copilotSession = null;
      }
      userInputResolve = null;
      try { await client.stop(); } catch { /* ignore */ }
    };

    ws.on('close', () => { cleanup(); });

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (!msg.type || !VALID_MESSAGE_TYPES.has(msg.type)) {
          send(ws, { type: 'error', message: 'Unknown message type' });
          return;
        }

        switch (msg.type) {
          case 'new_session': {
            if (copilotSession) {
              try { await copilotSession.destroy(); } catch { /* ignore */ }
              copilotSession = null;
            }
            userInputResolve = null;

            try {
              const customInstructions = typeof msg.customInstructions === 'string'
                ? msg.customInstructions.slice(0, 2000)
                : undefined;

              const excludedTools = Array.isArray(msg.excludedTools)
                ? msg.excludedTools.filter((t: unknown) => typeof t === 'string')
                : undefined;

              copilotSession = await createCopilotSession(client, githubToken, {
                model: msg.model,
                reasoningEffort: msg.reasoningEffort,
                customInstructions,
                excludedTools,
                onUserInputRequest: (request) => {
                  return new Promise((resolve) => {
                    userInputResolve = resolve;
                    send(ws, {
                      type: 'user_input_request',
                      question: request.question,
                      choices: request.choices,
                      allowFreeform: request.allowFreeform ?? true,
                    });
                  });
                },
              });

              wireSessionEvents(copilotSession, ws);

              send(ws, { type: 'session_created', model: msg.model });
            } catch (err: any) {
              console.error('Session creation error:', err.message);
              send(ws, {
                type: 'error',
                message: `Failed to create session: ${err.message}`,
              });
            }
            break;
          }

          case 'message': {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content.trim() || content.length > MAX_MESSAGE_LENGTH) {
              send(ws, { type: 'error', message: `Message must be 1-${MAX_MESSAGE_LENGTH} characters` });
              return;
            }

            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }

            await copilotSession.sendAndWait({ prompt: content });
            send(ws, { type: 'done' });
            break;
          }

          case 'list_models': {
            const models = await getAvailableModels(client);
            const modelArray = Array.isArray(models) ? models : [];
            send(ws, { type: 'models', models: modelArray });
            break;
          }

          case 'set_mode': {
            const mode = msg.mode;
            if (!mode || !VALID_MODES.has(mode)) {
              send(ws, { type: 'error', message: 'Invalid mode. Use: interactive, plan, or autopilot' });
              return;
            }

            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }

            try {
              const result = await copilotSession.rpc.mode.set({ mode });
              send(ws, { type: 'mode_changed', mode: result.mode });
            } catch (err: any) {
              console.error('Mode switch error:', err.message);
              send(ws, { type: 'error', message: `Failed to switch mode: ${err.message}` });
            }
            break;
          }

          case 'abort': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session.' });
              return;
            }
            try {
              await copilotSession.abort();
              send(ws, { type: 'aborted' });
            } catch (err: any) {
              console.error('Abort error:', err.message);
              send(ws, { type: 'error', message: `Failed to abort: ${err.message}` });
            }
            break;
          }

          case 'set_model': {
            const newModel = typeof msg.model === 'string' ? msg.model.trim() : '';
            if (!newModel) {
              send(ws, { type: 'error', message: 'Model ID is required' });
              return;
            }
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await copilotSession.setModel(newModel);
              send(ws, { type: 'model_changed', model: newModel });
            } catch (err: any) {
              console.error('Model change error:', err.message);
              send(ws, { type: 'error', message: `Failed to change model: ${err.message}` });
            }
            break;
          }

          case 'set_reasoning': {
            // Reasoning effort can only be set at session creation.
            // Store it so the next new_session picks it up.
            const effort = msg.effort as string;
            if (!effort || !VALID_REASONING.has(effort)) {
              send(ws, { type: 'error', message: 'Invalid reasoning effort. Use: low, medium, high, or xhigh' });
              return;
            }
            send(ws, { type: 'reasoning_changed', effort });
            break;
          }

          case 'user_input_response': {
            if (!userInputResolve) {
              send(ws, { type: 'error', message: 'No pending input request' });
              return;
            }
            const answer = typeof msg.answer === 'string' ? msg.answer : '';
            if (!answer.trim()) {
              send(ws, { type: 'error', message: 'Answer is required' });
              return;
            }
            const resolve = userInputResolve;
            userInputResolve = null;
            resolve({ answer, wasFreeform: msg.wasFreeform ?? true });
            break;
          }

          case 'list_tools': {
            try {
              const model = typeof msg.model === 'string' ? msg.model : undefined;
              const result = await client.rpc.tools.list({ model });
              send(ws, { type: 'tools', tools: result?.tools || [] });
            } catch (err: any) {
              console.error('List tools error:', err.message);
              send(ws, { type: 'tools', tools: [] });
            }
            break;
          }

          case 'list_agents': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const agents = await copilotSession.rpc.agent.list();
              let current = null;
              try {
                current = await copilotSession.rpc.agent.getCurrent();
              } catch { /* no current agent */ }
              send(ws, { type: 'agents', agents: agents?.agents || [], current: current?.agent || null });
            } catch (err: any) {
              console.error('List agents error:', err.message);
              send(ws, { type: 'agents', agents: [], current: null });
            }
            break;
          }

          case 'select_agent': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            const agentName = typeof msg.name === 'string' ? msg.name.trim() : '';
            if (!agentName) {
              send(ws, { type: 'error', message: 'Agent name is required' });
              return;
            }
            try {
              await copilotSession.rpc.agent.select({ name: agentName });
              send(ws, { type: 'agent_changed', agent: agentName });
            } catch (err: any) {
              console.error('Select agent error:', err.message);
              send(ws, { type: 'error', message: `Failed to select agent: ${err.message}` });
            }
            break;
          }

          case 'deselect_agent': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await copilotSession.rpc.agent.deselect();
              send(ws, { type: 'agent_changed', agent: null });
            } catch (err: any) {
              console.error('Deselect agent error:', err.message);
              send(ws, { type: 'error', message: `Failed to deselect agent: ${err.message}` });
            }
            break;
          }

          case 'get_quota': {
            try {
              const result = await client.rpc.account.getQuota();
              send(ws, { type: 'quota', ...result });
            } catch (err: any) {
              console.error('Get quota error:', err.message);
              send(ws, { type: 'error', message: `Failed to get quota: ${err.message}` });
            }
            break;
          }

          case 'compact': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const result = await copilotSession.rpc.compaction.compact();
              send(ws, { type: 'compaction_result', ...result });
            } catch (err: any) {
              console.error('Compaction error:', err.message);
              send(ws, { type: 'error', message: `Failed to compact: ${err.message}` });
            }
            break;
          }

          case 'list_sessions': {
            try {
              const sessions = await client.listSessions();
              send(ws, { type: 'sessions', sessions: Array.isArray(sessions) ? sessions : [] });
            } catch (err: any) {
              console.error('List sessions error:', err.message);
              send(ws, { type: 'sessions', sessions: [] });
            }
            break;
          }

          case 'resume_session': {
            const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : '';
            if (!sessionId) {
              send(ws, { type: 'error', message: 'Session ID is required' });
              return;
            }

            if (copilotSession) {
              try { await copilotSession.destroy(); } catch { /* ignore */ }
              copilotSession = null;
            }
            userInputResolve = null;

            try {
              copilotSession = await client.resumeSession(sessionId, {
                onPermissionRequest: (await import('@github/copilot-sdk')).approveAll,
                streaming: true,
                onUserInputRequest: (request: any) => {
                  return new Promise((resolve) => {
                    userInputResolve = resolve;
                    send(ws, {
                      type: 'user_input_request',
                      question: request.question,
                      choices: request.choices,
                      allowFreeform: request.allowFreeform ?? true,
                    });
                  });
                },
              });

              wireSessionEvents(copilotSession, ws);

              send(ws, { type: 'session_resumed', sessionId });
            } catch (err: any) {
              console.error('Resume session error:', err.message);
              send(ws, { type: 'error', message: `Failed to resume session: ${err.message}` });
            }
            break;
          }

          case 'get_plan': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              const result = await copilotSession.rpc.plan.read();
              send(ws, { type: 'plan', exists: result?.exists ?? false, content: result?.content, path: result?.path });
            } catch (err: any) {
              console.error('Get plan error:', err.message);
              send(ws, { type: 'plan', exists: false });
            }
            break;
          }

          case 'update_plan': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            const planContent = typeof msg.content === 'string' ? msg.content : '';
            try {
              await copilotSession.rpc.plan.update({ content: planContent });
              send(ws, { type: 'plan_updated' });
            } catch (err: any) {
              console.error('Update plan error:', err.message);
              send(ws, { type: 'error', message: `Failed to update plan: ${err.message}` });
            }
            break;
          }

          case 'delete_plan': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }
            try {
              await copilotSession.rpc.plan.delete();
              send(ws, { type: 'plan_deleted' });
            } catch (err: any) {
              console.error('Delete plan error:', err.message);
              send(ws, { type: 'error', message: `Failed to delete plan: ${err.message}` });
            }
            break;
          }
        }
      } catch (err: any) {
        console.error('WS message error:', err.message);
        send(ws, { type: 'error', message: 'An internal error occurred' });
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });

    send(ws, {
      type: 'connected',
      user: session.githubUser?.login,
    });
  });
}
