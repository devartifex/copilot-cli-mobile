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
]);
const VALID_MODES = new Set(['interactive', 'plan', 'autopilot']);
const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
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
              copilotSession = await createCopilotSession(client, githubToken, {
                model: msg.model,
                reasoningEffort: msg.reasoningEffort,
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

              copilotSession.on(
                'assistant.message_delta',
                (event: any) => {
                  send(ws, {
                    type: 'delta',
                    content: event.data.deltaContent,
                  });
                }
              );

              copilotSession.on(
                'assistant.reasoning_delta',
                (event: any) => {
                  send(ws, {
                    type: 'reasoning_delta',
                    content: event.data.deltaContent,
                    reasoningId: event.data.reasoningId,
                  });
                }
              );

              copilotSession.on(
                'assistant.reasoning',
                (event: any) => {
                  send(ws, {
                    type: 'reasoning_done',
                    reasoningId: event.data.reasoningId,
                  });
                }
              );

              copilotSession.on(
                'assistant.intent',
                (event: any) => {
                  send(ws, {
                    type: 'intent',
                    intent: event.data.intent,
                  });
                }
              );

              copilotSession.on(
                'assistant.turn_start',
                () => {
                  send(ws, { type: 'turn_start' });
                }
              );

              copilotSession.on(
                'assistant.turn_end',
                () => {
                  send(ws, { type: 'turn_end' });
                }
              );

              copilotSession.on(
                'tool.execution_start',
                (event: any) => {
                  send(ws, {
                    type: 'tool_start',
                    toolCallId: event.data.toolCallId,
                    toolName: event.data.toolName,
                    mcpServerName: event.data.mcpServerName,
                    mcpToolName: event.data.mcpToolName,
                  });
                }
              );

              copilotSession.on(
                'tool.execution_complete',
                (event: any) => {
                  send(ws, {
                    type: 'tool_end',
                    toolCallId: event.data.toolCallId,
                  });
                }
              );

              copilotSession.on(
                'tool.execution_progress',
                (event: any) => {
                  send(ws, {
                    type: 'tool_progress',
                    toolCallId: event.data.toolCallId,
                    message: event.data.message,
                  });
                }
              );

              copilotSession.on(
                'session.mode_changed',
                (event: any) => {
                  send(ws, {
                    type: 'mode_changed',
                    mode: event.data.newMode,
                  });
                }
              );

              copilotSession.on(
                'session.error',
                (event: any) => {
                  send(ws, {
                    type: 'error',
                    message: event.data.message,
                  });
                }
              );

              copilotSession.on(
                'session.title_changed',
                (event: any) => {
                  send(ws, {
                    type: 'title_changed',
                    title: event.data.title,
                  });
                }
              );

              copilotSession.on(
                'assistant.usage',
                (event: any) => {
                  send(ws, {
                    type: 'usage',
                    inputTokens: event.data.inputTokens,
                    outputTokens: event.data.outputTokens,
                    totalTokens: event.data.totalTokens,
                    reasoningTokens: event.data.reasoningTokens,
                  });
                }
              );

              copilotSession.on(
                'session.warning',
                (event: any) => {
                  send(ws, {
                    type: 'warning',
                    message: event.data.message,
                  });
                }
              );

              copilotSession.on(
                'subagent.started',
                (event: any) => {
                  send(ws, {
                    type: 'subagent_start',
                    agentName: event.data.agentName,
                  });
                }
              );

              copilotSession.on(
                'subagent.completed',
                (event: any) => {
                  send(ws, {
                    type: 'subagent_end',
                    agentName: event.data.agentName,
                  });
                }
              );

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
