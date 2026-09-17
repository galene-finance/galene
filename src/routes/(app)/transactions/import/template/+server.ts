import { CSV_IMPORT_TEMPLATE } from '$lib/server/csvImport';

export function GET() {
	return new Response(CSV_IMPORT_TEMPLATE, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="galene-transactions-template.csv"'
		}
	});
}
