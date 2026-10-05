import { handleWriteRequest } from '$lib/server/writeApi';
import { apiUser, json, unauthorized } from '$lib/server/api';
import { getCategories } from '$lib/server/finance';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	return json(200, { categories: getCategories(user.id) });
}

export function POST(event) {
	return handleWriteRequest(event, 'category');
}
