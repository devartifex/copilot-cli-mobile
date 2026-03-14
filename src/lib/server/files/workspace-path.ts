import { resolve } from 'node:path';

/** Validate that a file path is safe (no traversal outside workspace) */
export function isValidWorkspacePath(filePath: string, workspaceRoot: string): boolean {
	const resolved = resolve(workspaceRoot, filePath);
	return resolved.startsWith(workspaceRoot + '/') || resolved === workspaceRoot;
}
