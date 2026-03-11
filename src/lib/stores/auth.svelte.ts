export interface DeviceCodeState {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type AuthStatus = 'idle' | 'polling' | 'authorized' | 'expired' | 'denied' | 'error';

export interface AuthUser {
  login: string;
  avatar_url: string;
}

interface PollResponse {
  status: string;
  user?: AuthUser;
  githubUser?: string;
  error?: string;
}

export type AuthStore = ReturnType<typeof createAuthStore>;

export function createAuthStore() {
  let user = $state<AuthUser | null>(null);
  let authenticated = $state(false);
  let deviceCode = $state<DeviceCodeState | null>(null);
  let authStatus = $state<AuthStatus>('idle');
  let countdown = $state(0);
  let errorMessage = $state('');

  let countdownTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const spinChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'] as const;
  let spinIdx = $state(0);
  const spinnerChar = $derived(spinChars[spinIdx]);

  const countdownFormatted = $derived.by(() => {
    const m = Math.floor(countdown / 60);
    const s = countdown % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  });

  function clearTimers(): void {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  async function checkStatus(): Promise<void> {
    try {
      const res = await fetch('/auth/status');
      const data = (await res.json()) as { authenticated: boolean; user: AuthUser | null };
      authenticated = data.authenticated;
      user = data.user ?? null;
    } catch {
      authenticated = false;
      user = null;
    }
  }

  async function startDeviceFlow(): Promise<void> {
    authStatus = 'polling';
    errorMessage = '';

    spinnerTimer = setInterval(() => {
      spinIdx = (spinIdx + 1) % spinChars.length;
    }, 100);

    try {
      const res = await fetch('/auth/device/start', { method: 'POST' });
      const data = (await res.json()) as DeviceCodeState & { error?: string };
      if (data.error) throw new Error(data.error);

      deviceCode = {
        user_code: data.user_code,
        verification_uri: data.verification_uri,
        expires_in: data.expires_in,
        interval: data.interval,
      };

      // Countdown timer
      const expiresAt = Date.now() + data.expires_in * 1000;
      countdown = data.expires_in;
      countdownTimer = setInterval(() => {
        const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
        countdown = remaining;
        if (remaining === 0 && countdownTimer) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        }
      }, 1000);

      // Poll for authorization with exponential backoff on slow_down
      let interval = (data.interval || 5) * 1000;
      const poll = async (): Promise<void> => {
        try {
          const result = await fetch('/auth/device/poll', { method: 'POST' });
          const pollData = (await result.json()) as PollResponse;

          if (pollData.status === 'authorized') {
            console.log(`[AUTH-STORE] poll returned authorized, user=${pollData.user?.login ?? pollData.githubUser ?? 'unknown'}`);
            clearTimers();
            authStatus = 'authorized';
            user = pollData.user ?? null;
            authenticated = true;
            return;
          }

          if (pollData.status === 'expired') {
            clearTimers();
            authStatus = 'expired';
            return;
          }

          if (pollData.status === 'access_denied') {
            clearTimers();
            authStatus = 'denied';
            return;
          }

          if (pollData.status === 'slow_down') {
            interval += 5000;
          }

          pollTimer = setTimeout(poll, interval);
        } catch {
          errorMessage = 'Error checking status — retrying...';
          pollTimer = setTimeout(poll, interval * 2);
        }
      };

      pollTimer = setTimeout(poll, interval);
    } catch (err) {
      clearTimers();
      authStatus = 'error';
      errorMessage = err instanceof Error ? err.message : 'Failed to start device flow.';
    }
  }

  async function logout(): Promise<void> {
    try {
      await fetch('/auth/logout', { method: 'POST' });
    } finally {
      authenticated = false;
      user = null;
      authStatus = 'idle';
      deviceCode = null;
      clearTimers();
    }
  }

  function destroy(): void {
    clearTimers();
  }

  return {
    get user() {
      return user;
    },
    get authenticated() {
      return authenticated;
    },
    get deviceCode() {
      return deviceCode;
    },
    get authStatus() {
      return authStatus;
    },
    get countdown() {
      return countdown;
    },
    get countdownFormatted() {
      return countdownFormatted;
    },
    get errorMessage() {
      return errorMessage;
    },
    get spinnerChar() {
      return spinnerChar;
    },
    checkStatus,
    startDeviceFlow,
    logout,
    destroy,
  };
}
