import type { LayoutServerLoad } from './$types';
import { checkAuth } from '$lib/server/auth/guard';

export const load: LayoutServerLoad = async ({ locals }) => {
	console.log(`[LAYOUT-LOAD] locals.session exists=${!!locals.session} hasToken=${!!locals.session?.githubToken} user=${locals.session?.githubUser?.login ?? 'none'}`);
	const auth = checkAuth(locals.session);
	console.log(`[LAYOUT-LOAD] checkAuth result: authenticated=${auth.authenticated} user=${auth.user?.login ?? 'none'} error=${auth.error ?? 'none'}`);
	return {
		authenticated: auth.authenticated,
		user: auth.user,
	};
};
