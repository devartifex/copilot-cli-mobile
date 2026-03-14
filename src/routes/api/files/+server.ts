import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkAuth } from '$lib/server/auth/guard';
import { isValidWorkspacePath } from '$lib/server/files/workspace-path';
import { execSync } from 'node:child_process';

const MAX_RESULTS = 20;
const CACHE_TTL_MS = 30_000;

let cachedFiles: string[] | null = null;
let cacheTimestamp = 0;

/** Reset the file cache — for testing only */
export function _resetCache(): void {
	cachedFiles = null;
	cacheTimestamp = 0;
}

/** Get workspace root — prefer git root, fallback to cwd */
function getWorkspaceRoot(): string {
	try {
		return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
	} catch {
		return process.cwd();
	}
}

/** List workspace files using git ls-files (respects .gitignore, fast) */
function listWorkspaceFiles(): string[] {
	const now = Date.now();
	if (cachedFiles && now - cacheTimestamp < CACHE_TTL_MS) {
		return cachedFiles;
	}

	try {
		const output = execSync('git ls-files --cached --others --exclude-standard', {
			encoding: 'utf-8',
			cwd: getWorkspaceRoot(),
			maxBuffer: 10 * 1024 * 1024,
		});
		cachedFiles = output
			.split('\n')
			.filter((line) => line.length > 0);
		cacheTimestamp = now;
		return cachedFiles;
	} catch {
		return [];
	}
}

/** Simple fuzzy match: all query characters must appear in order in the candidate */
function fuzzyMatch(query: string, candidate: string): { match: boolean; score: number } {
	const lowerQuery = query.toLowerCase();
	const lowerCandidate = candidate.toLowerCase();

	// Exact substring match gets highest score
	if (lowerCandidate.includes(lowerQuery)) {
		const idx = lowerCandidate.lastIndexOf(lowerQuery);
		return { match: true, score: 1000 - candidate.length + idx };
	}

	// Fuzzy: all chars must appear in order
	let qi = 0;
	let score = 0;
	let lastMatchIdx = -1;
	for (let ci = 0; ci < lowerCandidate.length && qi < lowerQuery.length; ci++) {
		if (lowerCandidate[ci] === lowerQuery[qi]) {
			score += (lastMatchIdx === ci - 1) ? 10 : 1;
			if (ci === 0 || '/.-_'.includes(lowerCandidate[ci - 1])) {
				score += 5;
			}
			lastMatchIdx = ci;
			qi++;
		}
	}

	if (qi === lowerQuery.length) {
		return { match: true, score: score - candidate.length };
	}

	return { match: false, score: 0 };
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const auth = checkAuth(locals.session);
	if (!auth.authenticated) {
		return json({ error: auth.error }, { status: 401 });
	}

	const query = url.searchParams.get('q')?.trim() ?? '';
	const allFiles = listWorkspaceFiles();
	const workspaceRoot = getWorkspaceRoot();

	if (!query) {
		const files = allFiles
			.filter((f) => isValidWorkspacePath(f, workspaceRoot))
			.slice(0, MAX_RESULTS);
		return json({ files });
	}

	const matches = allFiles
		.filter((f) => isValidWorkspacePath(f, workspaceRoot))
		.map((f) => ({ path: f, ...fuzzyMatch(query, f) }))
		.filter((m) => m.match)
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_RESULTS)
		.map((m) => m.path);

	return json({ files: matches });
};
