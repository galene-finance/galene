import { describe, expect, test } from 'bun:test';
import { buildExportSearchParams, exportCsvHref, exportPageHref } from './exportQuery';
import { CSV_EXPORT_COLUMNS } from './csvExportColumns';

const base = {
	q: '',
	accountIds: [] as string[],
	categoryIds: [] as string[],
	tagIds: [] as string[],
	emptyFields: [] as string[],
	amountOp: '',
	amountFrom: '',
	amountTo: '',
	dateFrom: '',
	dateTo: '',
	columns: [...CSV_EXPORT_COLUMNS]
};

describe('buildExportSearchParams', () => {
	test('page href omits fields so checkbox state is not a navigation', () => {
		expect(exportPageHref(base)).toBe('/transactions/export');
		const csv = exportCsvHref(base);
		expect(csv.startsWith('/transactions/export.csv?')).toBe(true);
		expect(csv).toContain('fields_present=1');
		expect(csv).toContain('fields=date');
	});

	test('list filters land in the page query; csv href adds fields', () => {
		const state = {
			...base,
			q: 'Daily Grind',
			categoryIds: ['4', '7'],
			amountOp: 'gt',
			amountFrom: '10',
			columns: ['date', 'amount'] as const
		};
		const page = exportPageHref(state);
		const csv = exportCsvHref(state);
		expect(page).toBe(
			'/transactions/export?' + buildExportSearchParams(state, { includeFields: false }).toString()
		);
		expect(page).toContain('q=Daily+Grind');
		expect(page).toContain('category=4');
		expect(page).toContain('category=7');
		expect(page).toContain('amount_op=gt');
		expect(page).not.toContain('fields');
		expect(csv).toContain('fields=date');
		expect(csv).toContain('fields=amount');
		expect(csv).not.toContain('fields=merchant');
		expect(csv.startsWith('/transactions/export.csv?')).toBe(true);
	});

	test('empty fields are repeated empty params', () => {
		const csv = exportCsvHref({ ...base, emptyFields: ['account', 'merchant'] });
		expect(csv).toContain('empty=account');
		expect(csv).toContain('empty=merchant');
	});
});
