import { CopilotClient } from '@github/copilot-sdk';

const clients = new Map<string, CopilotClient>();

export async function getCopilotClient(
  sessionId: string,
  githubToken: string
): Promise<CopilotClient> {
  let client = clients.get(sessionId);
  if (client) return client;

  client = new CopilotClient({
    githubToken,
    useLoggedInUser: false,
  });

  clients.set(sessionId, client);
  return client;
}

export async function destroyCopilotClient(
  sessionId: string
): Promise<void> {
  const client = clients.get(sessionId);
  if (client) {
    try {
      await client.stop();
    } catch {
      // ignore cleanup errors
    }
    clients.delete(sessionId);
  }
}
