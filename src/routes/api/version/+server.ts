import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRequire } from 'module';

let sdkVersion = 'unknown';
try {
	const require = createRequire(import.meta.url);
	const sdkPkg = require('@github/copilot-sdk/package.json') as { version: string };
	sdkVersion = sdkPkg.version;
} catch {
	// keep 'unknown' if resolution fails
}

export const GET: RequestHandler = async () => {
	return json({ sdkVersion });
};
