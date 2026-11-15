/**
 * Reconcile writes: ownership, the $0 gate, one transaction for finish,
 * unlock before edit/delete, and balance adjustments kept out of spend.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from './db';
import { createApiToken } from './apiTokens';
import { cashflowForMonths, deleteAccount, deleteTransaction, getHomeSummary, saveTransaction } from './finance';
import { accountsNeedingReconcile, finishReconcile, loadReconcile, setCleared, unlockTransaction } from './reconcile';
import { foldOrphanIntoTarget, foldPendingIntoPosted, upsertProviderTransaction } from './sync';
import { isHeldProviderLine } from './syncHeld';
import { createUser } from './users';
import { executeWrite, saveWriteApiSettings } from './writeApi';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-reconcile-'));
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
		delete process.env[key];
	}
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	process.env.GALENE_DATA_DIR = dir;
	process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
	closeDbForTests();
	db();
});

afterEach(() => {
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
		delete saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

function user(email: string): number {
	const created = createUser({
		name: 'Owner',
		email,
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function account(userId: number, provider: string | null): number {
	db()
		.query(
			`INSERT INTO accounts (user_id, name, type, provider, opening_balance_cents, opening_as_of)
			 VALUES (?, 'Checking', 'bank', ?, 0, '2026-11-01')`
		)
		.run(userId, provider);
	return (db().query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id;
}

describe('reconcile finish', () => {
	test('refuses a gap, then applies an explicit adjustment and locks cleared rows together', () => {
		const userId = user('owner@example.com');
		const accountId = account(userId, 'demo');
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 'demo', 'cafe', 1)`
			)
			.run(userId, accountId);
		const open = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, '2026-11-13', -12000, 'Check 1042', 0)`
			)
			.run(userId, accountId);
		const openId = Number(open.lastInsertRowid);

		expect(() =>
			finishReconcile(userId, accountId, {
				bankBalanceCents: -480 + 3738,
				statementDate: '2026-11-14',
				adjustment: null,
				addUnimportedIds: [],
				deleteIds: []
			})
		).toThrow(/\$0\.00/);
		expect((db().query('SELECT reconciled_at FROM transactions WHERE merchant = ?').get('Coffee Shop') as { reconciled_at: string | null }).reconciled_at).toBeNull();

		const result = finishReconcile(userId, accountId, {
			bankBalanceCents: -480 + 3738,
			statementDate: '2026-11-14',
			adjustment: { amountCents: 3738, date: '2026-11-14', note: 'Reconcile Nov 14' },
			addUnimportedIds: [],
			deleteIds: []
		});
		expect(result.marked).toBe(2);
		const locked = db().query(`SELECT merchant FROM transactions WHERE reconciled_at IS NOT NULL ORDER BY merchant`).all() as {
			merchant: string;
		}[];
		expect(locked.map((row) => row.merchant)).toEqual(['Balance adjustment', 'Coffee Shop']);
		expect((db().query('SELECT cleared, reconciled_at FROM transactions WHERE id = ?').get(openId) as { cleared: number; reconciled_at: string | null }).reconciled_at).toBeNull();
		const session = db().query('SELECT statement_date, bank_balance_cents FROM reconcile_sessions').get() as {
			statement_date: string;
			bank_balance_cents: number;
		};
		expect(session).toEqual({ statement_date: '2026-11-14', bank_balance_cents: -480 + 3738 });

		expect(() => saveTransaction(userId, {
			id: (db().query(`SELECT id FROM transactions WHERE merchant = 'Coffee Shop'`).get() as { id: number }).id,
			type: 'expense',
			amountCents: 480,
			date: '2026-11-12',
			account: accountId,
			category: null,
			merchant: 'Coffee Shop',
			notes: 'changed',
			color: null,
			tags: []
		})).toThrow(/Unlock/);
		expect(() => deleteTransaction(userId, (db().query(`SELECT id FROM transactions WHERE merchant = 'Coffee Shop'`).get() as { id: number }).id)).toThrow(/Unlock/);

		const summary = getHomeSummary(userId);
		expect(summary.monthIncomeCents).toBe(0);
		expect(summary.topCategories.find((row) => row.name === 'Balance adjustment')).toBeUndefined();
		const flow = cashflowForMonths(userId, ['2026-11']);
		const names = [...flow.sections.income.rows, ...flow.sections.expense.rows].map((row) => row.categoryName);
		expect(names).not.toContain('Balance adjustment');
	});

	test('adds a held bank line instead of leaving a gap, and does not show held lines for a manual account', () => {
		const userId = user('lines@example.com');
		const accountId = account(userId, 'demo');
		db()
			.query(
				`INSERT INTO sync_unimported (user_id, account_id, provider, external_id, date, amount_cents, merchant, pending, seen_at)
				 VALUES (?, ?, 'demo', 'hw', '2026-11-10', 3738, 'Corner Hardware', 0, datetime('now'))`
			)
			.run(userId, accountId);
		const loaded = loadReconcile(userId, accountId, null);
		expect(loaded?.missing).toHaveLength(1);
		finishReconcile(userId, accountId, {
			bankBalanceCents: 3738,
			statementDate: '2026-11-14',
			adjustment: null,
			addUnimportedIds: [loaded!.missing[0]!.id],
			deleteIds: []
		});
		expect((db().query('SELECT COUNT(*) AS n FROM sync_unimported').get() as { n: number }).n).toBe(0);
		const added = db().query(`SELECT provider, external_id, cleared, reconciled_at FROM transactions`).get() as {
			provider: string;
			external_id: string;
			cleared: number;
			reconciled_at: string | null;
		};
		expect(added.provider).toBe('demo');
		expect(added.external_id).toBe('hw');
		expect(added.cleared).toBe(1);
		expect(added.reconciled_at).not.toBeNull();

		const other = user('manual@example.com');
		const manualId = account(other, null);
		db()
			.query(
				`INSERT INTO sync_unimported (user_id, account_id, provider, external_id, date, amount_cents, merchant, pending, seen_at)
				 VALUES (?, ?, 'demo', 'hidden', '2026-11-10', 100, 'Hidden', 0, datetime('now'))`
			)
			.run(other, manualId);
		expect(loadReconcile(other, manualId, null)?.missing).toEqual([]);
	});

	test('another user cannot tick or finish this account', () => {
		const owner = user('owner2@example.com');
		const accountId = account(owner, 'demo');
		const stranger = user('stranger@example.com');
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, '2026-11-02', -100, 'Cafe', 0)`
			)
			.run(owner, accountId);
		const id = (db().query('SELECT id FROM transactions').get() as { id: number }).id;
		expect(() => setCleared(stranger, accountId, [id], true)).toThrow(/not on this account|Account not found/);
		expect(() =>
			finishReconcile(stranger, accountId, {
				bankBalanceCents: 0,
				statementDate: '2026-11-14',
				adjustment: null,
				addUnimportedIds: [],
				deleteIds: []
			})
		).toThrow(/Account not found/);
		expect((db().query('SELECT cleared FROM transactions WHERE id = ?').get(id) as { cleared: number }).cleared).toBe(0);
	});

	test('deleting a synced row holds it, and the next sync does not import it again', () => {
		const userId = user('sync@example.com');
		const accountId = account(userId, 'demo');
		const inserted = upsertProviderTransaction(
			userId,
			'demo',
			accountId,
			{ external_id: 'cafe-1', account_external_id: 'acct', date: '2026-11-12', amount_cents: -480, merchant: 'Cafe' },
			'2026-11-12 00:00:00'
		);
		expect(inserted).toBe('inserted');
		const row = db().query('SELECT id, cleared FROM transactions').get() as { id: number; cleared: number };
		expect(row.cleared).toBe(1);
		deleteTransaction(userId, row.id);
		expect(isHeldProviderLine(userId, 'demo', 'cafe-1')).toBe(true);
		expect(
			upsertProviderTransaction(
				userId,
				'demo',
				accountId,
				{ external_id: 'cafe-1', account_external_id: 'acct', date: '2026-11-12', amount_cents: -480, merchant: 'Cafe' },
				'2026-11-13 00:00:00'
			)
		).toBe('held');
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(0);
		const pending = upsertProviderTransaction(
			userId,
			'demo',
			accountId,
			{ external_id: 'pend', account_external_id: 'acct', date: '2026-11-13', amount_cents: -100, merchant: 'Pend', pending: true },
			'2026-11-13 00:00:00'
		);
		expect(pending).toBe('inserted');
		expect((db().query(`SELECT cleared FROM transactions WHERE external_id = 'pend'`).get() as { cleared: number }).cleared).toBe(0);
	});

	test('unlock allows a delete of a reconciled row', () => {
		const userId = user('unlock@example.com');
		const accountId = account(userId, null);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-01', -100, 'Rent', 1, datetime('now'))`
			)
			.run(userId, accountId);
		const id = (db().query('SELECT id FROM transactions').get() as { id: number }).id;
		expect(() => deleteTransaction(userId, id)).toThrow(/Unlock/);
		unlockTransaction(userId, id);
		deleteTransaction(userId, id);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(0);
	});
});

describe('reconciled lock gaps', () => {
	test('an empty write-API splits array refuses a reconciled row', async () => {
		const userId = user('splits@example.com');
		const accountId = account(userId, null);
		const category = db()
			.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Food', 'expense')`)
			.run(userId);
		const categoryId = Number(category.lastInsertRowid);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, category_id, date, amount_cents, merchant, cleared, reconciled_at)
				 VALUES (?, ?, ?, '2026-11-02', -500, 'Cafe', 1, datetime('now'))`
			)
			.run(userId, accountId, categoryId);
		const txId = (db().query('SELECT id FROM transactions').get() as { id: number }).id;
		db().query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, 500)`).run(txId, categoryId);
		saveWriteApiSettings(true);
		const { info } = createApiToken(userId, 'writer', 'write');
		const result = await executeWrite({
			caller: { userId, token: { id: info.id, scope: 'write' } },
			resource: 'split',
			method: 'POST',
			id: txId,
			body: { splits: [] }
		});
		expect(result.status).toBe(400);
		expect((result.body as { error: string }).error).toMatch(/Unlock/);
		expect((db().query('SELECT COUNT(*) AS n FROM transaction_splits').get() as { n: number }).n).toBe(1);
	});

	test('moving transactions refuses while any row is reconciled', () => {
		const userId = user('move@example.com');
		const fromId = account(userId, null);
		db().query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Savings', 'bank')`).run(userId);
		const toId = (
			db().query(`SELECT id FROM accounts WHERE user_id = ? AND name = 'Savings'`).get(userId) as { id: number }
		).id;
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-01', -100, 'Rent', 1, datetime('now'))`
			)
			.run(userId, fromId);
		expect(() => deleteAccount(userId, fromId, toId)).toThrow(/Unlock reconciled/);
		expect((db().query('SELECT account_id FROM transactions').get() as { account_id: number }).account_id).toBe(fromId);
		expect((db().query('SELECT id FROM accounts WHERE id = ?').get(fromId) as { id: number }).id).toBe(fromId);
		const id = (db().query('SELECT id FROM transactions').get() as { id: number }).id;
		unlockTransaction(userId, id);
		deleteAccount(userId, fromId, toId);
		expect((db().query('SELECT account_id FROM transactions').get() as { account_id: number }).account_id).toBe(toId);
	});

	test('a sync amount or date change demotes reconciled to cleared and the account needs reconciling', () => {
		const userId = user('sync-lock@example.com');
		const accountId = account(userId, 'demo');
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-10', -480, 'Cafe', 'demo', 'cafe-lock', 1, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		db()
			.query(
				`INSERT INTO reconcile_sessions (user_id, account_id, statement_date, bank_balance_cents, finished_at)
				 VALUES (?, ?, '2026-11-14', -480, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		upsertProviderTransaction(
			userId,
			'demo',
			accountId,
			{ external_id: 'cafe-lock', account_external_id: 'acct', date: '2026-11-10', amount_cents: -480, merchant: 'Cafe updated' },
			'2026-11-15 00:00:00'
		);
		let row = db().query('SELECT amount_cents, merchant, cleared, reconciled_at FROM transactions').get() as {
			amount_cents: number;
			merchant: string;
			cleared: number;
			reconciled_at: string | null;
		};
		expect(row.merchant).toBe('Cafe updated');
		expect(row.reconciled_at).toBe('2026-11-14 00:00:00');
		expect(accountsNeedingReconcile(userId)[String(accountId)]).toBeUndefined();

		upsertProviderTransaction(
			userId,
			'demo',
			accountId,
			{ external_id: 'cafe-lock', account_external_id: 'acct', date: '2026-11-12', amount_cents: -500, merchant: 'Cafe updated' },
			'2026-11-15 00:00:00'
		);
		const changed = db().query('SELECT date, amount_cents, cleared, reconciled_at FROM transactions').get() as {
			date: string;
			amount_cents: number;
			cleared: number;
			reconciled_at: string | null;
		};
		expect(changed.date).toBe('2026-11-12');
		expect(changed.amount_cents).toBe(-500);
		expect(changed.cleared).toBe(1);
		expect(changed.reconciled_at).toBeNull();
		expect(accountsNeedingReconcile(userId)[String(accountId)]).toBe(true);
	});

	test('folding a pending row carries state and never deletes a reconciled pending row', () => {
		const userId = user('fold@example.com');
		const accountId = account(userId, 'demo');
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-10', -400, 'Auth', 'demo', 'pend-lock', 1, 1, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending, cleared)
				 VALUES (?, ?, '2026-11-12', -450, 'Posted', 'demo', 'posted-lock', 0, 1)`
			)
			.run(userId, accountId);
		foldPendingIntoPosted(userId, 'demo', accountId, 'pend-lock', 'posted-lock');
		const pending = db().query(`SELECT id FROM transactions WHERE external_id = 'pend-lock'`).get() as { id: number } | null;
		expect(pending).not.toBeNull();
		const posted = db().query(`SELECT cleared, reconciled_at, amount_cents FROM transactions WHERE external_id = 'posted-lock'`).get() as {
			cleared: number;
			reconciled_at: string | null;
			amount_cents: number;
		};
		expect(posted.amount_cents).toBe(-450);
		expect(posted.cleared).toBe(1);
		expect(posted.reconciled_at).toBeNull();

		db().query(`UPDATE transactions SET amount_cents = -450, date = '2026-11-12', reconciled_at = '2026-11-14 00:00:00' WHERE external_id = 'pend-lock'`).run();
		db().query(`UPDATE transactions SET amount_cents = -450, date = '2026-11-12', reconciled_at = NULL, cleared = 0 WHERE external_id = 'posted-lock'`).run();
		foldPendingIntoPosted(userId, 'demo', accountId, 'pend-lock', 'posted-lock');
		expect(db().query(`SELECT id FROM transactions WHERE external_id = 'pend-lock'`).get()).not.toBeNull();
		const same = db().query(`SELECT cleared, reconciled_at FROM transactions WHERE external_id = 'posted-lock'`).get() as {
			cleared: number;
			reconciled_at: string | null;
		};
		expect(same.cleared).toBe(1);
		expect(same.reconciled_at).toBe('2026-11-14 00:00:00');

		const orphanId = (db().query(`SELECT id FROM transactions WHERE external_id = 'pend-lock'`).get() as { id: number }).id;
		const targetId = (db().query(`SELECT id FROM transactions WHERE external_id = 'posted-lock'`).get() as { id: number }).id;
		expect(
			foldOrphanIntoTarget(
				userId,
				{ id: orphanId, category_id: null, color: null, notes: null },
				{ id: targetId, category_id: null, split_count: 0 }
			)
		).toBe(false);
		expect(db().query('SELECT id FROM transactions WHERE id = ?').get(orphanId)).not.toBeNull();
	});
});
