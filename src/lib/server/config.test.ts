import { homedir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
	'PORT',
	'BASE_URL',
	'SESSION_SECRET',
	'SESSION_STORE_PATH',
	'SETTINGS_STORE_PATH',
	'GITHUB_CLIENT_ID',
	'NODE_ENV',
	'ALLOWED_GITHUB_USERS',
	'TOKEN_MAX_AGE_MS',
	'SESSION_POOL_TTL_MS',
	'MAX_SESSIONS_PER_USER',
	'COPILOT_CONFIG_DIR',
] as const;

interface ConfigSnapshot {
	port: number;
	baseUrl: string;
	sessionSecret: string;
	sessionStorePath: string;
	settingsStorePath: string;
	github: {
		clientId: string;
	};
	isDev: boolean;
	allowedUsers: string[];
	tokenMaxAge: number;
	sessionPoolTtl: number;
	maxSessionsPerUser: number;
	copilotConfigDir: string | undefined;
}

function clearEnv(): void {
	vi.unstubAllEnvs();
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
}

async function importConfig(
	overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {},
	withRequiredDefaults = true,
): Promise<typeof import('./config.js')> {
	clearEnv();

	if (withRequiredDefaults) {
		vi.stubEnv('SESSION_SECRET', 'test-session-secret');
		vi.stubEnv('GITHUB_CLIENT_ID', 'test-client-id');
	}

	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete process.env[key];
			continue;
		}

		vi.stubEnv(key, value);
	}

	vi.resetModules();
	return import('./config.js');
}

async function loadConfig(
	overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {},
	withRequiredDefaults = true,
): Promise<ConfigSnapshot> {
	const { config } = await importConfig(overrides, withRequiredDefaults);

	return {
		port: config.port,
		baseUrl: config.baseUrl,
		sessionSecret: config.sessionSecret,
		sessionStorePath: config.sessionStorePath,
		settingsStorePath: config.settingsStorePath,
		github: {
			clientId: config.github.clientId,
		},
		isDev: config.isDev,
		allowedUsers: [...config.allowedUsers],
		tokenMaxAge: config.tokenMaxAge,
		sessionPoolTtl: config.sessionPoolTtl,
		maxSessionsPerUser: config.maxSessionsPerUser,
		copilotConfigDir: config.copilotConfigDir,
	};
}

beforeEach(() => {
	clearEnv();
	vi.resetModules();
});

afterEach(() => {
	clearEnv();
	vi.resetModules();
});

describe('config', () => {
	it('throws when SESSION_SECRET is missing', async () => {
		const { config } = await importConfig({ GITHUB_CLIENT_ID: 'test-client-id' }, false);

		expect(() => config.port).toThrow('Missing required env var: SESSION_SECRET');
	});

	it('throws when GITHUB_CLIENT_ID is missing', async () => {
		const { config } = await importConfig({ SESSION_SECRET: 'test-session-secret' }, false);

		expect(() => config.port).toThrow('Missing required env var: GITHUB_CLIENT_ID');
	});

	it('uses development defaults for optional values when env vars are unset', async () => {
		const config = await loadConfig();

		expect(config.port).toBe(3000);
		expect(config.baseUrl).toBe('http://localhost:3000');
		expect(config.sessionStorePath).toBe('.sessions');
		expect(config.settingsStorePath).toBe('.settings');
		expect(config.isDev).toBe(true);
		expect(config.allowedUsers).toEqual([]);
		expect(config.tokenMaxAge).toBe(7 * 24 * 60 * 60 * 1000);
		expect(config.sessionPoolTtl).toBe(5 * 60 * 1000);
		expect(config.maxSessionsPerUser).toBe(5);
		expect(config.copilotConfigDir).toBeUndefined();
	});

	it('uses production storage defaults when NODE_ENV is production', async () => {
		const config = await loadConfig({ NODE_ENV: 'production' });

		expect(config.sessionStorePath).toBe('/data/sessions');
		expect(config.settingsStorePath).toBe('/data/settings');
		expect(config.isDev).toBe(false);
	});

	it('parses ALLOWED_GITHUB_USERS as a lowercase trimmed array', async () => {
		const config = await loadConfig({ ALLOWED_GITHUB_USERS: ' Alice,BOB , carol ' });

		expect(config.allowedUsers).toEqual(['alice', 'bob', 'carol']);
	});

	it('treats an empty ALLOWED_GITHUB_USERS value as an empty array', async () => {
		const config = await loadConfig({ ALLOWED_GITHUB_USERS: '' });

		expect(config.allowedUsers).toEqual([]);
	});

	it('parses PORT from a string', async () => {
		const config = await loadConfig({ PORT: '4123' });

		expect(config.port).toBe(4123);
	});

	it('parses TOKEN_MAX_AGE_MS from a string', async () => {
		const config = await loadConfig({ TOKEN_MAX_AGE_MS: '12345' });

		expect(config.tokenMaxAge).toBe(12345);
	});

	it('treats non-production NODE_ENV values as development', async () => {
		const config = await loadConfig({ NODE_ENV: 'test' });

		expect(config.isDev).toBe(true);
	});

	it('preserves a BASE_URL without a trailing slash', async () => {
		const config = await loadConfig({ BASE_URL: 'https://example.com/app' });

		expect(config.baseUrl).toBe('https://example.com/app');
	});

	it('preserves a BASE_URL with a trailing slash', async () => {
		const config = await loadConfig({ BASE_URL: 'https://example.com/app/' });

		expect(config.baseUrl).toBe('https://example.com/app/');
	});

	it('trims whitespace around BASE_URL and other string env vars', async () => {
		const config = await loadConfig({
			BASE_URL: '  https://example.com  ',
			SESSION_SECRET: '  secret-value  ',
			GITHUB_CLIENT_ID: '  client-id  ',
		});

		expect(config.baseUrl).toBe('https://example.com');
		expect(config.sessionSecret).toBe('secret-value');
		expect(config.github.clientId).toBe('client-id');
	});

	it('expands a leading tilde in COPILOT_CONFIG_DIR', async () => {
		const config = await loadConfig({ COPILOT_CONFIG_DIR: '~/copilot-config' });

		expect(config.copilotConfigDir).toBe(`${homedir()}/copilot-config`);
	});

	it('uses explicit session and settings store overrides when provided', async () => {
		const config = await loadConfig({
			SESSION_STORE_PATH: '/tmp/sessions',
			SETTINGS_STORE_PATH: '/tmp/settings',
		});

		expect(config.sessionStorePath).toBe('/tmp/sessions');
		expect(config.settingsStorePath).toBe('/tmp/settings');
	});
});
