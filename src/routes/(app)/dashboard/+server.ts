import { json } from '@sveltejs/kit';
import { saveDashboardLayout } from '$lib/server/dashboard';

/**
 * Saves the dashboard layout (issue #11). A dedicated route rather than a
 * form action on the home page: the client POSTs JSON via fetch, and the
 * (app) layout's auth guard applies here for free.
 */
export async function POST({ request, locals }) {
	if (!locals.user) return json({ ok: false, error: 'Not authenticated' }, { status: 401 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
	}
	const layout = (body as { layout?: unknown })?.layout;
	if (!Array.isArray(layout)) {
		return json({ ok: false, error: 'layout must be an array of widgets' }, { status: 400 });
	}
	try {
		const sanitized = saveDashboardLayout(locals.user.id, layout);
		return json({ ok: true, layout: sanitized });
	} catch {
		return json({ ok: false, error: 'Could not save the layout' }, { status: 500 });
	}
}
