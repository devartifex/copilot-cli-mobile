// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidAttachmentPath, mapAttachmentsToSdk } from './handler.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const UPLOAD_PREFIX = join(tmpdir(), 'copilot-uploads');

describe('isValidAttachmentPath', () => {
	it('accepts a valid upload path', () => {
		const path = join(UPLOAD_PREFIX, 'uuid-123', 'photo.png');
		expect(isValidAttachmentPath(path)).toBe(true);
	});

	it('accepts nested paths inside the upload directory', () => {
		const path = join(UPLOAD_PREFIX, 'uuid-456', 'subdir', 'file.jpg');
		expect(isValidAttachmentPath(path)).toBe(true);
	});

	it('rejects paths outside the upload directory', () => {
		expect(isValidAttachmentPath('/etc/passwd')).toBe(false);
		expect(isValidAttachmentPath('/home/user/.ssh/id_rsa')).toBe(false);
		expect(isValidAttachmentPath('/tmp/other-dir/file.txt')).toBe(false);
	});

	it('rejects the upload prefix itself (must be inside it)', () => {
		expect(isValidAttachmentPath(UPLOAD_PREFIX)).toBe(false);
	});

	it('rejects path traversal attempts', () => {
		const traversal = join(UPLOAD_PREFIX, 'uuid-123', '..', '..', 'etc', 'passwd');
		expect(isValidAttachmentPath(traversal)).toBe(false);
	});

	it('rejects relative paths', () => {
		expect(isValidAttachmentPath('photo.png')).toBe(false);
		expect(isValidAttachmentPath('./uploads/photo.png')).toBe(false);
	});

	it('rejects empty strings', () => {
		expect(isValidAttachmentPath('')).toBe(false);
	});

	it('rejects paths that match the prefix as a substring but are not inside it', () => {
		// e.g. /tmp/copilot-uploads-evil/file.txt should not match /tmp/copilot-uploads/
		expect(isValidAttachmentPath(UPLOAD_PREFIX + '-evil/file.txt')).toBe(false);
	});
});

describe('mapAttachmentsToSdk', () => {
	const validPath = join(UPLOAD_PREFIX, 'uuid-1', 'photo.png');
	const validDir = join(UPLOAD_PREFIX, 'uuid-2', 'project');

	it('returns undefined for non-array input', () => {
		expect(mapAttachmentsToSdk(undefined)).toBeUndefined();
		expect(mapAttachmentsToSdk(null)).toBeUndefined();
		expect(mapAttachmentsToSdk('string')).toBeUndefined();
	});

	it('returns undefined for empty array', () => {
		expect(mapAttachmentsToSdk([])).toBeUndefined();
	});

	it('maps file attachments to SDK format', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'file', path: validPath, name: 'photo.png' },
		]);
		expect(result).toEqual([
			{ type: 'file', path: validPath, displayName: 'photo.png' },
		]);
	});

	it('maps directory attachments to SDK format', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'directory', path: validDir, name: 'project' },
		]);
		expect(result).toEqual([
			{ type: 'directory', path: validDir, displayName: 'project' },
		]);
	});

	it('maps selection attachments to SDK format', () => {
		const result = mapAttachmentsToSdk([
			{
				type: 'selection',
				filePath: validPath,
				name: 'photo.png',
				displayName: 'lines 1-10',
				selection: { start: { line: 1, character: 0 }, end: { line: 10, character: 0 } },
				text: 'selected text',
			},
		]);
		expect(result).toEqual([
			{
				type: 'selection',
				filePath: validPath,
				displayName: 'lines 1-10',
				selection: { start: { line: 1, character: 0 }, end: { line: 10, character: 0 } },
				text: 'selected text',
			},
		]);
	});

	it('uses name as displayName fallback for selection', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'selection', filePath: validPath, name: 'fallback-name' },
		]);
		expect(result).toEqual([
			{ type: 'selection', filePath: validPath, displayName: 'fallback-name' },
		]);
	});

	it('handles mixed attachment types', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'file', path: validPath, name: 'photo.png' },
			{ type: 'directory', path: validDir, name: 'project' },
			{ type: 'selection', filePath: validPath, displayName: 'sel', text: 'hi' },
		]);
		expect(result).toHaveLength(3);
		expect(result![0]).toMatchObject({ type: 'file' });
		expect(result![1]).toMatchObject({ type: 'directory' });
		expect(result![2]).toMatchObject({ type: 'selection' });
	});

	it('defaults missing type to file', () => {
		const result = mapAttachmentsToSdk([
			{ path: validPath, name: 'photo.png' },
		]);
		expect(result).toEqual([
			{ type: 'file', path: validPath, displayName: 'photo.png' },
		]);
	});

	it('rejects file/directory attachments with invalid paths', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'file', path: '/etc/passwd', name: 'bad' },
			{ type: 'directory', path: '/home/user', name: 'bad' },
		]);
		expect(result).toBeUndefined();
	});

	it('rejects selection attachments with invalid filePath', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'selection', filePath: '/etc/passwd', displayName: 'bad' },
		]);
		expect(result).toBeUndefined();
	});

	it('skips entries missing required fields', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'file' },
			{ type: 'selection' },
			{ type: 'file', path: validPath, name: 'ok.txt' },
		]);
		expect(result).toEqual([
			{ type: 'file', path: validPath, displayName: 'ok.txt' },
		]);
	});

	it('prefers displayName over name for file/directory', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'file', path: validPath, name: 'name.txt', displayName: 'display.txt' },
		]);
		expect(result).toEqual([
			{ type: 'file', path: validPath, displayName: 'display.txt' },
		]);
	});

	it('omits optional selection fields when absent', () => {
		const result = mapAttachmentsToSdk([
			{ type: 'selection', filePath: validPath, displayName: 'sel' },
		]);
		expect(result).toEqual([
			{ type: 'selection', filePath: validPath, displayName: 'sel' },
		]);
	});
});
