import { describe, expect, test } from 'bun:test';
import {
	formatRepeat,
	popupPosition,
	scheduledPillRows,
	transactionPillRows
} from './calendarPillPopup';
import type { Scheduled, Transaction } from './types';

function txn(over: Partial<Transaction> = {}): Transaction {
	return {
		id: 1,
		account_id: 1,
		category_id: 2,
		date: '2026-09-21',
		amount_cents: -1250,
		merchant: 'Cafe Luna',
		notes: 'Iced latte',
		color: null,
		account_name: 'Checking',
		category_name: 'Coffee',
		tags: ['work', 'treat'],
		...over
	};
}

function scheduled(over: Partial<Scheduled> = {}): Scheduled {
	return {
		id: 9,
		name: 'Rent',
		account_id: 1,
		category_id: 3,
		amount_cents: -180000,
		start_date: '2026-01-01',
		repeat_interval: 1,
		repeat_unit: 'month',
		until_date: '2026-12-01',
		forecast_behavior: 'bill',
		color: null,
		notes: 'Due on the 1st',
		account_name: 'Checking',
		category_name: 'Housing',
		tags: ['bills'],
		...over
	};
}

function labels(rows: { label: string }[]): string[] {
	return rows.map((r) => r.label);
}

function value(rows: { label: string; value: string }[], label: string): string | undefined {
	return rows.find((r) => r.label === label)?.value;
}

describe('transactionPillRows', () => {
	test('lists filled fields in order and omits empties', () => {
		expect(transactionPillRows(txn())).toEqual([
			{ label: 'Name', value: 'Cafe Luna' },
			{ label: 'Amount', value: '-$12.50' },
			{ label: 'Start', value: 'Sep 21, 2026' },
			{ label: 'Notes', value: 'Iced latte' },
			{ label: 'Tags', value: 'work, treat' },
			{ label: 'Account', value: 'Checking' },
			{ label: 'Category', value: 'Coffee' }
		]);
	});

	test('omits notes, tags, account, and category when empty', () => {
		const rows = transactionPillRows(
			txn({
				notes: '   ',
				tags: [],
				account_name: '',
				category_name: null,
				category_id: null
			})
		);
		expect(labels(rows)).toEqual(['Name', 'Amount', 'Start']);
		expect(value(rows, 'Name')).toBe('Cafe Luna');
	});

	test('uses category name then Transaction when merchant is missing', () => {
		expect(value(transactionPillRows(txn({ merchant: null })), 'Name')).toBe('Coffee');
		expect(
			value(
				transactionPillRows(txn({ merchant: null, category_name: null, category_id: null })),
				'Name'
			)
		).toBe('Transaction');
	});

	test('does not invent until or repeat rows', () => {
		expect(labels(transactionPillRows(txn()))).not.toContain('Until');
		expect(labels(transactionPillRows(txn()))).not.toContain('Repeat');
	});

	test('shows splits as the category value when present', () => {
		const rows = transactionPillRows(
			txn({
				category_name: 'Parent',
				splits: [
					{ category_id: 2, category_name: 'Coffee', amount_cents: -400 },
					{ category_id: 4, category_name: 'Snack', amount_cents: -850 }
				]
			})
		);
		expect(value(rows, 'Category')).toBe('Coffee -$4.00, Snack -$8.50');
	});
});

describe('scheduledPillRows', () => {
	test('repeating item with until shows cadence and until', () => {
		const rows = scheduledPillRows(scheduled());
		expect(value(rows, 'Name')).toBe('Rent');
		expect(value(rows, 'Amount')).toBe('-$1,800.00');
		expect(value(rows, 'Start')).toBe('Jan 1, 2026');
		expect(value(rows, 'Until')).toBe('Dec 1, 2026');
		expect(value(rows, 'Repeat')).toBe('Every month');
		expect(value(rows, 'Notes')).toBe('Due on the 1st');
		expect(value(rows, 'Tags')).toBe('bills');
		expect(value(rows, 'Account')).toBe('Checking');
		expect(value(rows, 'Category')).toBe('Housing');
	});

	test('one-off item omits until and repeat', () => {
		const rows = scheduledPillRows(
			scheduled({
				repeat_interval: null,
				repeat_unit: null,
				until_date: null,
				notes: null,
				tags: [],
				account_name: null,
				category_name: null
			})
		);
		expect(labels(rows)).toEqual(['Name', 'Amount', 'Start']);
	});

	test('repeat without until omits the until row', () => {
		const rows = scheduledPillRows(scheduled({ until_date: null, notes: null, tags: [] }));
		expect(labels(rows)).toEqual(['Name', 'Amount', 'Start', 'Repeat', 'Account', 'Category']);
		expect(value(rows, 'Repeat')).toBe('Every month');
	});
});

describe('formatRepeat', () => {
	test('returns null without a positive interval and unit', () => {
		expect(formatRepeat(null, 'month')).toBeNull();
		expect(formatRepeat(1, null)).toBeNull();
		expect(formatRepeat(0, 'week')).toBeNull();
	});

	test('pluralizes interval greater than one', () => {
		expect(formatRepeat(1, 'week')).toBe('Every week');
		expect(formatRepeat(2, 'week')).toBe('Every 2 weeks');
	});
});

describe('popupPosition', () => {
	test('flips above when the pill is near the bottom of the viewport', () => {
		const below = popupPosition(
			{ top: 100, bottom: 120, left: 40, width: 80 },
			{ width: 800, height: 600 }
		);
		expect(below.top).toBe(126);
		expect(below.left).toBe(40);
		const above = popupPosition(
			{ top: 500, bottom: 520, left: 40, width: 80 },
			{ width: 800, height: 600 }
		);
		expect(above.top).toBe(500 - 160 - 6);
	});

	test('keeps the popup inside the viewport on the right edge', () => {
		const pos = popupPosition(
			{ top: 40, bottom: 60, left: 700, width: 80 },
			{ width: 800, height: 600 }
		);
		expect(pos.left).toBe(800 - 224 - 8);
	});
});
