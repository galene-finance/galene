import type { Transaction } from '$lib/types';
import { centsToDollars } from '$lib/utils';
import { type CsvExportColumn, CSV_EXPORT_COLUMNS } from '$lib/csvExportColumns';

export {
	CSV_EXPORT_COLUMNS,
	CSV_EXPORT_HEADER,
	parseExportColumns,
	type CsvExportColumn
} from '$lib/csvExportColumns';

export function csvField(value: string): string {
	if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function cell(value: string | null | undefined): string {
	return csvField(value ?? '');
}

function columnValue(t: Transaction, column: CsvExportColumn): string {
	switch (column) {
		case 'date':
			return cell(t.date);
		case 'account':
			return cell(t.account_name ?? '');
		case 'amount':
			return cell(centsToDollars(t.amount_cents));
		case 'merchant':
			return cell(t.merchant);
		case 'notes':
			return cell(t.notes);
		case 'category':
			return cell(t.category_name);
		case 'tags':
			return cell(t.tags?.length ? t.tags.join(';') : '');
	}
}

export function transactionToCsvRow(
	t: Transaction,
	columns: readonly CsvExportColumn[] = CSV_EXPORT_COLUMNS
): string {
	return columns.map((column) => columnValue(t, column)).join(',');
}

export function transactionsToCsv(
	rows: Transaction[],
	columns: readonly CsvExportColumn[] = CSV_EXPORT_COLUMNS
): string {
	const header = columns.join(',');
	const lines = [header, ...rows.map((row) => transactionToCsvRow(row, columns))];
	return lines.join('\n') + '\n';
}
