import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig, logSecurityMock } = vi.hoisted(() => ({
	mockConfig: {
		tokenMaxAge: 60_000,
		allowedUsers: [] as string[],
	},
	logSecurityMock: vi.fn(),
}));

vi.mock('../config.js', () => ({
	config: mockConfig,
}));

vi.mock('../security-log.js', () => ({
	logSecurity: logSecurityMock,
}));

import { checkAuth, type GitHubUser, type SessionData } from './guard.js';

function createUser(login = 'octocat', name = 'Octo Cat'): GitHubUser {
	return { login, name };
}

function createSession(overrides: Partial<SessionData> = {}): SessionData {
	return {
		save: vi.fn((callback: (err?: Error) => void) => callback()),
		destroy: vi.fn((callback: (err?: Error) => void) => callback()),
		...overrides,
	};
}

describe('checkAuth', () => {
	beforeEach(() => {
		mockConfig.tokenMaxAge = 60_000;
		mockConfig.allowedUsers = [];
		logSecurityMock.mockReset();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns success for a valid session with a token', () => {
		const user = createUser();
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
			githubAuthTime: Date.now() - 1_000,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: true,
			user,
		});
	});

	it('returns failure when the session is missing', () => {
		expect(checkAuth(null)).toEqual({
			authenticated: false,
			user: null,
			error: 'GitHub authentication required',
		});
	});

	it('returns failure when the token is missing from the session', () => {
		const session = createSession({
			githubUser: createUser(),
			githubAuthTime: Date.now(),
		});

		expect(checkAuth(session)).toEqual({
			authenticated: false,
			user: null,
			error: 'GitHub authentication required',
		});
	});

	it('returns failure and logs when the token is expired', () => {
		const session = createSession({
			githubToken: 'token-123',
			githubUser: createUser('stale-user'),
			githubAuthTime: Date.now() - mockConfig.tokenMaxAge - 1,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: false,
			user: null,
			error: 'Session expired. Please sign in again.',
		});
		expect(logSecurityMock).toHaveBeenCalledWith('info', 'token_expired', {
			user: 'stale-user',
			reason: 'max_age_exceeded',
		});
	});

	it('returns success when the token is still within the max age', () => {
		const user = createUser('fresh-user');
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
			githubAuthTime: Date.now() - mockConfig.tokenMaxAge,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: true,
			user,
		});
		expect(logSecurityMock).not.toHaveBeenCalled();
	});

	it('denies access when the user is not in the configured allowlist', () => {
		mockConfig.allowedUsers = ['allowed-user'];
		const session = createSession({
			githubToken: 'token-123',
			githubUser: createUser('blocked-user'),
		});

		expect(checkAuth(session)).toEqual({
			authenticated: false,
			user: null,
			error: 'Your GitHub account is not authorized to use this application.',
		});
		expect(logSecurityMock).toHaveBeenCalledWith('warn', 'auth_denied_not_allowed', {
			user: 'blocked-user',
		});
	});

	it('allows access when the user is in the configured allowlist', () => {
		mockConfig.allowedUsers = ['allowed-user'];
		const user = createUser('Allowed-User');
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: true,
			user,
		});
	});

	it('allows every authenticated user when the allowlist is empty', () => {
		mockConfig.allowedUsers = [];
		const user = createUser('any-user');
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: true,
			user,
		});
	});

	it('returns success with a null user when only the token is present', () => {
		const session = createSession({
			githubToken: 'token-123',
		});

		expect(checkAuth(session)).toEqual({
			authenticated: true,
			user: null,
		});
	});

	it('denies access when the allowlist is configured but the session has no user', () => {
		mockConfig.allowedUsers = ['allowed-user'];
		const session = createSession({
			githubToken: 'token-123',
		});

		expect(checkAuth(session)).toEqual({
			authenticated: false,
			user: null,
			error: 'Your GitHub account is not authorized to use this application.',
		});
		expect(logSecurityMock).toHaveBeenCalledWith('warn', 'auth_denied_not_allowed', {
			user: undefined,
		});
	});

	it('treats an auth time of zero as expired when it exceeds the max age', () => {
		const session = createSession({
			githubToken: 'token-123',
			githubUser: createUser('epoch-user'),
			githubAuthTime: 0,
		});

		expect(checkAuth(session)).toEqual({
			authenticated: false,
			user: null,
			error: 'Session expired. Please sign in again.',
		});
	});
});
