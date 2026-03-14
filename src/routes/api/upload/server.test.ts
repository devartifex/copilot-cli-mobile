// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();

	return {
		...actual,
		default: actual,
		mkdir: vi.fn(async () => undefined),
		rm: vi.fn(async () => undefined),
		writeFile: vi.fn(async () => undefined),
	};
});

vi.mock('node:crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:crypto')>();

	return {
		...actual,
		default: actual,
		randomUUID: vi.fn(() => 'upload-123'),
	};
});

vi.mock('node:os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:os')>();

	return {
		...actual,
		default: actual,
		tmpdir: vi.fn(() => '/tmp'),
	};
});

import { POST } from './+server';
import { mkdir, rm, writeFile } from 'node:fs/promises';

type MockSession = {
	githubToken?: string;
	save: (callback: (err?: Error) => void) => void;
	destroy: (callback: (err?: Error) => void) => void;
};

function createEvent(request: Request, session?: MockSession) {
	return {
		request,
		locals: { session },
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

function createUploadRequest(files: File[]): Request {
	const formData = new FormData();
	for (const file of files) {
		formData.append('files', file);
	}

	return new Request('http://localhost/api/upload', {
		method: 'POST',
		body: formData,
	});
}

describe('POST /api/upload', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects unauthenticated requests', async () => {
		const request = createUploadRequest([new File(['hello'], 'note.txt', { type: 'text/plain' })]);

		await expect(POST(createEvent(request))).rejects.toMatchObject({
			status: 401,
			body: { message: 'Unauthorized' },
		});
	});

	it('rejects invalid form data', async () => {
		const request = new Request('http://localhost/api/upload', {
			method: 'POST',
			body: 'not-form-data',
			headers: { 'content-type': 'text/plain' },
		});

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid form data' },
		});
	});

	it('rejects requests without files', async () => {
		const request = createUploadRequest([]);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'No files provided' },
		});
	});

	it('enforces the maximum file count', async () => {
		const files = Array.from({ length: 6 }, (_, index) => new File(['x'], `file-${index}.txt`, { type: 'text/plain' }));
		const request = createUploadRequest(files);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Maximum 5 files per upload' },
		});
	});

	it('rejects files with disallowed extensions', async () => {
		const request = createUploadRequest([new File(['bad'], 'malware.exe', { type: 'application/octet-stream' })]);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'File type .exe is not allowed' },
		});
		expect(rm).toHaveBeenCalledWith('/tmp/copilot-uploads/upload-123', { recursive: true, force: true });
	});

	it('enforces the file size limit', async () => {
		const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.txt', { type: 'text/plain' });
		const request = createUploadRequest([oversized]);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'File huge.txt exceeds 10MB limit' },
		});
	});

	it('rejects path traversal attempts in file names', async () => {
		const request = createUploadRequest([new File(['secret'], '../secret.txt', { type: 'text/plain' })]);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'Invalid file path' },
		});
	});

	it('rejects uploads when every file is empty', async () => {
		const request = createUploadRequest([new File([''], 'empty.txt', { type: 'text/plain' })]);

		await expect(POST(createEvent(request, createSession({ githubToken: 'token' })))).rejects.toMatchObject({
			status: 400,
			body: { message: 'No valid files uploaded' },
		});
	});

	it('accepts valid uploads for authenticated users', async () => {
		const request = createUploadRequest([new File(['hello'], 'notes.md', { type: 'text/markdown' })]);

		const response = await POST(createEvent(request, createSession({ githubToken: 'token' })));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			files: [
				{
					path: '/tmp/copilot-uploads/upload-123/notes.md',
					name: 'notes.md',
					size: 5,
					type: 'text/markdown',
				},
			],
		});
		expect(mkdir).toHaveBeenCalledWith('/tmp/copilot-uploads/upload-123', { recursive: true });
		expect(writeFile).toHaveBeenCalledWith('/tmp/copilot-uploads/upload-123/notes.md', expect.any(Buffer));
	});

	it.each([
		['photo.jpg', 'image/jpeg'],
		['photo.jpeg', 'image/jpeg'],
		['screenshot.png', 'image/png'],
		['animation.gif', 'image/gif'],
		['modern.webp', 'image/webp'],
	])('accepts image file %s with type %s', async (name, mimeType) => {
		const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // dummy bytes
		const request = createUploadRequest([new File([content], name, { type: mimeType })]);

		const response = await POST(createEvent(request, createSession({ githubToken: 'token' })));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.files).toHaveLength(1);
		expect(body.files[0]).toEqual({
			path: `/tmp/copilot-uploads/upload-123/${name}`,
			name,
			size: content.length,
			type: mimeType,
		});
		expect(writeFile).toHaveBeenCalledWith(`/tmp/copilot-uploads/upload-123/${name}`, expect.any(Buffer));
	});

	it('returns absolute server-side paths for uploaded files', async () => {
		const request = createUploadRequest([new File(['data'], 'image.png', { type: 'image/png' })]);

		const response = await POST(createEvent(request, createSession({ githubToken: 'token' })));
		const body = await response.json();

		const filePath: string = body.files[0].path;
		expect(filePath.startsWith('/')).toBe(true);
		expect(filePath).toContain('/copilot-uploads/');
		expect(filePath).not.toContain('http');
	});
});
