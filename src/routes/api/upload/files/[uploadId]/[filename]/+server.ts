import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const MIME_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	txt: 'text/plain',
	json: 'application/json',
	md: 'text/markdown',
	csv: 'text/csv',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9._-]+$/;

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.session?.githubToken) {
		return error(401, 'Unauthorized');
	}

	const { uploadId, filename } = params;

	if (!UUID_RE.test(uploadId)) {
		return error(400, 'Invalid upload ID');
	}

	if (!filename || !SAFE_FILENAME_RE.test(filename) || filename !== basename(filename)) {
		return error(400, 'Invalid filename');
	}

	const uploadBase = join(tmpdir(), 'copilot-uploads');
	const filePath = join(uploadBase, uploadId, filename);

	// Path traversal prevention
	if (!filePath.startsWith(uploadBase)) {
		return error(400, 'Invalid file path');
	}

	try {
		await stat(filePath);
	} catch {
		return error(404, 'File not found');
	}

	const buffer = await readFile(filePath);
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

	return new Response(buffer, {
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'private, max-age=3600',
			'Content-Disposition': `inline; filename="${filename}"`,
		},
	});
};
