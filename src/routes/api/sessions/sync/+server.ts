import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateGitHubToken } from '$lib/server/auth/github.js';
import { config } from '$lib/server/config.js';
import { getSessionStateDir, listSessionsFromFilesystem } from '$lib/server/copilot/session-metadata.js';
import { writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB total per request

/**
 * Validate a Bearer token from the Authorization header.
 * Returns the authenticated GitHub username or throws a 401.
 */
async function authenticateBearer(request: Request): Promise<string> {
	const authHeader = request.headers.get('authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		throw error(401, 'Missing or invalid Authorization header');
	}

	const token = authHeader.slice(7).trim();
	if (!token) {
		throw error(401, 'Empty bearer token');
	}

	const result = await validateGitHubToken(token);
	if (!result.valid) {
		throw error(401, 'Invalid or expired GitHub token');
	}

	const login = result.user.login.toLowerCase();

	// Check against ALLOWED_GITHUB_USERS if configured
	if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(login)) {
		throw error(403, 'User not in allowed list');
	}

	return login;
}

/**
 * GET /api/sessions/sync
 *
 * Returns the list of session IDs and their last-updated timestamps
 * that the remote instance knows about. Used by the sync script to
 * compute deltas.
 */
export const GET: RequestHandler = async ({ request }) => {
	const user = await authenticateBearer(request);
	console.log(`[SYNC] GET from user=${user}`);

	const sessions = await listSessionsFromFilesystem();

	const summary = sessions.map((s) => ({
		id: s.id,
		updatedAt: s.updatedAt,
		title: s.title,
		repository: s.repository,
		branch: s.branch,
	}));

	return json({ sessions: summary });
};

/**
 * POST /api/sessions/sync
 *
 * Accepts session data and writes it to the session-state directory.
 * Body: JSON with { sessions: Array<{ id, files: Record<path, content> }> }
 *
 * Each session's files are written under session-state/{id}/.
 * Paths are relative to the session directory (e.g., "workspace.yaml",
 * "checkpoints/index.md"). Path traversal is rejected.
 */
export const POST: RequestHandler = async ({ request }) => {
	const user = await authenticateBearer(request);
	console.log(`[SYNC] POST from user=${user}`);

	// Validate content length
	const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
	if (contentLength > MAX_UPLOAD_SIZE) {
		return error(413, `Payload too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)`);
	}

	let body: { sessions: Array<{ id: string; files: Record<string, string> }> };
	try {
		body = await request.json();
	} catch {
		return error(400, 'Invalid JSON body');
	}

	if (!Array.isArray(body.sessions)) {
		return error(400, 'Missing sessions array');
	}

	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const stateDir = getSessionStateDir();
	const results: Array<{ id: string; status: 'created' | 'updated' | 'error'; error?: string }> = [];

	for (const session of body.sessions) {
		if (!session.id || !UUID_RE.test(session.id)) {
			results.push({ id: session.id || 'unknown', status: 'error', error: 'Invalid session ID' });
			continue;
		}

		if (!session.files || typeof session.files !== 'object') {
			results.push({ id: session.id, status: 'error', error: 'Missing files object' });
			continue;
		}

		const sessionDir = join(stateDir, session.id);

		// Check if session already exists
		let exists = false;
		try {
			const info = await stat(sessionDir);
			exists = info.isDirectory();
		} catch {
			// Doesn't exist — will create
		}

		try {
			await mkdir(sessionDir, { recursive: true });

			for (const [relativePath, content] of Object.entries(session.files)) {
				// Validate path: no traversal, no absolute paths
				if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.includes('\\')) {
					console.warn(`[SYNC] Rejected path traversal: ${relativePath} in session ${session.id}`);
					continue;
				}

				const fullPath = join(sessionDir, relativePath);
				// Double-check resolved path is inside session dir
				if (!fullPath.startsWith(sessionDir)) {
					console.warn(`[SYNC] Path escaped session dir: ${fullPath}`);
					continue;
				}

				// Create subdirectories if needed
				const dir = join(fullPath, '..');
				await mkdir(dir, { recursive: true });

				await writeFile(fullPath, content, 'utf-8');
			}

			results.push({ id: session.id, status: exists ? 'updated' : 'created' });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			console.error(`[SYNC] Error writing session ${session.id}:`, message);
			results.push({ id: session.id, status: 'error', error: message });
		}
	}

	const created = results.filter((r) => r.status === 'created').length;
	const updated = results.filter((r) => r.status === 'updated').length;
	const errors = results.filter((r) => r.status === 'error').length;

	console.log(`[SYNC] Complete: ${created} created, ${updated} updated, ${errors} errors`);

	return json({ results, summary: { created, updated, errors } });
};
