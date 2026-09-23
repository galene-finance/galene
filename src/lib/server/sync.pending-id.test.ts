/**
 * Plaid posts a charge while the pending id is still in the feed (#57).
 * The posted row keeps its amount, date, and id. The pending row is deleted.
 * User fields copy only where the posted row is empty.
 * A pending row the same response already posts is not inserted.
 * Same merchant and amount without that id both stay.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './db';
import { foldPendingIntoPosted, isPendingAlreadyPosted, pendingIdsReplacedInResponse } from './sync';

const dirs: string[] = [];

function open(): Database {
	const dir = mkdtempSync(join(tmpdir(), 'galene-pending-id-'));
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
	database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Food', 'expense')`).run(userId);
	const categoryId = Number((database.query('SELECT id FROM categories').get() as { id: number }).id);
	return { userId, accountId, categoryId };
}

function insertTx(
	database: Database,
	userId: number,
	accountId: number,
	externalId: string,
	opts: { date?: string; amount?: number; merchant?: string; categoryId?: number | null; notes?: string | null }
) {
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, notes, provider, external_id, category_id)
			 VALUES (?, ?, ?, ?, ?, ?, 'plaid', ?, ?)`
		)
		.run(
			userId,
			accountId,
			opts.date ?? '2026-09-01',
			opts.amount ?? -1000,
			opts.merchant ?? 'Cafe',
			opts.notes ?? null,
			externalId,
			opts.categoryId ?? null
		);
	return Number((database.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('foldPendingIntoPosted', () => {
	test('deletes the pending row and keeps the posted amount, date, and id', () => {
		const database = open();
		const { userId, accountId, categoryId } = seed(database);
		const pendingId = insertTx(database, userId, accountId, 'pending-1', {
			date: '2026-09-01',
			amount: -1000,
			categoryId,
			notes: 'lunch'
		});
		const postedId = insertTx(database, userId, accountId, 'posted-1', {
			date: '2026-09-03',
			amount: -1250,
			notes: null
		});
		foldPendingIntoPosted(userId, 'plaid', accountId, 'pending-1', 'posted-1', database);
		const rows = database.query('SELECT id, external_id, date, amount_cents, category_id, notes FROM transactions').all() as {
			id: number;
			external_id: string;
			date: string;
			amount_cents: number;
			category_id: number | null;
			notes: string | null;
		}[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(postedId);
		expect(rows[0]?.id).not.toBe(pendingId);
		expect(rows[0]?.external_id).toBe('posted-1');
		expect(rows[0]?.date).toBe('2026-09-03');
		expect(rows[0]?.amount_cents).toBe(-1250);
		expect(rows[0]?.category_id).toBe(categoryId);
		expect(rows[0]?.notes).toBe('lunch');
	});

	test('does not overwrite user fields the posted row already has', () => {
		const database = open();
		const { userId, accountId, categoryId } = seed(database);
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Travel', 'expense')`).run(userId);
		const other = Number(
			(database.query(`SELECT id FROM categories WHERE name = 'Travel'`).get() as { id: number }).id
		);
		insertTx(database, userId, accountId, 'pending-2', { categoryId, notes: 'from pending' });
		insertTx(database, userId, accountId, 'posted-2', {
			amount: -800,
			categoryId: other,
			notes: 'from posted'
		});
		foldPendingIntoPosted(userId, 'plaid', accountId, 'pending-2', 'posted-2', database);
		const row = database.query('SELECT category_id, notes, amount_cents FROM transactions').get() as {
			category_id: number;
			notes: string;
			amount_cents: number;
		};
		expect(row.category_id).toBe(other);
		expect(row.notes).toBe('from posted');
		expect(row.amount_cents).toBe(-800);
	});

	test('does nothing when the pending id is not stored on the account', () => {
		const database = open();
		const { userId, accountId } = seed(database);
		insertTx(database, userId, accountId, 'posted-3', { amount: -500 });
		foldPendingIntoPosted(userId, 'plaid', accountId, 'missing-pending', 'posted-3', database);
		expect(database.query('SELECT COUNT(*) AS n FROM transactions').get()).toEqual({ n: 1 });
	});
});

describe('pending row already posted in the same response', () => {
	test('skips the pending row and does not skip on merchant or amount', () => {
		const rows = [
			{ external_id: 'p1', pending: true, pending_transaction_id: null, merchant: 'Cafe', amount_cents: -1000 },
			{ external_id: 'posted-1', pending: false, pending_transaction_id: 'p1', merchant: 'Cafe', amount_cents: -1250 },
			{ external_id: 'p2', pending: true, pending_transaction_id: null, merchant: 'Cafe', amount_cents: -1000 },
			{ external_id: 'posted-2', pending: false, pending_transaction_id: null, merchant: 'Cafe', amount_cents: -1000 }
		];
		const covered = pendingIdsReplacedInResponse(rows);
		expect(isPendingAlreadyPosted(rows[0]!, covered)).toBe(true);
		expect(isPendingAlreadyPosted(rows[1]!, covered)).toBe(false);
		expect(isPendingAlreadyPosted(rows[2]!, covered)).toBe(false);
		expect(isPendingAlreadyPosted(rows[3]!, covered)).toBe(false);
		expect(covered.has('p1')).toBe(true);
		expect(covered.has('p2')).toBe(false);
	});
});
