import { describe, expect, test } from 'bun:test';
import { CSV_EXPORT_HEADER, csvField, transactionToCsvRow, transactionsToCsv } from './csvExport';
import type { Transaction } from '../types';

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

describe('csvField', () => {
	test('quotes commas, quotes, and newlines', () => {
		expect(csvField('plain')).toBe('plain');
		expect(csvField('a,b')).toBe('"a,b"');
		expect(csvField('say "hi"')).toBe('"say ""hi"""');
		expect(csvField('line\nbreak')).toBe('"line\nbreak"');
	});
});

describe('transactionToCsvRow', () => {
	test('writes import columns with signed dollars', () => {
		expect(transactionToCsvRow(txn())).toBe(
			'2026-09-21,Checking,-12.50,Cafe Luna,Iced latte,Coffee,work;treat'
		);
		expect(transactionToCsvRow(txn({ amount_cents: 250000, merchant: 'Employer' }))).toBe(
			'2026-09-21,Checking,2500.00,Employer,Iced latte,Coffee,work;treat'
		);
	});

	test('empty merchant, notes, category, and tags are blank fields, not null', () => {
		const row = transactionToCsvRow(
			txn({
				merchant: null,
				notes: null,
				category_name: null,
				category_id: null,
				tags: []
			})
		);
		expect(row).toBe('2026-09-21,Checking,-12.50,,,,');
		expect(row).not.toContain('null');
		expect(row).not.toContain('undefined');
	});

	test('uses primary category_name, not split labels', () => {
		const row = transactionToCsvRow(
			txn({
				category_name: 'Groceries',
				splits: [
					{ category_id: 2, category_name: 'Coffee', amount_cents: -400 },
					{ category_id: 4, category_name: 'Snack', amount_cents: -850 }
				]
			})
		);
		expect(row).toContain(',Groceries,');
		expect(row).not.toContain('Coffee');
		expect(row).not.toContain('Snack');
	});
});

describe('transactionsToCsv', () => {
	test('header matches the import template and a file ends with a newline', () => {
		const csv = transactionsToCsv([txn()]);
		expect(csv.startsWith(CSV_EXPORT_HEADER + '\n')).toBe(true);
		expect(CSV_EXPORT_HEADER).toBe('date,account,amount,merchant,notes,category,tags');
		expect(csv.endsWith('\n')).toBe(true);
		expect(csv.trim().split('\n')).toHaveLength(2);
	});

	test('header only when there are no rows', () => {
		expect(transactionsToCsv([])).toBe(CSV_EXPORT_HEADER + '\n');
	});
});
