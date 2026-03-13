import { config } from '../config.js';
import { logSecurity } from '../security-log.js';

export interface GitHubUser {
  login: string;
  name: string;
}

export interface SessionData {
  githubToken?: string;
  githubUser?: GitHubUser;
  githubAuthTime?: number;
  githubDeviceCode?: string;
  githubDeviceExpiry?: number;
  save(callback: (err?: Error) => void): void;
  destroy(callback: (err?: Error) => void): void;
}

export interface AuthResult {
  authenticated: boolean;
  user: GitHubUser | null;
  error?: string;
}

export function checkAuth(session: SessionData | null | undefined): AuthResult {
  if (!session?.githubToken) {
    return { authenticated: false, user: null, error: 'GitHub authentication required' };
  }

  const authTime = session.githubAuthTime;
  if (typeof authTime === 'number' && Date.now() - authTime > config.tokenMaxAge) {
    logSecurity('info', 'token_expired', {
      user: session.githubUser?.login,
      reason: 'max_age_exceeded',
    });
    return { authenticated: false, user: null, error: 'Session expired. Please sign in again.' };
  }

  if (config.allowedUsers.length > 0) {
    const login = session.githubUser?.login?.trim().toLowerCase();

    if (!login || !config.allowedUsers.includes(login)) {
      logSecurity('warn', 'auth_denied_not_allowed', {
        user: session.githubUser?.login,
      });
      return {
        authenticated: false,
        user: null,
        error: 'Your GitHub account is not authorized to use this application.',
      };
    }
  }

  return { authenticated: true, user: session.githubUser ?? null };
}
