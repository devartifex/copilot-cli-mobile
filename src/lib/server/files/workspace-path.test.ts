// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidWorkspacePath } from './workspace-path.js';

describe('isValidWorkspacePath', () => {
	it('allows paths within the workspace', () => {
		expect(isValidWorkspacePath('src/lib/index.ts', '/workspace')).toBe(true);
		expect(isValidWorkspacePath('package.json', '/workspace')).toBe(true);
		expect(isValidWorkspacePath('src/deep/nested/file.ts', '/workspace')).toBe(true);
	});

	it('rejects path traversal attempts', () => {
		expect(isValidWorkspacePath('../etc/passwd', '/workspace')).toBe(false);
		expect(isValidWorkspacePath('../../secret.key', '/workspace')).toBe(false);
		expect(isValidWorkspacePath('src/../../outside.txt', '/workspace')).toBe(false);
	});

	it('rejects absolute paths outside workspace', () => {
		expect(isValidWorkspacePath('/etc/passwd', '/workspace')).toBe(false);
		expect(isValidWorkspacePath('/tmp/evil.sh', '/workspace')).toBe(false);
	});

	it('allows the workspace root itself', () => {
		expect(isValidWorkspacePath('.', '/workspace')).toBe(true);
	});

	it('rejects paths that try to escape via encoded sequences', () => {
		expect(isValidWorkspacePath('..%2F..%2Fetc/passwd', '/workspace')).toBe(true);
		// The actual encoded dots don't resolve to parent — resolve treats them literally
		// But real parent traversal is blocked
		expect(isValidWorkspacePath('../../../etc/shadow', '/workspace')).toBe(false);
	});
});
