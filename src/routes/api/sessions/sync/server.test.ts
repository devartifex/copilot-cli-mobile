// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/github.js', () => ({
	validateGitHubToken: vi.fn(),
}));

vi.mock('$lib/server/config.js', () => ({
	config: {
		allowedUsers: [] as string[],
	},
}));

vi.mock('$lib/server/copilot/session-metadata.js', () => ({
	getSessionStateDir: vi.fn(() => '/tmp/session-state'),
	listSessionsFromFilesystem: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();

	return {
		...actual,
		default: actual,
		mkdir: vi.fn(async () => undefined),
		readdir: vi.fn(async () => []),
		stat: vi.fn(async () => {
			throw new Error('ENOENT');
		}),
		writeFile: vi.fn(async () => undefined),
	};
});

import { GET, POST } from './+server';
import { validateGitHubToken } from '$lib/server/auth/github.js';
import { config } from '$lib/server/config.js';
import { listSessionsFromFilesystem } from '$lib/server/copilot/session-metadata.js';
import { mkdir, stat, writeFile } from 'node:fs/promises';

function createEvent(request: Request) {
	return {
		request,
		url: new URL(request.url),
	} as any;
}

describe('/api/sessions/sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		config.allowedUsers = [];
		vi.mocked(validateGitHubToken).mockResolvedValue({
			valid: true,
			user: { login: 'octocat', name: 'Octocat' },
		});
	});

	it('GET rejects missing bearer tokens', async () => {
		const request = new Request('http://localhost/api/sessions/sync', { method: 'GET' });

		await expect(GET(createEvent(request))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Missing or invalid Authorization header' },
		});
	});

	it('GET rejects invalid bearer tokens', async () => {
		vi.mocked(validateGitHubToken).mockResolvedValue({ valid: false, reason: 'invalid_token' });
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'GET',
			headers: { authorization: 'Bearer bad-token' },
		});

		await expect(GET(createEvent(request))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Invalid or expired GitHub token' },
		});
	});

	it('GET enforces the allowed user list when configured', async () => {
		config.allowedUsers = ['hubot'];
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'GET',
			headers: { authorization: 'Bearer good-token' },
		});

		await expect(GET(createEvent(request))).rejects.toMatchObject({
			status: 403,
			body: { message: 'User not in allowed list' },
		});
	});

	it('GET returns session summaries for authenticated users', async () => {
		vi.mocked(listSessionsFromFilesystem).mockResolvedValue([
			{
				id: '11111111-1111-1111-1111-111111111111',
				updatedAt: '2024-01-01T00:00:00Z',
				title: 'Demo session',
				repository: 'owner/repo',
				branch: 'main',
				checkpointCount: 2,
				hasPlan: true,
			},
		] as never);
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'GET',
			headers: { authorization: 'Bearer good-token' },
		});

		const response = await GET(createEvent(request));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			sessions: [
				{
					id: '11111111-1111-1111-1111-111111111111',
					updatedAt: '2024-01-01T00:00:00Z',
					title: 'Demo session',
					repository: 'owner/repo',
					branch: 'main',
				},
			],
		});
	});

	it('POST rejects oversized payloads', async () => {
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: JSON.stringify({ sessions: [] }),
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
				'content-length': String(50 * 1024 * 1024 + 1),
			},
		});

		await expect(POST(createEvent(request))).rejects.toMatchObject({
			status: 413,
			body: { message: 'Payload too large (max 50MB)' },
		});
	});

	it('POST rejects invalid JSON bodies', async () => {
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: '{bad json',
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
			},
		});

		await expect(POST(createEvent(request))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid JSON body' },
		});
	});

	it('POST rejects requests without a sessions array', async () => {
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: JSON.stringify({}),
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
			},
		});

		await expect(POST(createEvent(request))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Missing sessions array' },
		});
	});

	it('POST reports invalid session IDs without writing files', async () => {
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: JSON.stringify({
				sessions: [{ id: 'not-a-uuid', files: { 'workspace.yaml': 'content' } }],
			}),
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
			},
		});

		const response = await POST(createEvent(request));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			results: [{ id: 'not-a-uuid', status: 'error', error: 'Invalid session ID' }],
			summary: { created: 0, updated: 0, errors: 1 },
		});
		expect(writeFile).not.toHaveBeenCalled();
	});

	it('POST skips path traversal attempts and writes valid files', async () => {
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: JSON.stringify({
				sessions: [
					{
						id: '11111111-1111-1111-1111-111111111111',
						files: {
							'workspace.yaml': 'root: true',
							'checkpoints/index.md': '# checkpoints',
							'../escape.txt': 'nope',
						},
					},
				],
			}),
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
			},
		});

		const response = await POST(createEvent(request));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.summary).toEqual({ created: 1, updated: 0, errors: 0 });
		expect(mkdir).toHaveBeenCalledWith('/tmp/session-state/11111111-1111-1111-1111-111111111111', { recursive: true });
		expect(writeFile).toHaveBeenCalledTimes(2);
		expect(writeFile).toHaveBeenCalledWith('/tmp/session-state/11111111-1111-1111-1111-111111111111/workspace.yaml', 'root: true', 'utf-8');
		expect(writeFile).toHaveBeenCalledWith('/tmp/session-state/11111111-1111-1111-1111-111111111111/checkpoints/index.md', '# checkpoints', 'utf-8');
	});

	it('POST marks sessions as updated when they already exist', async () => {
		vi.mocked(stat).mockResolvedValueOnce({ isDirectory: () => true } as never);
		const request = new Request('http://localhost/api/sessions/sync', {
			method: 'POST',
			body: JSON.stringify({
				sessions: [
					{
						id: '22222222-2222-2222-2222-222222222222',
						files: { 'workspace.yaml': 'root: true' },
					},
				],
			}),
			headers: {
				authorization: 'Bearer good-token',
				'content-type': 'application/json',
			},
		});

		const response = await POST(createEvent(request));

		expect(await response.json()).toEqual({
			results: [{ id: '22222222-2222-2222-2222-222222222222', status: 'updated' }],
			summary: { created: 0, updated: 1, errors: 0 },
		});
	});
});
