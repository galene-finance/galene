import { redirect } from '@sveltejs/kit';
import { parseExportColumns } from '$lib/csvExportColumns';
import { getAccounts, getCategories, getTags, getTransactions } from '$lib/server/finance';
import { parseExportFilters } from '$lib/server/transactionFilters';

export function load({ locals, url }) {
	if (!locals.user) redirect(303, '/login');
	const userId = locals.user.id;
	const filters = parseExportFilters(url);
	const { total } = getTransactions(userId, filters);
	return {
		filters,
		total,
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId),
		columns: parseExportColumns(url)
	};
}
