import { describe, expect, test } from 'bun:test';
import { parseExportFilters, parseTransactionFilters } from './transactionFilters';

describe('parseExportFilters', () => {
	test('keeps list filters and drops pagination', () => {
		const url = new URL(
			'https://example.test/transactions/export.csv?account=3&category=4&tag=5&q=rent&date_from=2026-01-01&date_to=2026-01-31&amount_op=gt&amount_from=10&page=2&page_size=25'
		);
		const f = parseExportFilters(url);
		expect(f.accountIds).toEqual([3]);
		expect(f.categoryIds).toEqual([4]);
		expect(f.tagIds).toEqual([5]);
		expect(f.q).toBe('rent');
		expect(f.dateFrom).toBe('2026-01-01');
		expect(f.dateTo).toBe('2026-01-31');
		expect(f.amountOp).toBe('gt');
		expect(f.amountFrom).toBe(1000);
		expect(f.page).toBe(1);
		expect(f.pageSize).toBe(1_000_000);
	});

	test('no query params means unfiltered full set', () => {
		const f = parseExportFilters(new URL('https://example.test/transactions/export.csv'));
		expect(f.accountIds).toEqual([]);
		expect(f.categoryIds).toEqual([]);
		expect(f.tagIds).toEqual([]);
		expect(f.q).toBe('');
		expect(f.dateFrom).toBeNull();
		expect(f.dateTo).toBeNull();
		expect(f.amountOp).toBe('');
		expect(f.page).toBe(1);
		expect(f.pageSize).toBe(1_000_000);
	});
});

describe('parseTransactionFilters', () => {
	test('honors page and page_size on the list', () => {
		const f = parseTransactionFilters(
			new URL('https://example.test/transactions?page=3&page_size=50'),
			25
		);
		expect(f.page).toBe(3);
		expect(f.pageSize).toBe(50);
	});

	test('keeps known empty fields and ignores anything else', () => {
		const f = parseTransactionFilters(
			new URL('https://example.test/transactions?empty=account&empty=nope&empty=merchant&empty=account'),
			25
		);
		expect(f.emptyFields).toEqual(['account', 'merchant']);
	});
});
