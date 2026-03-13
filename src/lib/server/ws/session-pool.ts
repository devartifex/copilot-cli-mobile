import { WebSocket } from 'ws';
import type { CopilotClient } from '@github/copilot-sdk';
import { config } from '../config.js';

const MAX_BUFFER_SIZE = 500;
const TAB_ID_PATTERN = /^[a-z0-9_-]{1,64}$/i;

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

/** Validate that a tabId is a UUID-like string (max 36 chars, alphanumeric + hyphens) */
export function isValidTabId(tabId: string): boolean {
  return TAB_ID_PATTERN.test(tabId);
}

/** Destroy all pool entries for a specific user (e.g., on logout or token revocation) */
export async function cleanupUserSessions(username: string): Promise<void> {
  const prefix = `${username}:`;
  const promises: Promise<void>[] = [];
  for (const [key, entry] of sessionPool) {
    if (key.startsWith(prefix)) {
      promises.push(destroyPoolEntry(entry));
      sessionPool.delete(key);
    }
  }
  await Promise.allSettled(promises);
}

/** Count active pool entries for a specific user */
export function countUserSessions(username: string): number {
  const prefix = `${username}:`;
  let count = 0;
  for (const key of sessionPool.keys()) {
    if (key.startsWith(prefix)) count++;
  }
  return count;
}

/** Find and destroy the oldest pool entry for a user (the one with no active WS or earliest TTL) */
export async function evictOldestUserSession(username: string): Promise<void> {
  const prefix = `${username}:`;
  let oldestKey: string | null = null;
  let oldestHasWs = true;

  for (const [key, entry] of sessionPool) {
    if (!key.startsWith(prefix)) continue;
    // Prefer evicting entries without an active WebSocket
    const hasWs = entry.ws !== null && entry.ws.readyState === WebSocket.OPEN;
    if (oldestKey === null || (!hasWs && oldestHasWs)) {
      oldestKey = key;
      oldestHasWs = hasWs;
    }
  }

  if (oldestKey) {
    const entry = sessionPool.get(oldestKey);
    if (entry) {
      await destroyPoolEntry(entry);
      sessionPool.delete(oldestKey);
    }
  }
}
