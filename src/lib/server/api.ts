import type { RequestEvent } from '@sveltejs/kit';
import type { User } from '$lib/types';

/** The request's authenticated user (session cookie or API token), or null. */
export function apiUser(event: RequestEvent): User | null {
	return event.locals.user;
}

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
}

/** 401 for unauthenticated API requests. */
export function unauthorized(): Response {
	return json(401, { error: 'Unauthorized. Authenticate with an API token (Authorization: Bearer <token>).' });
}

/** Parse a comma-separated list of positive integer ids from a query param. */
export function idList(value: string | null): number[] {
	if (!value) return [];
	return value
		.split(',')
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
}
