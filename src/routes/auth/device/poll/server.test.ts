// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/github', () => ({
	pollForToken: vi.fn(),
	validateGitHubToken: vi.fn(),
}));

vi.mock('$lib/server/config', () => ({
	config: {
		allowedUsers: [] as string[],
	},
}));

vi.mock('$lib/server/security-log', () => ({
	logSecurity: vi.fn(),
}));

vi.mock('$lib/server/auth/session-utils', () => ({
	clearDeviceFlow: vi.fn(async () => undefined),
	saveSession: vi.fn(async () => undefined),
}));

import { POST } from './+server';
import { pollForToken, validateGitHubToken } from '$lib/server/auth/github';
import { config } from '$lib/server/config';
import { logSecurity } from '$lib/server/security-log';
import { clearDeviceFlow, saveSession } from '$lib/server/auth/session-utils';

type MockSession = {
	githubDeviceCode?: string;
	githubDeviceExpiry?: number;
	githubToken?: string;
	githubUser?: { login: string; name: string };
	githubAuthTime?: number;
	save: (callback: (err?: Error) => void) => void;
	destroy: (callback: (err?: Error) => void) => void;
};

function createEvent(session?: MockSession) {
	return {
		locals: { session },
		getClientAddress: () => '127.0.0.1',
	} as any;
}

function createSession(overrides: Partial<MockSession> = {}): MockSession {
	return {
		save: vi.fn((callback: (err?: Error) => void) => callback()),
		destroy: vi.fn((callback: (err?: Error) => void) => callback()),
		...overrides,
	};
}

describe('POST /auth/device/poll', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		config.allowedUsers = [];
		vi.mocked(pollForToken).mockResolvedValue({ status: 'authorized', token: 'github-token' });
		vi.mocked(validateGitHubToken).mockResolvedValue({
			valid: true,
			user: { login: 'octocat', name: 'Octocat' },
		});
	});

	it('returns 500 when no session is available', async () => {
		const response = await POST(createEvent());

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'No session available' });
	});

	it('requires an active device flow', async () => {
		const response = await POST(createEvent(createSession()));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'No active device flow. Call /start first.' });
	});

	it('clears expired device flows', async () => {
		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() - 1 })));

		expect(await response.json()).toEqual({ status: 'expired' });
		expect(clearDeviceFlow).toHaveBeenCalledTimes(1);
		expect(pollForToken).not.toHaveBeenCalled();
	});

	it('returns pending while waiting for approval', async () => {
		vi.mocked(pollForToken).mockResolvedValue({ status: 'pending' });

		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 })));

		expect(await response.json()).toEqual({ status: 'pending' });
	});

	it('returns slow_down when GitHub asks the client to back off', async () => {
		vi.mocked(pollForToken).mockResolvedValue({ status: 'slow_down' });

		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 })));

		expect(await response.json()).toEqual({ status: 'slow_down' });
	});

	it('clears denied device flows', async () => {
		vi.mocked(pollForToken).mockResolvedValue({ status: 'access_denied' });

		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 })));

		expect(await response.json()).toEqual({ status: 'access_denied' });
		expect(clearDeviceFlow).toHaveBeenCalledTimes(1);
	});

	it('rejects authenticated users outside the allowed list', async () => {
		config.allowedUsers = ['hubot'];
		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 })));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			status: 'forbidden',
			error: 'Your GitHub account is not authorized to use this application.',
		});
		expect(logSecurity).toHaveBeenCalledWith('warn', 'auth_denied_not_allowed', {
			user: 'octocat',
			ip: '127.0.0.1',
		});
		expect(saveSession).not.toHaveBeenCalled();
	});

	it('stores the validated GitHub token on success', async () => {
		const session = createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 });

		const response = await POST(createEvent(session));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'authorized', githubUser: 'octocat' });
		expect(session.githubDeviceCode).toBeUndefined();
		expect(session.githubDeviceExpiry).toBeUndefined();
		expect(session.githubToken).toBe('github-token');
		expect(session.githubUser).toEqual({ login: 'octocat', name: 'Octocat' });
		expect(session.githubAuthTime).toEqual(expect.any(Number));
		expect(saveSession).toHaveBeenCalledWith(session);
		expect(logSecurity).toHaveBeenCalledWith('info', 'auth_success', { user: 'octocat' });
	});

	it('returns 500 when GitHub token validation fails', async () => {
		vi.mocked(validateGitHubToken).mockResolvedValue({ valid: false, reason: 'invalid_token' });

		const response = await POST(createEvent(createSession({ githubDeviceCode: 'device-code', githubDeviceExpiry: Date.now() + 60_000 })));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Device flow polling failed' });
	});
});
