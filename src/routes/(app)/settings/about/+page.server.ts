import { redirect } from '@sveltejs/kit';
import { versionInfo } from '$lib/version';

export function load() {
	return { version: versionInfo() };
}

// Read-only page: a stray POST (e.g. a refresh re-POSTing a stale history
// entry) would otherwise 405. Bounce it back to a GET of the same page.
export const actions = {
	default: ({ url }) => redirect(303, url.pathname + url.search)
};
