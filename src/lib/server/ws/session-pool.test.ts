import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  cleanupAllSessions,
  cleanupUserSessions,
  countUserSessions,
  createPoolEntry,
  destroyPoolEntry,
  evictOldestUserSession,
  isValidTabId,
  poolSend,
  sessionPool,
} from './session-pool.js';

interface ClientMock {
  stop: ReturnType<typeof vi.fn>;
}

interface SessionMock {
  disconnect: ReturnType<typeof vi.fn>;
}

interface WsMock {
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
}

function createClientMock(): ClientMock {
  return {
    stop: vi.fn(async () => undefined),
  };
}

function createSessionMock(): SessionMock {
  return {
    disconnect: vi.fn(async () => undefined),
  };
}

function createWsMock(readyState: number = WebSocket.OPEN): WsMock {
  return {
    close: vi.fn(),
    readyState,
    send: vi.fn(),
  };
}

beforeEach(() => {
  sessionPool.clear();
  vi.useRealTimers();
});

afterEach(async () => {
  await cleanupAllSessions();
  sessionPool.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createPoolEntry', () => {
  it('creates a pool entry with the expected initial lifecycle state', () => {
    const client = createClientMock();
    const ws = createWsMock();

    const entry = createPoolEntry(client as never, ws as never);

    expect(entry).toMatchObject({
      client,
      session: null,
      ws,
      messageBuffer: [],
      ttlTimer: null,
      userInputResolve: null,
      permissionResolve: null,
      isProcessing: false,
    });
    expect(entry.permissionPreferences.size).toBe(0);
  });
});

describe('poolSend', () => {
  it('sends messages immediately when a websocket is open', () => {
    const entry = createPoolEntry(createClientMock() as never, createWsMock() as never);

    poolSend(entry, { type: 'delta', content: 'hello' });

    expect(entry.ws?.send).toHaveBeenCalledWith(JSON.stringify({ type: 'delta', content: 'hello' }));
    expect(entry.messageBuffer).toEqual([]);
  });

  it('buffers messages when the websocket is absent and keeps only the newest 500', () => {
    const entry = createPoolEntry(createClientMock() as never, createWsMock() as never);
    entry.ws = null;

    for (let index = 0; index < 550; index += 1) {
      poolSend(entry, { type: 'delta', index });
    }

    expect(entry.messageBuffer).toHaveLength(500);
    expect(entry.messageBuffer[0]).toEqual({ type: 'delta', index: 50 });
    expect(entry.messageBuffer.at(-1)).toEqual({ type: 'delta', index: 549 });
  });
});

describe('destroyPoolEntry', () => {
  it('clears TTL timers and disposes the session, client, and transient state', async () => {
    vi.useFakeTimers();

    const client = createClientMock();
    const ws = createWsMock();
    const entry = createPoolEntry(client as never, ws as never);
    const session = createSessionMock();
    let timerTriggered = false;

    entry.session = session;
    entry.userInputResolve = vi.fn();
    entry.permissionResolve = vi.fn();
    entry.permissionPreferences.set('shell', 'allow');
    entry.ttlTimer = setTimeout(() => {
      timerTriggered = true;
    }, 1000);

    await destroyPoolEntry(entry);
    await vi.advanceTimersByTimeAsync(1000);

    expect(timerTriggered).toBe(false);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(entry.session).toBeNull();
    expect(entry.ttlTimer).toBeNull();
    expect(entry.userInputResolve).toBeNull();
    expect(entry.permissionResolve).toBeNull();
    expect(entry.permissionPreferences.size).toBe(0);
  });

  it('swallows disconnect and stop errors during teardown', async () => {
    const client = createClientMock();
    const session = createSessionMock();
    client.stop.mockRejectedValue(new Error('stop failed'));
    session.disconnect.mockRejectedValue(new Error('disconnect failed'));

    const entry = createPoolEntry(client as never, createWsMock() as never);
    entry.session = session;

    await expect(destroyPoolEntry(entry)).resolves.toBeUndefined();
  });
});

