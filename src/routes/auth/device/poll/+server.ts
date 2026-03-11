import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pollForToken, validateGitHubToken } from '$lib/server/auth/github';
import { config } from '$lib/server/config';
import { logSecurity } from '$lib/server/security-log';
import { clearDeviceFlow, saveSession } from '$lib/server/auth/session-utils';

export const POST: RequestHandler = async ({ locals, getClientAddress }) => {
	if (!locals.session) {
		return json({ error: 'No session available' }, { status: 500 });
	}

	const session = locals.session;
	const deviceCode = session.githubDeviceCode;
	const expiry = session.githubDeviceExpiry;

	if (!deviceCode) {
		return json({ error: 'No active device flow. Call /start first.' }, { status: 400 });
	}

	if (expiry && Date.now() > expiry) {
		await clearDeviceFlow(session);
		return json({ status: 'expired' });
	}

	try {
		const result = await pollForToken(deviceCode);

		// Still waiting — return status directly (no session mutation needed)
		if (result.status === 'pending' || result.status === 'slow_down') {
			return json({ status: result.status });
		}

		// Terminal failures — clean up device flow state
		if (result.status === 'access_denied' || result.status === 'expired') {
			await clearDeviceFlow(session);
			return json({ status: result.status });
		}

		// Authorized — validate token and store
		if (!result.token) throw new Error('Token missing in authorized response');

		const validation = await validateGitHubToken(result.token);
		if (!validation.valid) throw new Error('Could not validate GitHub token');
		const user = validation.user;

		if (
			config.allowedUsers.length > 0 &&
			!config.allowedUsers.includes(user.login.toLowerCase())
		) {
			logSecurity('warn', 'auth_denied_not_allowed', {
				user: user.login,
				ip: getClientAddress(),
			});
			return json(
				{
					status: 'forbidden',
					error: 'Your GitHub account is not authorized to use this application.',
				},
				{ status: 403 }
			);
		}

		delete session.githubDeviceCode;
		delete session.githubDeviceExpiry;
		session.githubToken = result.token;
		session.githubUser = user;
		session.githubAuthTime = Date.now();
		console.log(`[POLL] auth success, saving session. user=${user.login} hasToken=${!!session.githubToken}`);
		await saveSession(session);
		console.log(`[POLL] session saved successfully`);

		logSecurity('info', 'auth_success', { user: user.login });
		return json({ status: 'authorized', githubUser: user.login });
	} catch (err) {
		console.error('GitHub device flow poll error:', err);
		return json({ error: 'Device flow polling failed' }, { status: 500 });
	}
};
