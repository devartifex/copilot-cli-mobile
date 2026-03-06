import 'express-session';

declare module 'express-session' {
  interface SessionData {
    azureAccount?: {
      homeAccountId: string;
      username: string;
      name?: string;
    };
    githubToken?: string;
    githubUser?: { login: string; name: string };
    // Device flow — stored server-side, never sent to browser
    githubDeviceCode?: string;
    githubDeviceExpiry?: number;
    authState?: string;
    pkceVerifier?: string;
    returnTo?: string;
  }
}
