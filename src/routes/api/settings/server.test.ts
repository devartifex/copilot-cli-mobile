// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/guard', () => ({
	checkAuth: vi.fn(),
}));

vi.mock('$lib/server/settings-store', () => ({
	loadUserSettings: vi.fn(),
	saveUserSettings: vi.fn(),
}));

import { GET, PUT } from './+server';
import { checkAuth } from '$lib/server/auth/guard';
import { loadUserSettings, saveUserSettings } from '$lib/server/settings-store';

type MockSession = {
	githubToken?: string;
	githubUser?: { login: string; name: string };
	save: (callback: (err?: Error) => void) => void;
	destroy: (callback: (err?: Error) => void) => void;
};

function createEvent(options: { request?: Request; session?: MockSession } = {}) {
	const request =
		options.request ??
		new Request('http://localhost/api/settings', {
			method: 'GET',
		});

	return {
		request,
		locals: { session: options.session },
		url: new URL(request.url),
	} as any;
}

function createSession(overrides: Partial<MockSession> = {}): MockSession {
	return {
		save: vi.fn((callback: (err?: Error) => void) => callback()),
		destroy: vi.fn((callback: (err?: Error) => void) => callback()),
		...overrides,
	};
}

const authUser = { login: 'octocat', name: 'Octocat' };
const settings = {
	model: 'gpt-4.1',
	mode: 'chat',
	reasoningEffort: 'medium',
	customInstructions: 'Be concise',
	excludedTools: ['bash'],
	customTools: [],
};

describe('/api/settings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(checkAuth).mockReturnValue({ authenticated: true, user: authUser });
	});

	it('GET rejects unauthenticated requests', async () => {
		vi.mocked(checkAuth).mockReturnValue({ authenticated: false, user: null, error: 'Authentication required' });

		const response = await GET(createEvent());

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Authentication required' });
	});

	it('GET returns null when no saved settings exist', async () => {
		vi.mocked(loadUserSettings).mockResolvedValue(null);

		const response = await GET(createEvent({ session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(await response.json()).toEqual({ settings: null });
	});

	it('GET returns saved settings for authenticated users', async () => {
		vi.mocked(loadUserSettings).mockResolvedValue(settings as never);

		const response = await GET(createEvent({ session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ settings });
		expect(loadUserSettings).toHaveBeenCalledWith('octocat');
	});

	it('GET returns 500 when loading settings fails', async () => {
		vi.mocked(loadUserSettings).mockRejectedValue(new Error('disk error'));

		const response = await GET(createEvent({ session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Failed to load settings' });
	});

	it('PUT rejects unauthenticated requests', async () => {
		vi.mocked(checkAuth).mockReturnValue({ authenticated: false, user: null, error: 'Authentication required' });
		const request = new Request('http://localhost/api/settings', {
			method: 'PUT',
			body: JSON.stringify({ settings }),
			headers: { 'content-type': 'application/json' },
		});

		const response = await PUT(createEvent({ request }));

		expect(response.status).toBe(401);
	});

	it('PUT validates that a settings object is present', async () => {
		const request = new Request('http://localhost/api/settings', {
			method: 'PUT',
			body: JSON.stringify({}),
			headers: { 'content-type': 'application/json' },
		});

		const response = await PUT(createEvent({ request, session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Missing settings object' });
	});

	it('PUT saves settings for authenticated users', async () => {
		const request = new Request('http://localhost/api/settings', {
			method: 'PUT',
			body: JSON.stringify({ settings }),
			headers: { 'content-type': 'application/json' },
		});

		const response = await PUT(createEvent({ request, session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(saveUserSettings).toHaveBeenCalledWith('octocat', settings);
	});

	it('PUT returns 500 when saving settings fails', async () => {
		vi.mocked(saveUserSettings).mockRejectedValue(new Error('disk error'));
		const request = new Request('http://localhost/api/settings', {
			method: 'PUT',
			body: JSON.stringify({ settings }),
			headers: { 'content-type': 'application/json' },
		});

		const response = await PUT(createEvent({ request, session: createSession({ githubToken: 'token', githubUser: authUser }) }));

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'Failed to save settings' });
	});
});
