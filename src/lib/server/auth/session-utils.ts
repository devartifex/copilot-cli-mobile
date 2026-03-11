import type { SessionData } from './guard.js';

/** Promisified session.save() — replaces the verbose callback pattern */
export async function saveSession(session: SessionData): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    session.save((err?: Error) => (err ? reject(err) : resolve()))
  );
}

/** Clear device flow fields and save */
export async function clearDeviceFlow(session: SessionData): Promise<void> {
  delete session.githubDeviceCode;
  delete session.githubDeviceExpiry;
  await saveSession(session);
}

/** Clear all auth fields (on expiry/logout) and save */
export async function clearAuth(session: SessionData): Promise<void> {
  delete session.githubToken;
  delete session.githubUser;
  delete session.githubAuthTime;
  delete session.githubDeviceCode;
  delete session.githubDeviceExpiry;
  await saveSession(session);
}
