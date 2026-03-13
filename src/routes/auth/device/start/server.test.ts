// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/github', () => ({
	requestDeviceCode: vi.fn(),
}));

vi.mock('$lib/server/auth/session-utils', () => ({
	saveSession: vi.fn(async () => undefined),
}));

import { POST } from './+server';
import { requestDeviceCode } from '$lib/server/auth/github';
import { saveSession } from '$lib/server/auth/session-utils';

type MockSession = {
	githubDeviceCode?: string;
	githubDeviceExpiry?: number;
	save: (callback: (err?: Error) => void) => void;
	destroy: (callback: (err?: Error) => void) => void;
};

function createEvent(session?: MockSession) {
	return {
		locals: { session },
	} as any;
}

function createSession(overrides: Partial<MockSession> = {}): MockSession {
	return {
		save: vi.fn((callback: (err?: Error) => void) => callback()),
		destroy: vi.fn((callback: (err?: Error) => void) => callback()),
		...overrides,
	};
}

describe('POST /auth/device/start', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(requestDeviceCode).mockResolvedValue({
			device_code: 'device-code',
			user_code: 'USER-CODE',
			verification_uri: 'https://github.com/login/device',
			expires_in: 900,
			interval: 5,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('returns 500 when no session is available', async () => {
		const response = await POST(createEvent());

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'No session available' });
	});

	it('initiates the device flow', async () => {
		await POST(createEvent(createSession()));

		expect(requestDeviceCode).toHaveBeenCalledTimes(1);
	});

	it('stores device flow details on the session', async () => {
		const session = createSession();

		await POST(createEvent(session));

		expect(session.githubDeviceCode).toBe('device-code');
		expect(session.githubDeviceExpiry).toBe(Date.now() + 900_000);
	});

	it('persists the updated session', async () => {
		const session = createSession();

		await POST(createEvent(session));

		expect(saveSession).toHaveBeenCalledWith(session);
	});

	it('returns the public device flow fields without exposing the device code', async () => {
		const response = await POST(createEvent(createSession()));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			user_code: 'USER-CODE',
			verification_uri: 'https://github.com/login/device',
			expires_in: 900,
			interval: 5,
		});
		expect(body).not.toHaveProperty('device_code');
	});

	it('returns 500 when the GitHub device flow request fails', async () => {
		vi.mocked(requestDeviceCode).mockRejectedValue(new Error('github unavailable'));

		const response = await POST(createEvent(createSession()));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Failed to start device flow' });
	});
});
