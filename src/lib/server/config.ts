function required(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function getConfig() {
  return {
    port: parseInt(env('PORT', '3000')),
    baseUrl: env('BASE_URL', 'http://localhost:3000'),
    sessionSecret: required('SESSION_SECRET'),
    sessionStorePath: env('SESSION_STORE_PATH', '.sessions'),
    github: {
      clientId: required('GITHUB_CLIENT_ID'),
    },
    isDev: env('NODE_ENV', 'development') !== 'production',
    allowedUsers: process.env.ALLOWED_GITHUB_USERS
      ? process.env.ALLOWED_GITHUB_USERS.split(',').map((u: string) => u.trim().toLowerCase())
      : [],
    tokenMaxAge: parseInt(env('TOKEN_MAX_AGE_MS', String(7 * 24 * 60 * 60 * 1000))),
    sessionPoolTtl: parseInt(env('SESSION_POOL_TTL_MS', String(5 * 60 * 1000))),
  };
}

let _config: ReturnType<typeof getConfig> | null = null;

export const config = new Proxy({} as ReturnType<typeof getConfig>, {
  get(_target, prop) {
    if (!_config) _config = getConfig();
    return (_config as Record<string | symbol, unknown>)[prop];
  },
});
