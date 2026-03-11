import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearAuth } from '$lib/server/auth/session-utils';

export const POST: RequestHandler = async ({ locals }) => {
	if (locals.session) {
		await clearAuth(locals.session);
	}
	return json({ success: true });
};
