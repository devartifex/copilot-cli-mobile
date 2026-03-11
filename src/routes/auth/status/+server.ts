import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkAuth } from '$lib/server/auth/guard';
import { clearAuth } from '$lib/server/auth/session-utils';

export const GET: RequestHandler = async ({ locals }) => {
	const session = locals.session;
	const auth = checkAuth(session);

	if (session?.githubToken && !auth.authenticated) {
		await clearAuth(session);
	}

	return json({
		authenticated: auth.authenticated,
		githubUser: auth.user?.login ?? null,
	});
};
