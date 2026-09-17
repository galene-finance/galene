import { apiUser, json, unauthorized } from '$lib/server/api';
import { listNotifications, unreadCount } from '$lib/server/notifications';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	return json(200, { notifications: listNotifications(user.id), unread: unreadCount(user.id) });
}
