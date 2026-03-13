import { describe, it, expect, vi } from 'vitest';

import type { SessionData } from './guard.js';
import { clearAuth, clearDeviceFlow, saveSession } from './session-utils.js';

type MockSession = SessionData & {
	preserved?: string;
};

function createSession(
	overrides: Partial<MockSession> = {},
	saveImpl: (callback: (err?: Error) => void) => void = (callback) => callback()
): MockSession {
	return {
		save: vi.fn(saveImpl),
		destroy: vi.fn((callback: (err?: Error) => void) => callback()),
		...overrides,
	};
}

describe('saveSession', () => {
	it('resolves and calls session.save exactly once', async () => {
		const session = createSession({ githubToken: 'token-123' });

		await expect(saveSession(session)).resolves.toBeUndefined();
		expect(session.save).toHaveBeenCalledTimes(1);
		expect(session.githubToken).toBe('token-123');
	});

	it('rejects when session.save passes an error', async () => {
		const saveError = new Error('save failed');
		const session = createSession({}, (callback) => callback(saveError));

		await expect(saveSession(session)).rejects.toThrow('save failed');
	});

	it('rejects when called with a null session', async () => {
		await expect(saveSession(null as unknown as SessionData)).rejects.toBeInstanceOf(TypeError);
	});
});

describe('clearDeviceFlow', () => {
	it('removes only device flow fields and preserves auth state', async () => {
		const user = { login: 'octocat', name: 'Octo Cat' };
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
			githubAuthTime: 123,
			githubDeviceCode: 'device-code',
			githubDeviceExpiry: 456,
			preserved: 'keep-me',
		});

		await expect(clearDeviceFlow(session)).resolves.toBeUndefined();
		expect(session.githubDeviceCode).toBeUndefined();
		expect(session.githubDeviceExpiry).toBeUndefined();
		expect(session.githubToken).toBe('token-123');
		expect(session.githubUser).toEqual(user);
		expect(session.githubAuthTime).toBe(123);
		expect(session.preserved).toBe('keep-me');
		expect(session.save).toHaveBeenCalledTimes(1);
	});

	it('succeeds even when device flow properties are already missing', async () => {
		const session = createSession({ preserved: 'keep-me' });

		await expect(clearDeviceFlow(session)).resolves.toBeUndefined();
		expect(session.preserved).toBe('keep-me');
		expect(session.save).toHaveBeenCalledTimes(1);
	});

	it('rejects when saving the cleared session fails', async () => {
		const saveError = new Error('session store unavailable');
		const session = createSession(
			{ githubDeviceCode: 'device-code', githubDeviceExpiry: 456 },
			(callback) => callback(saveError)
		);

		await expect(clearDeviceFlow(session)).rejects.toThrow('session store unavailable');
		expect(session.githubDeviceCode).toBeUndefined();
		expect(session.githubDeviceExpiry).toBeUndefined();
	});

	it('rejects when the session does not provide save()', async () => {
		const sessionWithoutSave = {
			githubDeviceCode: 'device-code',
			githubDeviceExpiry: 456,
		} as unknown as SessionData;

		await expect(clearDeviceFlow(sessionWithoutSave)).rejects.toBeInstanceOf(TypeError);
	});
});

describe('clearAuth', () => {
	it('removes auth and device flow fields while preserving unrelated data', async () => {
		const user = { login: 'octocat', name: 'Octo Cat' };
		const session = createSession({
			githubToken: 'token-123',
			githubUser: user,
			githubAuthTime: 123,
			githubDeviceCode: 'device-code',
			githubDeviceExpiry: 456,
			preserved: 'keep-me',
		});

		await expect(clearAuth(session)).resolves.toBeUndefined();
		expect(session.githubToken).toBeUndefined();
		expect(session.githubUser).toBeUndefined();
		expect(session.githubAuthTime).toBeUndefined();
		expect(session.githubDeviceCode).toBeUndefined();
		expect(session.githubDeviceExpiry).toBeUndefined();
		expect(session.preserved).toBe('keep-me');
		expect(session.save).toHaveBeenCalledTimes(1);
	});

	it('succeeds even when auth fields are already absent', async () => {
		const session = createSession({ preserved: 'keep-me' });

		await expect(clearAuth(session)).resolves.toBeUndefined();
		expect(session.preserved).toBe('keep-me');
		expect(session.save).toHaveBeenCalledTimes(1);
	});

	it('rejects when saving the cleared auth state fails', async () => {
		const saveError = new Error('save failed');
		const session = createSession(
			{ githubToken: 'token-123', githubUser: { login: 'octocat', name: 'Octo Cat' } },
			(callback) => callback(saveError)
		);

		await expect(clearAuth(session)).rejects.toThrow('save failed');
		expect(session.githubToken).toBeUndefined();
		expect(session.githubUser).toBeUndefined();
	});

	it('rejects when called with a null session', async () => {
		await expect(clearAuth(null as unknown as SessionData)).rejects.toBeInstanceOf(TypeError);
	});
});
