/**
 * Pending Plaid charge that posts at a different amount (#45).
 * The stale external id is gone from the provider response; the posted row
 * stays, with the posted cents.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './db';
import { mergeRepostedTransactions } from './sync';

const dirs: string[] = [];

function open(): Database {
	const dir = mkdtempSync(join(tmpdir(), 'galene-repost-'));
	dirs.push(dir);
	const database = new Database(join(dir, 'galene.db'));
	database.exec('PRAGMA foreign_keys = ON;');
	migrate(database);
	return database;
}

function seed(database: Database) {
	database.query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Dev', 'dev@test', 'x', 1)`).run();
	const userId = Number((database.query('SELECT id FROM users').get() as { id: number }).id);
	database.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Card', 'credit')`).run(userId);
	const accountId = Number((database.query('SELECT id FROM accounts').get() as { id: number }).id);
	return { userId, accountId };
}

function insertTx(
	database: Database,
	userId: number,
	accountId: number,
	row: { date: string; cents: number; merchant: string; externalId: string; categoryId?: number }
) {
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, category_id)
			 VALUES (?, ?, ?, ?, ?, 'plaid', ?, ?)`
		)
		.run(userId, accountId, row.date, row.cents, row.merchant, row.externalId, row.categoryId ?? null);
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('mergeRepostedTransactions amount change', () => {
	test('drops a stale pending row when the posted amount differs', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Groceries', 'expense')`).run(userId);
		const categoryId = Number((database.query('SELECT id FROM categories').get() as { id: number }).id);
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -38836,
			merchant: 'Kroger',
			externalId: 'pending-388',
			categoryId
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -35504,
			merchant: 'Kroger',
			externalId: 'posted-355'
		});

		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['posted-355']), database)).toBe(1);
		const rows = database
			.query('SELECT amount_cents, external_id, category_id FROM transactions WHERE user_id = ?')
			.all(userId) as { amount_cents: number; external_id: string; category_id: number | null }[];
		expect(rows).toEqual([{ amount_cents: -35504, external_id: 'posted-355', category_id: categoryId }]);
	});

	test('keeps two live charges at the same merchant', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, { date: '2026-09-20', cents: -1000, merchant: 'Kroger', externalId: 'a' });
		insertTx(database, userId, accountId, { date: '2026-09-20', cents: -2000, merchant: 'Kroger', externalId: 'b' });
		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['a', 'b']), database)).toBe(0);
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(2);
	});

	test('does not merge two different posted rows for one stale row', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, { date: '2026-09-20', cents: -38836, merchant: 'Kroger', externalId: 'pending' });
		insertTx(database, userId, accountId, { date: '2026-09-20', cents: -35504, merchant: 'Kroger', externalId: 'posted-a' });
		insertTx(database, userId, accountId, { date: '2026-09-21', cents: -1200, merchant: 'Kroger', externalId: 'posted-b' });
		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['posted-a', 'posted-b']), database)).toBe(0);
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(3);
	});
});
