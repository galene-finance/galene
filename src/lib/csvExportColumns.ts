export const CSV_EXPORT_COLUMNS = [
	'date',
	'account',
	'amount',
	'merchant',
	'notes',
	'category',
	'tags'
] as const;

export type CsvExportColumn = (typeof CSV_EXPORT_COLUMNS)[number];

export const CSV_EXPORT_HEADER = CSV_EXPORT_COLUMNS.join(',');

/**
 * `fields` query values, in canonical order.
 * Missing `fields` (and no `fields_present`) means every column.
 * `fields_present` with none selected means an empty list (caller rejects).
 */
export function parseExportColumns(url: URL): CsvExportColumn[] {
	const raw = url.searchParams.getAll('fields');
	const selected = CSV_EXPORT_COLUMNS.filter((column) => raw.includes(column));
	if (selected.length > 0) return selected;
	if (url.searchParams.has('fields_present') || raw.length > 0) return [];
	return [...CSV_EXPORT_COLUMNS];
}
