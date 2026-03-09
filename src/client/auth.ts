// Auth module — handles GitHub device flow authentication

interface AuthStatus {
  authenticated: boolean;
  githubUser: string | null;
}

interface DeviceFlowData {
  user_code: string;
  device_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  error?: string;
}

interface PollResult {
  status: 'authorized' | 'pending' | 'expired' | 'access_denied' | 'slow_down';
  githubUser?: string;
  error?: string;
}

export const Auth = {
  async checkStatus(): Promise<AuthStatus> {
    try {
      const res = await fetch('/auth/status');
      return await res.json() as AuthStatus;
    } catch {
      return { authenticated: false, githubUser: null };
    }
  },

  async startDeviceFlow(): Promise<DeviceFlowData> {
    const res = await fetch('/auth/github/device/start', { method: 'POST' });
    const data = await res.json() as DeviceFlowData;
    if (data.error) throw new Error(data.error);
    return data;
  },

  async pollDeviceFlow(): Promise<PollResult> {
    const res = await fetch('/auth/github/device/poll', { method: 'POST' });
    const data = await res.json() as PollResult;
    if (res.status >= 500) throw new Error((data as { error?: string }).error ?? 'Poll failed');
    return data;
  },

  logout(): void {
    window.location.href = '/auth/logout';
  },
};
