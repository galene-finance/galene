import { CSV_EXPORT_COLUMNS, type CsvExportColumn } from '$lib/csvExportColumns';

export type ExportQueryState = {
	q: string;
	accountIds: readonly string[];
	categoryIds: readonly string[];
	tagIds: readonly string[];
	emptyFields: readonly string[];
	amountOp: string;
	amountFrom: string;
	amountTo: string;
	dateFrom: string;
	dateTo: string;
	columns: readonly CsvExportColumn[];
};

export function buildExportSearchParams(
	state: ExportQueryState,
	opts?: { includeFields?: boolean }
): URLSearchParams {
	const params = new URLSearchParams();
	const q = state.q.trim();
	if (q) params.set('q', q);
	for (const id of state.accountIds) params.append('account', id);
	for (const id of state.categoryIds) params.append('category', id);
	for (const id of state.tagIds) params.append('tag', id);
	for (const field of state.emptyFields) params.append('empty', field);
	if (state.amountOp) {
		params.set('amount_op', state.amountOp);
		if (state.amountFrom) params.set('amount_from', state.amountFrom);
		if (state.amountOp === 'between' && state.amountTo) params.set('amount_to', state.amountTo);
	}
	if (state.dateFrom) params.set('date_from', state.dateFrom);
	if (state.dateTo) params.set('date_to', state.dateTo);
	if (opts?.includeFields !== false) {
		params.set('fields_present', '1');
		for (const column of CSV_EXPORT_COLUMNS) {
			if (state.columns.includes(column)) params.append('fields', column);
		}
	}
	return params;
}

export function exportPageHref(state: ExportQueryState): string {
	const q = buildExportSearchParams(state, { includeFields: false }).toString();
	return q ? `/transactions/export?${q}` : '/transactions/export';
}

export function exportCsvHref(state: ExportQueryState): string {
	return `/transactions/export.csv?${buildExportSearchParams(state, { includeFields: true }).toString()}`;
}
