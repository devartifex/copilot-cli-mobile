import {
  ConfidentialClientApplication,
  CryptoProvider,
  LogLevel,
  type AccountInfo,
  type AuthenticationResult,
} from '@azure/msal-node';
import { config } from '../config';

const cryptoProvider = new CryptoProvider();

const msalConfig = {
  auth: {
    clientId: config.azure.clientId,
    authority: `https://login.microsoftonline.com/${config.azure.tenantId}`,
    clientSecret: config.azure.clientSecret,
  },
  system: {
    loggerOptions: {
      loggerCallback: (_level: LogLevel, message: string) => {
        if (config.isDev) console.log('[MSAL]', message);
      },
      logLevel: LogLevel.Warning,
    },
  },
};

export const msalClient = new ConfidentialClientApplication(msalConfig);

export async function getAuthUrl(state: string, loginHint?: string) {
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();
  const url = await msalClient.getAuthCodeUrl({
    scopes: ['openid', 'profile', 'email'],
    redirectUri: config.azure.redirectUri,
    state,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256',
    prompt: loginHint ? undefined : 'select_account',
    loginHint,
  });
  return { url, verifier };
}

export async function handleCallback(
  code: string,
  verifier: string
): Promise<AuthenticationResult> {
  return msalClient.acquireTokenByCode({
    code,
    scopes: ['openid', 'profile', 'email'],
    redirectUri: config.azure.redirectUri,
    codeVerifier: verifier,
  });
}

export async function refreshToken(
  homeAccountId: string
): Promise<AuthenticationResult | null> {
  const account = await msalClient
    .getTokenCache()
    .getAccountByHomeId(homeAccountId);
  if (!account) return null;

  try {
    return await msalClient.acquireTokenSilent({
      account,
      scopes: ['openid', 'profile', 'email'],
    });
  } catch {
    return null;
  }
}