describe('session pool cleanup', () => {
  it('cleanupAllSessions destroys and removes every pooled session', async () => {
    const aliceEntry = createPoolEntry(createClientMock() as never, createWsMock() as never);
    const bobEntry = createPoolEntry(createClientMock() as never, createWsMock() as never);
    aliceEntry.session = createSessionMock();
    bobEntry.session = createSessionMock();

    sessionPool.set('alice:tab-1', aliceEntry);
    sessionPool.set('bob:tab-1', bobEntry);

    await cleanupAllSessions();

    expect(sessionPool.size).toBe(0);
    expect(aliceEntry.client.stop).toHaveBeenCalledTimes(1);
    expect(bobEntry.client.stop).toHaveBeenCalledTimes(1);
  });

  it('cleanupUserSessions removes only entries for the targeted user', async () => {
    const aliceEntry = createPoolEntry(createClientMock() as never, createWsMock() as never);
    const bobEntry = createPoolEntry(createClientMock() as never, createWsMock() as never);

    sessionPool.set('alice:tab-1', aliceEntry);
    sessionPool.set('alice:tab-2', createPoolEntry(createClientMock() as never, createWsMock() as never));
    sessionPool.set('bob:tab-1', bobEntry);

    await cleanupUserSessions('alice');

    expect(sessionPool.has('alice:tab-1')).toBe(false);
    expect(sessionPool.has('alice:tab-2')).toBe(false);
    expect(sessionPool.get('bob:tab-1')).toBe(bobEntry);
  });

  it('ignores cleanup requests for users without active sessions', async () => {
    const entry = createPoolEntry(createClientMock() as never, createWsMock() as never);
    sessionPool.set('bob:tab-1', entry);

    await expect(cleanupUserSessions('alice')).resolves.toBeUndefined();
    expect(sessionPool.get('bob:tab-1')).toBe(entry);
  });

  it('counts pooled sessions per user', () => {
    sessionPool.set('alice:tab-1', createPoolEntry(createClientMock() as never, createWsMock() as never));
    sessionPool.set('alice:tab-2', createPoolEntry(createClientMock() as never, createWsMock() as never));
    sessionPool.set('bob:tab-1', createPoolEntry(createClientMock() as never, createWsMock() as never));

    expect(countUserSessions('alice')).toBe(2);
    expect(countUserSessions('bob')).toBe(1);
    expect(countUserSessions('charlie')).toBe(0);
  });
});

describe('eviction and map edge cases', () => {
  it('evicts the oldest disconnected session before active websocket sessions', async () => {
    const disconnected = createPoolEntry(createClientMock() as never, createWsMock(WebSocket.CLOSED) as never);
    const active = createPoolEntry(createClientMock() as never, createWsMock(WebSocket.OPEN) as never);

    sessionPool.set('alice:old', disconnected);
    sessionPool.set('alice:new', active);

    await evictOldestUserSession('alice');

    expect(sessionPool.has('alice:old')).toBe(false);
    expect(sessionPool.has('alice:new')).toBe(true);
    expect(disconnected.client.stop).toHaveBeenCalledTimes(1);
    expect(active.client.stop).not.toHaveBeenCalled();
  });

  it('falls back to insertion order when all candidate sessions are active', async () => {
    const first = createPoolEntry(createClientMock() as never, createWsMock(WebSocket.OPEN) as never);
    const second = createPoolEntry(createClientMock() as never, createWsMock(WebSocket.OPEN) as never);

    sessionPool.set('alice:first', first);
    sessionPool.set('alice:second', second);

    await evictOldestUserSession('alice');

    expect(sessionPool.has('alice:first')).toBe(false);
    expect(sessionPool.has('alice:second')).toBe(true);
  });

  it('allows replacing an existing key without increasing the per-user count', () => {
    const original = createPoolEntry(createClientMock() as never, createWsMock() as never);
    const replacement = createPoolEntry(createClientMock() as never, createWsMock() as never);

    sessionPool.set('alice:tab-1', original);
    sessionPool.set('alice:tab-1', replacement);

    expect(countUserSessions('alice')).toBe(1);
    expect(sessionPool.get('alice:tab-1')).toBe(replacement);
  });
});

describe('isValidTabId', () => {
  it('accepts safe tab IDs and rejects invalid characters or oversized values', () => {
    expect(isValidTabId('default')).toBe(true);
    expect(isValidTabId('tab_123-ABC')).toBe(true);
    expect(isValidTabId('x'.repeat(64))).toBe(true);

    expect(isValidTabId('x'.repeat(65))).toBe(false);
    expect(isValidTabId('tab id')).toBe(false);
    expect(isValidTabId('tab/123')).toBe(false);
    expect(isValidTabId('')).toBe(false);
  });
});
