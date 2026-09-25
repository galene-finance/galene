import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { parseExportColumns } from '$lib/csvExportColumns';
import { transactionsToCsv } from '$lib/server/csvExport';
import { parseExportFilters } from '$lib/server/transactionFilters';
import { scopedTransactions, viewerScope } from '$lib/server/scopeQuery';
import { todayISO } from '$lib/utils';

export function GET({ locals, url }: RequestEvent) {
	if (!locals.user) redirect(303, '/login');
	const columns = parseExportColumns(url);
	if (columns.length === 0) {
		error(400, 'Select at least one field to export.');
	}
	const filters = parseExportFilters(url);
	const { items } = scopedTransactions(locals.user.id, filters, viewerScope({ locals }));
	return new Response(transactionsToCsv(items, columns), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="galene-transactions-${todayISO()}.csv"`
		}
	});
}
