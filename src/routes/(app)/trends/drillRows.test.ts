import { describe, expect, test } from 'bun:test';
import { drillRows, type TrendDrillRow } from './+page.server';
import type { Transaction } from '$lib/types';

function tx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'amount_cents'>): Transaction {
	return {
		account_id: 1,
		category_id: null,
		merchant: 'Market',
		notes: null,
		color: null,
		...partial
	};
}

describe('trend drill rows', () => {
	const transfers = new Set([9]);

	test('keeps the category split and drops a transfer split', () => {
		const rows = drillRows(
			[
				tx({
					id: 1,
					date: '2026-01-04',
					amount_cents: -1500,
					merchant: 'Market',
					splits: [
						{ category_id: 3, category_name: 'Groceries', amount_cents: 1000 },
						{ category_id: 9, category_name: 'Transfer', amount_cents: 500 }
					]
				})
			],
			3,
			transfers
		);
		expect(rows).toEqual([
			{
				id: '1-3',
				date: '2026-01-04',
				label: 'Market',
				amountCents: -1000,
				categoryId: 3
			}
		] satisfies TrendDrillRow[]);
	});

	test('all-categories view skips transfer rows and zero amounts', () => {
		const rows = drillRows(
			[
				tx({ id: 2, date: '2026-01-02', amount_cents: -400, category_id: 3, merchant: 'Cafe' }),
				tx({ id: 3, date: '2026-01-03', amount_cents: -200, category_id: 9, merchant: 'Move' }),
				tx({ id: 4, date: '2026-01-04', amount_cents: 0, category_id: 3, merchant: 'Zero' })
			],
			null,
			transfers
		);
		expect(rows.map((r) => r.id)).toEqual(['2']);
		expect(rows[0].amountCents).toBe(-400);
	});

	test('a selected category drops other categories', () => {
		const rows = drillRows(
			[tx({ id: 5, date: '2026-02-01', amount_cents: -800, category_id: 4, merchant: 'Other' })],
			3,
			transfers
		);
		expect(rows).toEqual([]);
	});
});
