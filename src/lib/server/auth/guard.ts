import { config } from '../config.js';
import { logSecurity } from '../security-log.js';

export interface SessionData {
  githubToken?: string;
  githubUser?: { login: string; name: string };
  githubAuthTime?: number;
  githubDeviceCode?: string;
  githubDeviceExpiry?: number;
}

export function checkAuth(session: SessionData | undefined): {
  authenticated: boolean;
  user: { login: string; name: string } | null;
  error?: string;
} {
  if (!session?.githubToken) {
    return { authenticated: false, user: null, error: 'GitHub authentication required' };
  }

  const authTime = session.githubAuthTime;
  if (authTime && Date.now() - authTime > config.tokenMaxAge) {
    logSecurity('info', 'token_expired', {
      user: session.githubUser?.login,
      reason: 'max_age_exceeded',
    });
    return { authenticated: false, user: null, error: 'Session expired. Please sign in again.' };
  }

  return { authenticated: true, user: session.githubUser || null };
}
