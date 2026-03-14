// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/auth/guard', () => ({
	checkAuth: vi.fn(),
}));

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}));

import { GET, _resetCache } from './+server';
import { checkAuth } from '$lib/server/auth/guard';
import { execSync } from 'node:child_process';

function createEvent(query = '', session?: Record<string, unknown>) {
	const url = new URL(`http://localhost/api/files${query ? `?q=${encodeURIComponent(query)}` : ''}`);
	return {
		locals: { session },
		url,
	} as any;
}

describe('GET /api/files', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetCache();
		vi.mocked(checkAuth).mockReturnValue({
			authenticated: true,
			user: { login: 'octocat', name: 'Octocat' },
		});
		vi.mocked(execSync).mockImplementation(((cmd: string) => {
			if (typeof cmd === 'string' && cmd.startsWith('git rev-parse')) {
				return '/workspace';
			}
			return 'src/lib/index.ts\nsrc/lib/utils.ts\npackage.json\nREADME.md\nsrc/app.css\n';
		}) as typeof execSync);
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
	});

	it('returns files without query', async () => {
		const response = await GET(createEvent(''));
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.files).toEqual([
			'src/lib/index.ts',
			'src/lib/utils.ts',
			'package.json',
			'README.md',
			'src/app.css',
		]);
	});

	it('fuzzy-filters files by query', async () => {
		const response = await GET(createEvent('utils'));
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.files).toContain('src/lib/utils.ts');
		expect(data.files).not.toContain('README.md');
	});

	it('limits results to max 20', async () => {
		const manyFiles = Array.from({ length: 30 }, (_, i) => `src/file-${i}.ts`).join('\n') + '\n';
		vi.mocked(execSync).mockImplementation(((cmd: string) => {
			if (typeof cmd === 'string' && cmd.startsWith('git rev-parse')) return '/workspace';
			return manyFiles;
		}) as typeof execSync);

		const response = await GET(createEvent(''));
		const data = await response.json();
		expect(data.files.length).toBeLessThanOrEqual(20);
	});

	it('does not return files with path traversal in git output', async () => {
		vi.mocked(execSync).mockImplementation(((cmd: string) => {
			if (typeof cmd === 'string' && cmd.startsWith('git rev-parse')) return '/workspace';
			return 'safe.ts\n../evil.txt\nsrc/../../etc/passwd\n';
		}) as typeof execSync);

		const response = await GET(createEvent(''));
		const data = await response.json();
		expect(data.files).toEqual(['safe.ts']);
	});
});
