/**
 * Ambiguous orphan review queue (#127): enqueue when auto-fold has no clear
 * winner; keep / dismiss / fold triage.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './db';
import {
	countOpenSyncReviews,
	listOpenSyncReviews,
	mergeRepostedTransactions,
	resolveSyncReview
} from './sync';

const dirs: string[] = [];

function open(): Database {
	const dir = mkdtempSync(join(tmpdir(), 'galene-review-'));
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
	row: { date: string; cents: number; merchant: string; externalId: string; pending?: boolean }
) {
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending)
			 VALUES (?, ?, ?, ?, ?, 'plaid', ?, ?)`
		)
		.run(userId, accountId, row.date, row.cents, row.merchant, row.externalId, row.pending ? 1 : 0);
	return Number((database.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sync review queue', () => {
	test('queues an orphan when two live amounts are equally close', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		const orphanId = insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -30000,
			merchant: 'Grocery',
			externalId: 'orphan',
			pending: true
		});
		const a = insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -28000,
			merchant: 'Grocery',
			externalId: 'live-a'
		});
		const b = insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -32000,
			merchant: 'Grocery',
			externalId: 'live-b'
		});
		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database)).toBe(0);
		expect(countOpenSyncReviews(userId, database)).toBe(1);
		const items = listOpenSyncReviews(userId, database);
		expect(items).toHaveLength(1);
		expect(items[0]?.orphan_transaction_id).toBe(orphanId);
		expect(new Set(items[0]?.candidates.map((c) => c.id))).toEqual(new Set([a, b]));
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(3);
	});

	test('keep both resolves without deleting rows', () => {
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
		mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database);
		const reviewId = listOpenSyncReviews(userId, database)[0]!.id;
		expect(resolveSyncReview(userId, reviewId, 'keep', undefined, database)).toEqual({ ok: true });
		expect(countOpenSyncReviews(userId, database)).toBe(0);
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(3);
		// A later sync does not reopen a kept item.
		expect(mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database)).toBe(0);
		expect(countOpenSyncReviews(userId, database)).toBe(0);
	});

	test('fold into a candidate deletes the orphan and resolves the item', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		const orphanId = insertTx(database, userId, accountId, {
			date: '2026-09-20',
			cents: -30000,
			merchant: 'Grocery',
			externalId: 'orphan'
		});
		const a = insertTx(database, userId, accountId, {
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
		mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database);
		const reviewId = listOpenSyncReviews(userId, database)[0]!.id;
		expect(resolveSyncReview(userId, reviewId, 'fold', a, database)).toEqual({ ok: true });
		expect(countOpenSyncReviews(userId, database)).toBe(0);
		const ids = (
			database.query('SELECT id FROM transactions WHERE user_id = ? ORDER BY id').all(userId) as { id: number }[]
		).map((r) => r.id);
		expect(ids).not.toContain(orphanId);
		expect(ids).toContain(a);
		expect(ids).toHaveLength(2);
	});

	test('dismiss resolves without folding', () => {
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
		mergeRepostedTransactions(userId, 'plaid', '2026-09-13', new Set(['live-a', 'live-b']), database);
		const reviewId = listOpenSyncReviews(userId, database)[0]!.id;
		expect(resolveSyncReview(userId, reviewId, 'dismiss', undefined, database)).toEqual({ ok: true });
		expect(countOpenSyncReviews(userId, database)).toBe(0);
		expect((database.query('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(3);
	});
});
