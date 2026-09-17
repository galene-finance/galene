import { generateComputedAlerts, listNotifications, markAllRead, markRead, unreadCount } from '$lib/server/notifications';

function payload(userId: number) {
	return { notifications: listNotifications(userId), unread: unreadCount(userId) };
}

/**
 * The notification bell refetches this on open, so the list (and the derived
 * alerts it triggers) is always current even if the page load is stale.
 */
export function GET({ locals }) {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	generateComputedAlerts(locals.user.id);
	return Response.json(payload(locals.user.id));
}

export async function POST({ request, locals }) {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	const body = (await request.json().catch(() => null)) as
		| { action?: string; id?: number }
		| null;
	if (body?.action === 'mark_read' && typeof body.id === 'number') {
		markRead(locals.user.id, body.id);
	} else if (body?.action === 'mark_all') {
		markAllRead(locals.user.id);
	} else {
		return new Response('Bad request', { status: 400 });
	}
	return Response.json(payload(locals.user.id));
}
