import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { config } from './config.js';

interface PersistedSettings {
	model: string;
	mode: string;
	reasoningEffort: string;
	customInstructions: string;
	excludedTools: string[];
	customTools: unknown[];
	mcpServers?: unknown[];
}

const MAX_FILE_SIZE = 50 * 1024; // 50KB per user

function sanitizeUsername(username: string): string {
	return username.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function settingsPath(username: string): string {
	const safe = sanitizeUsername(username);
	if (!safe) throw new Error('Invalid username');
	return join(config.settingsStorePath, `${safe}.json`);
}

export async function loadUserSettings(username: string): Promise<PersistedSettings | null> {
	try {
		const filePath = settingsPath(username);
		const content = await readFile(filePath, 'utf-8');
		return JSON.parse(content) as PersistedSettings;
	} catch {
		return null;
	}
}

export async function saveUserSettings(username: string, settings: PersistedSettings): Promise<void> {
	const filePath = settingsPath(username);
	const data = JSON.stringify(settings);

	if (Buffer.byteLength(data, 'utf-8') > MAX_FILE_SIZE) {
		throw new Error('Settings data exceeds maximum size');
	}

	const dir = dirname(filePath);
	await mkdir(dir, { recursive: true });

	// Atomic write: write to a sibling temp file, then rename into place.
	const safeUsername = sanitizeUsername(username);
	const tmpFile = join(dir, `.${safeUsername}.${Date.now()}-${randomUUID()}.tmp`);
	await writeFile(tmpFile, data, 'utf-8');
	await rename(tmpFile, filePath);
}
