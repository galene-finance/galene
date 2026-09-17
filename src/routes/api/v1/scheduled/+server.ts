import { apiUser, json, unauthorized } from '$lib/server/api';
import { getScheduled } from '$lib/server/finance';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	return json(200, { scheduled: getScheduled(user.id) });
}
