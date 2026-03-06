import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import { getCopilotClient } from '../copilot/client';
import { createCopilotSession, getAvailableModels } from '../copilot/session';

type SessionMiddleware = (req: any, res: any, next: () => void) => void;

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
    // Parse Express session from upgrade request cookies
    const fakeRes = {
      setHeader: () => fakeRes,
      getHeader: () => undefined,
      end: () => {},
    } as any;

    await new Promise<void>((resolve) => {
      sessionMiddleware(req, fakeRes, resolve);
    });

    const session = (req as any).session;
    if (!session?.azureAccount || !session?.githubToken) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const githubToken: string = session.githubToken;
    const sessionId: string = session.id;
    let copilotSession: any = null;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'new_session': {
            const client = await getCopilotClient(sessionId, githubToken);
            copilotSession = await createCopilotSession(client, githubToken, msg.model);

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
            break;
          }

          case 'message': {
            if (!copilotSession) {
              send(ws, { type: 'error', message: 'No active session. Send new_session first.' });
              return;
            }

            await copilotSession.sendAndWait({ prompt: msg.content });
            send(ws, { type: 'done' });
            break;
          }

          case 'list_models': {
            const client = await getCopilotClient(sessionId, githubToken);
            const models = await getAvailableModels(client);
            send(ws, { type: 'models', models });
            break;
          }

          default:
            send(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
        }
      } catch (err: any) {
        console.error('WS message error:', err);
        send(ws, { type: 'error', message: err.message || 'Internal error' });
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
