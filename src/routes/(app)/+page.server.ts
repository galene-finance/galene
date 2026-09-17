import { redirect } from '@sveltejs/kit';
import { WIDGET_CATALOG_LIST } from '$lib/dashboard';
import { computeDashboardData, getDashboardLayout } from '$lib/server/dashboard';
import { getAccounts, getCategories, getTags } from '$lib/server/finance';

export function load({ locals, depends }) {
	depends('settings');
	const userId = locals.user!.id;
	const layout = getDashboardLayout(userId);
	return {
		layout,
		widgets: computeDashboardData(userId, layout),
		catalog: WIDGET_CATALOG_LIST,
		// The filter dialogs need the full pick lists; the (app) layout fetches
		// its own copies for the TopNav, so the page loads its own.
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId)
	};
}

// Read-only page: a stray POST (e.g. a refresh re-POSTing a stale history
// entry) would otherwise 405. Bounce it back to a GET of the same page.
export const actions = {
	default: ({ url }) => redirect(303, url.pathname + url.search)
};
