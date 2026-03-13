import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import type { FileAttachment } from '$lib/types/index.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const CLEANUP_DELAY = 60 * 60 * 1000; // 1 hour

const ALLOWED_EXTENSIONS = new Set([
	// Images
	'jpg', 'jpeg', 'png', 'gif', 'webp',
	// Code
	'ts', 'js', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'rb', 'php',
	// Docs
	'md', 'txt', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'csv', 'sql',
]);

function sanitizeFilename(raw: string): string {
	const name = basename(raw);
	// Strip path traversal characters
	return name.replace(/[/\\:*?"<>|]/g, '_');
}

function getExtension(filename: string): string {
	return extname(filename).slice(1).toLowerCase();
}

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session?.githubToken) {
		return error(401, 'Unauthorized');
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return error(400, 'Invalid form data');
	}

	const entries = formData.getAll('files');
	if (entries.length === 0) {
		return error(400, 'No files provided');
	}

	if (entries.length > MAX_FILES) {
		return error(400, `Maximum ${MAX_FILES} files per upload`);
	}

	const uploadId = randomUUID();
	const uploadDir = join(tmpdir(), 'copilot-uploads', uploadId);
	await mkdir(uploadDir, { recursive: true });

	const results: FileAttachment[] = [];

	for (const entry of entries) {
		if (!(entry instanceof File)) {
			continue;
		}

		const hasUnsafePath =
			entry.name !== basename(entry.name) ||
			entry.name.includes('\\') ||
			/(^|[\\/])\.\.([\\/]|$)/.test(entry.name);
		if (hasUnsafePath) {
			await rm(uploadDir, { recursive: true, force: true });
			return error(400, 'Invalid file path');
		}

		const safeName = sanitizeFilename(entry.name);
		const ext = getExtension(safeName);

		if (!ALLOWED_EXTENSIONS.has(ext)) {
			await rm(uploadDir, { recursive: true, force: true });
			return error(400, `File type .${ext} is not allowed`);
		}

		if (entry.size > MAX_FILE_SIZE) {
			await rm(uploadDir, { recursive: true, force: true });
			return error(400, `File ${safeName} exceeds 10MB limit`);
		}

		if (entry.size === 0) {
			continue;
		}

		const filePath = join(uploadDir, safeName);
		// Verify resolved path stays inside upload dir (path traversal prevention)
		if (!filePath.startsWith(uploadDir)) {
			await rm(uploadDir, { recursive: true, force: true });
			return error(400, 'Invalid file path');
		}

		const buffer = Buffer.from(await entry.arrayBuffer());
		await writeFile(filePath, buffer);

		results.push({
			path: filePath,
			name: safeName,
			size: entry.size,
			type: entry.type || `application/${ext}`,
		});
	}

	if (results.length === 0) {
		await rm(uploadDir, { recursive: true, force: true });
		return error(400, 'No valid files uploaded');
	}

	// Schedule cleanup after 1 hour
	setTimeout(async () => {
		try {
			await rm(uploadDir, { recursive: true, force: true });
		} catch {
			// Directory may already be cleaned up
		}
	}, CLEANUP_DELAY);

	return json({ files: results });
};
