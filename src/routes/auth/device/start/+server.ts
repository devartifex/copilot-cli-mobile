import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestDeviceCode } from '$lib/server/auth/github';
import { saveSession } from '$lib/server/auth/session-utils';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.session) {
		return json({ error: 'No session available' }, { status: 500 });
	}

	try {
		const deviceData = await requestDeviceCode();

		locals.session.githubDeviceCode = deviceData.device_code;
		locals.session.githubDeviceExpiry = Date.now() + deviceData.expires_in * 1000;
		await saveSession(locals.session);

		return json({
			user_code: deviceData.user_code,
			verification_uri: deviceData.verification_uri,
			expires_in: deviceData.expires_in,
			interval: deviceData.interval,
		});
	} catch (err) {
		console.error('GitHub device flow start error:', err);
		return json({ error: 'Failed to start device flow' }, { status: 500 });
	}
};
