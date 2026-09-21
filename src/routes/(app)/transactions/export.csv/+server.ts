import { redirect, type RequestEvent } from '@sveltejs/kit';
import { transactionsToCsv } from '$lib/server/csvExport';
import { getTransactions } from '$lib/server/finance';
import { parseExportFilters } from '$lib/server/transactionFilters';
import { todayISO } from '$lib/utils';

export function GET({ locals, url }: RequestEvent) {
	if (!locals.user) redirect(303, '/login');
	const filters = parseExportFilters(url);
	const { items } = getTransactions(locals.user.id, filters);
	return new Response(transactionsToCsv(items), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="galene-transactions-${todayISO()}.csv"`
		}
	});
}
