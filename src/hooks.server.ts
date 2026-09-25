import { redirect } from '@sveltejs/kit';
import { getUserByToken, isSecureCookie } from '$lib/server/auth';
import { getUserByApiToken } from '$lib/server/apiTokens';
import { getViewerByToken } from '$lib/server/advisor';
import { forbidViewerMutation, guardViewerPage } from '$lib/server/viewerGuard';
import { startSyncScheduler } from '$lib/server/scheduler';
import { startBackupScheduler } from '$lib/server/backup';
import { assertDataDirOnVolume } from '$lib/server/db';
import { db } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';

// Fail fast (before serving) if the data directory isn't on a persistent volume.
assertDataDirOnVolume();

// Starts the bank-sync auto-sync loop and the scheduled-backup loop, once per process.
startSyncScheduler();
startBackupScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('galene_session');
	let user = null;
	event.locals.viewer = null;
	// Viewer magic-link sessions share the session cookie name but live in
	// their own table. Check them first so a viewer is never treated as owner.
	if (token) {
		const viewer = getViewerByToken(token);
		if (viewer) {
			const owner = db()
				.query('SELECT id, name, email, is_admin FROM users WHERE id = ?')
				.get(viewer.userId) as { id: number; name: string; email: string; is_admin: number } | null;
			if (owner) {
				user = { ...owner, role: 'viewer' as const };
				event.locals.viewer = { grantId: viewer.grantId, scope: viewer.scope };
			}
		}
	}
	if (!user && token) {
		user = getUserByToken(token);
		if (user) user = { ...user, role: 'owner' as const };
	}
	if (!user && token) {
		event.cookies.set('galene_session', '', {
			path: '/',
			maxAge: 0,
			httpOnly: true,
			sameSite: 'lax',
			secure: isSecureCookie()
		});
	}
	// API clients (curl, scripts, the MCP server) authenticate with a
	// bearer token instead of the session cookie. Tokens are owner-scoped.
	if (!user) {
		const auth = event.request.headers.get('authorization');
		if (auth?.startsWith('Bearer ')) {
			const apiUser = getUserByApiToken(auth.slice('Bearer '.length).trim());
			if (apiUser) user = { ...apiUser, role: 'owner' as const };
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

	forbidViewerMutation(event);
	guardViewerPage(event);

	return resolve(event);
};
