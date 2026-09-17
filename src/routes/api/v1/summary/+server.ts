import { apiUser, json, unauthorized } from '$lib/server/api';
import { getHomeSummary } from '$lib/server/finance';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	return json(200, getHomeSummary(user.id));
}
