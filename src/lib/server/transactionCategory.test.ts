/**
 * Category filter includes split allocations (#96). Temp database only.
 * Mirrors the category clause in getTransactions (finance.ts): unsplit parent
 * category_id, or a transaction_splits row in one of the selected categories.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './db';

const dir = mkdtempSync(join(tmpdir(), 'galene-cat-'));
const database = new Database(join(dir, 'galene.db'));
database.exec('PRAGMA foreign_keys = ON;');
migrate(database);

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Same predicate as getTransactions when categoryIds is non-empty. */
function idsInCategories(categoryIds: number[]): number[] {
	const placeholders = categoryIds.map(() => '?').join(',');
	const rows = database
		.query(
			`SELECT t.id FROM transactions t
			 WHERE (
				(t.category_id IN (${placeholders}) AND NOT EXISTS (
					SELECT 1 FROM transaction_splits s0 WHERE s0.transaction_id = t.id
				))
				OR EXISTS (
					SELECT 1 FROM transaction_splits s
					WHERE s.transaction_id = t.id AND s.category_id IN (${placeholders})
				)
			)`
		)
		.all(...categoryIds, ...categoryIds) as { id: number }[];
	return rows.map((row) => row.id);
}

describe('category transaction filter', () => {
	test('includes unsplit parent category and matching split parts, excludes other categories', () => {
		database.query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Dev', 'dev@test', 'x', 1)`).run();
		const userId = Number((database.query('SELECT id FROM users').get() as { id: number }).id);
		database.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Card', 'credit')`).run(userId);
		const accountId = Number((database.query('SELECT id FROM accounts').get() as { id: number }).id);
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Food', 'expense')`).run(userId);
		const food = Number((database.query(`SELECT id FROM categories WHERE name = 'Food'`).get() as { id: number }).id);
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Rent', 'expense')`).run(userId);
		const rent = Number((database.query(`SELECT id FROM categories WHERE name = 'Rent'`).get() as { id: number }).id);

		function add(merchant: string, categoryId: number | null) {
			database
				.query(
					`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, category_id)
					 VALUES (?, ?, '2026-09-01', -100, ?, ?)`
				)
				.run(userId, accountId, merchant, categoryId);
			return Number((database.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
		}

		const plain = add('Groceries', food);
		const other = add('Landlord', rent);
		const splitFood = add('Mixed', null);
		database
			.query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)`)
			.run(splitFood, food, 60);
		database
			.query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)`)
			.run(splitFood, rent, 40);
		// Parent category is ignored once splits exist — only the split categories count.
		const splitOther = add('Ignored parent', food);
		database
			.query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)`)
			.run(splitOther, rent, 100);

		const ids = idsInCategories([food]);
		expect(ids).toContain(plain);
		expect(ids).toContain(splitFood);
		expect(ids).not.toContain(other);
		expect(ids).not.toContain(splitOther);
	});
});
