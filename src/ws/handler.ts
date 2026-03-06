import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { createCopilotClient } from '../copilot/client.js';
import { createCopilotSession, getAvailableModels } from '../copilot/session.js';

type SessionMiddleware = (req: any, res: any, next: () => void) => void;

const MAX_MESSAGE_LENGTH = 10_000;
const VALID_MESSAGE_TYPES = new Set(['new_session', 'message', 'list_models']);

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
    // Extract Express session from the upgrade request
    await new Promise<void>((resolve) => {
      sessionMiddleware(req, {} as any, resolve);
    });

    const session = (req as any).session;
    if (!session?.githubToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const githubToken: string = session.githubToken;
    const client = createCopilotClient(githubToken);
    let copilotSession: any = null;

    const cleanup = async () => {
      if (copilotSession) {
        try { copilotSession.removeAllListeners?.(); } catch { /* ignore */ }
        copilotSession = null;
      }
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
              try { copilotSession.removeAllListeners?.(); } catch { /* ignore */ }
              copilotSession = null;
            }

            try {
              copilotSession = await createCopilotSession(client, msg.model);

              copilotSession.on(
                'assistant.message_delta',
                (event: any) => {
                  send(ws, {
                    type: 'delta',
                    content: event.data.deltaContent,
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
