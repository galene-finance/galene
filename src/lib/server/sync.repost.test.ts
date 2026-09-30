/**
 * Pending Plaid charge that posts at a different amount (#45), including
 * grocery-style auth→adjust when another same-merchant charge is live (#125).
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
	row: { date: string; cents: number; merchant: string; externalId: string; categoryId?: number; createdAt?: string }
) {
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, category_id, created_at)
			 VALUES (?, ?, ?, ?, ?, 'plaid', ?, ?, COALESCE(?, datetime('now')))`
		)
		.run(
			userId,
			accountId,
			row.date,
			row.cents,
			row.merchant,
			row.externalId,
			row.categoryId ?? null,
			row.createdAt ?? null
		);
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

	test('folds a grocery auth into the closest live amount when another same-merchant charge is live', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -29798,
			merchant: 'Grocery',
			externalId: 'orphan-auth'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -28259,
			merchant: 'Grocery',
			externalId: 'live-adjusted'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -5000,
			merchant: 'Grocery',
			externalId: 'live-other'
		});
		expect(
			mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-adjusted', 'live-other']), database)
		).toBe(1);
		const rows = database
			.query('SELECT amount_cents, external_id FROM transactions WHERE user_id = ? ORDER BY amount_cents ASC')
			.all(userId) as { amount_cents: number; external_id: string }[];
		expect(rows).toEqual([
			{ amount_cents: -28259, external_id: 'live-adjusted' },
			{ amount_cents: -5000, external_id: 'live-other' }
		]);
	});

	test('folds an auth orphan when the settled amount shares the window with other same-merchant lives', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, {
			date: '2026-09-18',
			cents: -38836,
			merchant: 'Kroger',
			externalId: 'pending-388'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-19',
			cents: -35504,
			merchant: 'Kroger',
			externalId: 'posted-355'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -1200,
			merchant: 'Kroger',
			externalId: 'posted-tip'
		});
		expect(
			mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['posted-355', 'posted-tip']), database)
		).toBe(1);
		const rows = database
			.query('SELECT amount_cents, external_id FROM transactions WHERE user_id = ? ORDER BY amount_cents ASC')
			.all(userId) as { amount_cents: number; external_id: string }[];
		expect(rows).toEqual([
			{ amount_cents: -35504, external_id: 'posted-355' },
			{ amount_cents: -1200, external_id: 'posted-tip' }
		]);
	});

	test('does not merge when two live same-merchant amounts are equally close', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -30000,
			merchant: 'Grocery',
			externalId: 'orphan'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -28000,
			merchant: 'Grocery',
			externalId: 'live-a'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -32000,
			merchant: 'Grocery',
			externalId: 'live-b'
		});
		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database)).toBe(0);
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(3);
	});

	test('prefers the same-calendar-day live row when amount deltas tie', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -30000,
			merchant: 'Grocery',
			externalId: 'orphan',
			createdAt: '2026-09-20 10:00:00'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -28000,
			merchant: 'Grocery',
			externalId: 'live-same-day',
			createdAt: '2026-09-20 12:00:00'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-21',
			cents: -28000,
			merchant: 'Grocery',
			externalId: 'live-next-day',
			createdAt: '2026-09-21 09:00:00'
		});
		expect(
			mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-same-day', 'live-next-day']), database)
		).toBe(1);
		const rows = database
			.query('SELECT external_id FROM transactions WHERE user_id = ? ORDER BY external_id')
			.all(userId) as { external_id: string }[];
		expect(rows.map((r) => r.external_id)).toEqual(['live-next-day', 'live-same-day']);
	});

	test('reconsiders an orphan whose date is inside the longer fetch lookback', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		// Auth on D1; settled copy on D1+2. A 7-day since from a later max
		// would skip D1; the 14-day fetch lookback still includes it.
		insertTx(database, userId, accountId, {
			date: '2026-09-10',
			cents: -38836,
			merchant: 'Kroger',
			externalId: 'pending-old'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-12',
			cents: -35504,
			merchant: 'Kroger',
			externalId: 'posted-settled'
		});
		insertTx(database, userId, accountId, {
			date: '2026-09-12',
			cents: -2100,
			merchant: 'Kroger',
			externalId: 'posted-other'
		});
		expect(
			mergeRepostedTransactions(userId, 'plaid', '2026-09-10', new Set(['posted-settled', 'posted-other']), database)
		).toBe(1);
		const rows = database
			.query('SELECT amount_cents, external_id FROM transactions WHERE user_id = ? ORDER BY amount_cents ASC')
			.all(userId) as { amount_cents: number; external_id: string }[];
		expect(rows).toEqual([
			{ amount_cents: -35504, external_id: 'posted-settled' },
			{ amount_cents: -2100, external_id: 'posted-other' }
		]);
	});
});
