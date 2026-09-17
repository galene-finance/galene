import { redirect } from '@sveltejs/kit';

export function load({ locals }) {
	return { isAdmin: Boolean(locals.user?.is_admin) };
}

// Read-only page: a stray POST (e.g. a refresh re-POSTing a stale history
// entry) would otherwise 405. Bounce it back to a GET of the same page.
export const actions = {
	default: ({ url }) => redirect(303, url.pathname + url.search)
};
