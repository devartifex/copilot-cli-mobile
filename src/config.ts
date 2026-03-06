import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  baseUrl: required('BASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  azure: {
    clientId: required('AZURE_CLIENT_ID'),
    tenantId: required('AZURE_TENANT_ID'),
    clientSecret: required('AZURE_CLIENT_SECRET'),
    get redirectUri() { return `${config.baseUrl}/auth/callback`; },
  },
  github: {
    clientId: required('GITHUB_CLIENT_ID'),
    // No client secret needed — device flow only requires client_id
  },
  isDev: process.env.NODE_ENV !== 'production',
};
