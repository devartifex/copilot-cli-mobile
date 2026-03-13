// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/guard', () => ({
	checkAuth: vi.fn(),
}));

vi.mock('$lib/server/copilot/client', () => ({
	createCopilotClient: vi.fn(),
}));

vi.mock('$lib/server/copilot/session', () => ({
	getAvailableModels: vi.fn(),
}));

import { GET } from './+server';
import { checkAuth } from '$lib/server/auth/guard';
import { createCopilotClient } from '$lib/server/copilot/client';
import { getAvailableModels } from '$lib/server/copilot/session';

type MockSession = {
	githubToken?: string;
	githubUser?: { login: string; name: string };
	githubAuthTime?: number;
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

describe('GET /api/models', () => {
	const stop = vi.fn(async () => undefined);

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(checkAuth).mockReturnValue({
			authenticated: true,
			user: { login: 'octocat', name: 'Octocat' },
		});
		vi.mocked(createCopilotClient).mockReturnValue({ stop } as never);
		vi.mocked(getAvailableModels).mockResolvedValue([{ id: 'gpt-4.1' }] as never);
	});

	it('rejects unauthenticated requests', async () => {
		vi.mocked(checkAuth).mockReturnValue({
			authenticated: false,
			user: null,
			error: 'GitHub authentication required',
		});

		const response = await GET(createEvent());

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'GitHub authentication required' });
		expect(createCopilotClient).not.toHaveBeenCalled();
	});

	it('returns the available models for authenticated users', async () => {
		const response = await GET(createEvent(createSession({ githubToken: 'token' })));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ models: [{ id: 'gpt-4.1' }] });
		expect(createCopilotClient).toHaveBeenCalledWith('token');
	});

	it('normalizes non-array model payloads to an empty array', async () => {
		vi.mocked(getAvailableModels).mockResolvedValue({ data: 'invalid' } as never);

		const response = await GET(createEvent(createSession({ githubToken: 'token' })));

		expect(await response.json()).toEqual({ models: [] });
	});

	it('stops the Copilot client after a successful request', async () => {
		await GET(createEvent(createSession({ githubToken: 'token' })));

		expect(stop).toHaveBeenCalledTimes(1);
	});

	it('returns 500 when listing models fails', async () => {
		vi.mocked(createCopilotClient).mockImplementation(() => {
			throw new Error('boom');
		});

		const response = await GET(createEvent(createSession({ githubToken: 'token' })));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Failed to list models', models: [] });
	});
});
