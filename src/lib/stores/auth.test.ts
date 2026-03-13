import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthStore } from '$lib/stores/auth.svelte.js';

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('createAuthStore', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts with logged-out defaults', () => {
    const store = createAuthStore();

    expect(store.user).toBeNull();
    expect(store.authenticated).toBe(false);
    expect(store.deviceCode).toBeNull();
    expect(store.authStatus).toBe('idle');
    expect(store.countdown).toBe(0);
    expect(store.countdownFormatted).toBe('0:00');
    expect(store.errorMessage).toBe('');
    expect(store.spinnerChar).toBe('⠋');
  });

  it('hydrates auth status from the server and falls back to logged out on fetch failure', async () => {
    const store = createAuthStore();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        authenticated: true,
        user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
      }),
    );

    await store.checkStatus();

    expect(fetchMock).toHaveBeenCalledWith('/auth/status');
    expect(store.authenticated).toBe(true);
    expect(store.user).toEqual({ login: 'octocat', avatar_url: 'https://github.com/octocat.png' });

    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await store.checkStatus();

    expect(store.authenticated).toBe(false);
    expect(store.user).toBeNull();
  });

  it('runs the device flow through authorization, countdown, and spinner updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://github.com/login/device',
          expires_in: 30,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'authorized',
          user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
        }),
      );

    const store = createAuthStore();
    await store.startDeviceFlow();

    expect(store.authStatus).toBe('polling');
    expect(store.deviceCode).toEqual({
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 30,
      interval: 5,
    });
    expect(store.countdown).toBe(30);
    expect(store.countdownFormatted).toBe('0:30');

    const spinnerBefore = store.spinnerChar;
    await vi.advanceTimersByTimeAsync(100);
    expect(store.spinnerChar).not.toBe(spinnerBefore);

    await vi.advanceTimersByTimeAsync(900);
    expect(store.countdown).toBe(29);
    expect(store.countdownFormatted).toBe('0:29');

    await vi.advanceTimersByTimeAsync(4000);

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/auth/device/poll', { method: 'POST' });
    expect(store.authStatus).toBe('authorized');
    expect(store.authenticated).toBe(true);
    expect(store.user).toEqual({ login: 'octocat', avatar_url: 'https://github.com/octocat.png' });
  });

  it('backs off after slow_down responses before polling again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: 'SLOW-DOWN',
          verification_uri: 'https://github.com/login/device',
          expires_in: 60,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'slow_down' }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'authorized',
          user: { login: 'hubot', avatar_url: 'https://github.com/hubot.png' },
        }),
      );

    const store = createAuthStore();
    await store.startDeviceFlow();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.authStatus).toBe('polling');

    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.authStatus).toBe('authorized');
    expect(store.user).toEqual({ login: 'hubot', avatar_url: 'https://github.com/hubot.png' });
  });

  it.each([
    ['expired', 'expired'],
    ['access_denied', 'denied'],
  ] as const)('ends polling when the server reports %s', async (pollStatus, expectedStatus) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: 'WAITING',
          verification_uri: 'https://github.com/login/device',
          expires_in: 30,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: pollStatus }));

    const store = createAuthStore();
    await store.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(5000);

    expect(store.authStatus).toBe(expectedStatus);
    expect(store.authenticated).toBe(false);
    expect(store.user).toBeNull();
  });

  it('surfaces start-device-flow errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Missing GitHub client id' }));

    const store = createAuthStore();
    await store.startDeviceFlow();

    expect(store.authStatus).toBe('error');
    expect(store.errorMessage).toBe('Missing GitHub client id');
    expect(store.deviceCode).toBeNull();
  });

  it('resets auth state on logout even when the request fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: 'LOGOUT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 30,
          interval: 5,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'authorized',
          user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
        }),
      );

    const store = createAuthStore();
    await store.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(5000);

    fetchMock.mockRejectedValueOnce(new Error('logout failed'));
    await expect(store.logout()).rejects.toThrow('logout failed');

    expect(store.authenticated).toBe(false);
    expect(store.user).toBeNull();
    expect(store.authStatus).toBe('idle');
    expect(store.deviceCode).toBeNull();
  });

  it('clears timers when destroyed before the next poll fires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user_code: 'DESTROY',
        verification_uri: 'https://github.com/login/device',
        expires_in: 20,
        interval: 5,
      }),
    );

    const store = createAuthStore();
    await store.startDeviceFlow();
    store.destroy();

    await vi.advanceTimersByTimeAsync(6000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.countdown).toBe(20);
    expect(store.authStatus).toBe('polling');
  });
});
