import { error, redirect, type RequestEvent } from '@sveltejs/kit';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Read-only viewer routes. Anything else under (app) is hidden from viewers.
 * Export is a GET of a frozen pack, so it stays on this list.
 */
const VIEWER_PAGES = new Set([
	'/(app)',
	'/(app)/transactions',
	'/(app)/transactions/export',
	'/(app)/trends',
	'/(app)/settings/accounts',
	'/(app)/settings/categories'
]);

const VIEWER_GETS = new Set([
	'/(app)/transactions/export.csv'
]);

/** Form actions and API writes are refused for a viewer principal. */
export function forbidViewerMutation(event: RequestEvent) {
	if (!event.locals.viewer) return;
	if (!MUTATING.has(event.request.method)) return;
	// Login and the public pack link are not app mutations.
	const id = event.route.id ?? '';
	if (id === '/login' || id.startsWith('/advisor/')) return;
	error(403, 'Read-only advisor access cannot change data.');
}

/** Bounce a viewer away from owner-only pages before their load runs. */
export function guardViewerPage(event: RequestEvent) {
	const viewer = event.locals.viewer;
	if (!viewer) return;
	const id = event.route.id ?? '';
	if (!id.startsWith('/(app)')) return;
	if (event.request.method === 'GET' || event.request.method === 'HEAD') {
		if (VIEWER_PAGES.has(id) || VIEWER_GETS.has(id)) return;
		redirect(303, '/transactions');
	}
}
