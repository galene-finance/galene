import type { Transaction } from '$lib/types';
import { centsToDollars } from '$lib/utils';

export const CSV_EXPORT_HEADER = 'date,account,amount,merchant,notes,category,tags';

export function csvField(value: string): string {
	if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function cell(value: string | null | undefined): string {
	return csvField(value ?? '');
}

export function transactionToCsvRow(t: Transaction): string {
	return [
		cell(t.date),
		cell(t.account_name ?? ''),
		cell(centsToDollars(t.amount_cents)),
		cell(t.merchant),
		cell(t.notes),
		cell(t.category_name),
		cell(t.tags?.length ? t.tags.join(';') : '')
	].join(',');
}

export function transactionsToCsv(rows: Transaction[]): string {
	const lines = [CSV_EXPORT_HEADER, ...rows.map(transactionToCsvRow)];
	return lines.join('\n') + '\n';
}
