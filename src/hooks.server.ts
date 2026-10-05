import { redirect } from '@sveltejs/kit';
import { getUserByToken, isSecureCookie } from '$lib/server/auth';
import { resolveApiToken } from '$lib/server/apiTokens';
import { getViewerByToken } from '$lib/server/advisor';
import { forbidViewerMutation, guardViewerPage } from '$lib/server/viewerGuard';
import { startSyncScheduler } from '$lib/server/scheduler';
import { startBackupScheduler } from '$lib/server/backup';
import { assertDataDirOnVolume } from '$lib/server/db';
import { db } from '$lib/server/db';
import { ensureDemoBootstrap, isDemoMode } from '$lib/server/demoMode';
import { guardDemoMode } from '$lib/server/demoGuard';
import type { Handle } from '@sveltejs/kit';

// Fail fast (before serving) if the data directory isn't on a persistent volume.
assertDataDirOnVolume();

// Public demo: seed the shared login, and skip bank-sync / backup loops
// (those features are locked; no real providers or backup destinations).
ensureDemoBootstrap();
if (!isDemoMode()) {
	startSyncScheduler();
	startBackupScheduler();
}

export const handle: Handle = async ({ event, resolve }) => {
	const demo = isDemoMode();
	const token = event.cookies.get('galene_session');
	let user = null;
	event.locals.viewer = null;
	event.locals.apiToken = null;
	// Viewer magic-link sessions share the session cookie name but live in
	// their own table. Check them first so a viewer is never treated as owner.
	// Demo mode locks advisor access — ignore viewer sessions entirely.
	if (token && !demo) {
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
	// Demo mode locks API tokens — do not accept Bearer auth.
	if (!user && !demo) {
		const auth = event.request.headers.get('authorization');
		if (auth?.startsWith('Bearer ')) {
			const resolved = resolveApiToken(auth.slice('Bearer '.length).trim());
			if (resolved) {
				user = { ...resolved.user, role: 'owner' as const };
				event.locals.apiToken = { id: resolved.tokenId, scope: resolved.scope };
			}
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
	guardDemoMode(event);

	return resolve(event);
};
