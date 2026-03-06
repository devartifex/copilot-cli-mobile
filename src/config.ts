import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3000'),
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  sessionSecret: required('SESSION_SECRET'),
  sessionStorePath: process.env.SESSION_STORE_PATH || '.sessions',
  github: {
    clientId: required('GITHUB_CLIENT_ID'),
  },
  isDev: process.env.NODE_ENV !== 'production',
};
