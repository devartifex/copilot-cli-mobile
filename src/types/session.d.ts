import 'express-session';

declare module 'express-session' {
  interface SessionData {
    githubToken?: string;
    githubUser?: { login: string; name: string };
    // Device flow — stored server-side, never sent to browser
    githubDeviceCode?: string;
    githubDeviceExpiry?: number;
  }
}
