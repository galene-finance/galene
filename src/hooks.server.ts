import { redirect } from '@sveltejs/kit';
import { getUserByToken, isSecureCookie } from '$lib/server/auth';
import { getUserByApiToken } from '$lib/server/apiTokens';
import { startSyncScheduler } from '$lib/server/scheduler';
import { startBackupScheduler } from '$lib/server/backup';
import { assertDataDirOnVolume } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';

// Fail fast (before serving) if the data directory isn't on a persistent volume.
assertDataDirOnVolume();

// Starts the bank-sync auto-sync loop and the scheduled-backup loop, once per process.
startSyncScheduler();
startBackupScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('galene_session');
	let user = null;
	if (token) {
		user = getUserByToken(token);
		if (!user) {
			event.cookies.set('galene_session', '', {
				path: '/',
				maxAge: 0,
				httpOnly: true,
				sameSite: 'lax',
				secure: isSecureCookie()
			});
		}
	}
	// API clients (curl, scripts, the MCP server) authenticate with a
	// bearer token instead of the session cookie.
	if (!user) {
		const auth = event.request.headers.get('authorization');
		if (auth?.startsWith('Bearer ')) {
			user = getUserByApiToken(auth.slice('Bearer '.length).trim());
		}
	}
	event.locals.user = user;

	// Actions run before loads, so the (app) layout's load guard can't protect
	// them. Bounce unauthenticated form submissions to /login instead of
	// letting an action dereference `locals.user!.id` and 500.
	if (
		event.route?.id?.startsWith('/(app)') &&
		!user &&
		['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.request.method)
	) {
		redirect(303, '/login');
	}

	return resolve(event);
};
