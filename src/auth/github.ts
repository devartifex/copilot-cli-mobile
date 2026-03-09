import { config } from '../config.js';

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';

// copilot: Copilot API access; read:user: display name/avatar; repo: SDK built-in tools
const GITHUB_SCOPES = 'copilot read:user repo';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type DevicePollStatus = 'pending' | 'slow_down' | 'authorized' | 'access_denied' | 'expired';

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: config.github.clientId, scope: GITHUB_SCOPES }),
  });

  const data = (await res.json()) as Record<string, string | number>;
  if (data.error) throw new Error((data.error_description as string) || (data.error as string));
  return data as unknown as DeviceCodeResponse;
}

export async function pollForToken(
  deviceCode: string
): Promise<{ status: DevicePollStatus; token?: string }> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.github.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  const data = (await res.json()) as Record<string, string>;

  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'slow_down' };
  if (data.error === 'access_denied') return { status: 'access_denied' };
  if (data.error === 'expired_token') return { status: 'expired' };
  if (data.error) throw new Error(data.error_description || data.error);

  return { status: 'authorized', token: data.access_token };
}

export async function validateGitHubToken(
  token: string
): Promise<{ login: string; name: string } | null> {
  try {
    const res = await fetch(`${GITHUB_API_URL}/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as Record<string, string>;
    return { login: user.login, name: user.name || user.login };
  } catch {
    return null;
  }
}
