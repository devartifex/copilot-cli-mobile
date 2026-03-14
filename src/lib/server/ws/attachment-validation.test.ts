// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidAttachmentPath } from './handler.js';
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
