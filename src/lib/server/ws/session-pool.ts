import { WebSocket } from 'ws';
import type { CopilotClient } from '@github/copilot-sdk';

const MAX_BUFFER_SIZE = 500;

export interface PoolEntry {
  client: CopilotClient;
  session: any;
  ws: WebSocket | null;
  messageBuffer: Record<string, unknown>[];
  ttlTimer: NodeJS.Timeout | null;
  userInputResolve: ((response: { answer: string; wasFreeform: boolean }) => void) | null;
  permissionResolve: ((decision: string) => void) | null;
  permissionPreferences: Map<string, 'allow' | 'deny'>;
  isProcessing: boolean;
}

export const sessionPool = new Map<string, PoolEntry>();

export function createPoolEntry(client: CopilotClient, ws: WebSocket): PoolEntry {
  return {
    client,
    session: null,
    ws,
    messageBuffer: [],
    ttlTimer: null,
    userInputResolve: null,
    permissionResolve: null,
    permissionPreferences: new Map(),
    isProcessing: false,
  };
}

export async function destroyPoolEntry(entry: PoolEntry): Promise<void> {
  if (entry.ttlTimer) {
    clearTimeout(entry.ttlTimer);
    entry.ttlTimer = null;
  }
  if (entry.session) {
    try { await entry.session.disconnect(); } catch { /* ignore */ }
    entry.session = null;
  }
  entry.userInputResolve = null;
  entry.permissionResolve = null;
  entry.permissionPreferences.clear();
  try { await entry.client.stop(); } catch { /* ignore */ }
}

export function poolSend(entry: PoolEntry, data: Record<string, unknown>): void {
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify(data));
  } else {
    if (entry.messageBuffer.length >= MAX_BUFFER_SIZE) {
      entry.messageBuffer.shift();
    }
    entry.messageBuffer.push(data);
  }
}

export async function cleanupAllSessions(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [key, entry] of sessionPool) {
    promises.push(destroyPoolEntry(entry));
    sessionPool.delete(key);
  }
  await Promise.allSettled(promises);
}
