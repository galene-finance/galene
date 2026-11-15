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
import { computeDashboardData } from './dashboard';
import { cashflowForMonths, deleteAccount, deleteTransaction, getAccountBalances, getHomeSummary, getTransactions, saveTransaction } from './finance';
import { generateComputedAlerts, listNotifications } from './notifications';
import { accountsNeedingReconcile, finishReconcile, loadReconcile, setCleared, unlockTransaction } from './reconcile';
import { foldPendingIntoPosted, mergeRepostedTransactions, upsertProviderTransaction } from './sync';
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
		expect(summary.balanceCents).toBe(-480 - 12000 + 3738);
		expect(summary.recent.map((row) => row.merchant)).not.toContain('Balance adjustment');
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

function dismissalCount(): number {
	return (db().query('SELECT COUNT(*) AS n FROM reconcile_duplicate_dismissals').get() as { n: number }).n;
}

function sessionCount(): number {
	return (db().query('SELECT COUNT(*) AS n FROM reconcile_sessions').get() as { n: number }).n;
}

describe('keep both waits for finish', () => {
	test('a refused or cancelled finish writes no dismissal, and confirm writes one', () => {
		const userId = user('keep@example.com');
		const accountId = account(userId, 'demo');
		const synced = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 'demo', 'cafe', 1)`
			)
			.run(userId, accountId);
		const manual = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 0)`
			)
			.run(userId, accountId);
		const pair = { manualId: Number(manual.lastInsertRowid), syncedId: Number(synced.lastInsertRowid) };
		const plan = {
			statementDate: '2026-11-14',
			adjustment: null,
			addUnimportedIds: [] as number[],
			deleteIds: [] as number[]
		};

		// Staged on the client only. Cancel, or leave, never calls finish.
		expect(dismissalCount()).toBe(0);
		expect(sessionCount()).toBe(0);

		expect(() =>
			finishReconcile(userId, accountId, {
				...plan,
				bankBalanceCents: 0,
				dismissPairs: [pair]
			})
		).toThrow(/\$0\.00/);
		expect(dismissalCount()).toBe(0);
		expect(sessionCount()).toBe(0);

		const stranger = user('keep-stranger@example.com');
		expect(() =>
			finishReconcile(stranger, accountId, {
				...plan,
				bankBalanceCents: -480,
				dismissPairs: [pair]
			})
		).toThrow(/Account not found/);
		expect(dismissalCount()).toBe(0);

		db().query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Savings', 'bank')`).run(userId);
		const savingsId = (
			db().query(`SELECT id FROM accounts WHERE user_id = ? AND name = 'Savings'`).get(userId) as { id: number }
		).id;
		const foreign = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 1)`
			)
			.run(userId, savingsId);
		expect(() =>
			finishReconcile(userId, accountId, {
				...plan,
				bankBalanceCents: -480,
				dismissPairs: [{ manualId: pair.manualId, syncedId: Number(foreign.lastInsertRowid) }]
			})
		).toThrow(/not on this account/);
		expect(dismissalCount()).toBe(0);
		expect(sessionCount()).toBe(0);

		finishReconcile(userId, accountId, {
			...plan,
			bankBalanceCents: -480,
			dismissPairs: [pair]
		});
		expect(dismissalCount()).toBe(1);
		expect(
			db()
				.query(
					`SELECT user_id, account_id, transaction_id, match_transaction_id
					 FROM reconcile_duplicate_dismissals`
				)
				.get()
		).toEqual({
			user_id: userId,
			account_id: accountId,
			transaction_id: pair.manualId,
			match_transaction_id: pair.syncedId
		});
		const kept = db()
			.query(`SELECT id FROM transactions WHERE account_id = ? ORDER BY id`)
			.all(accountId) as { id: number }[];
		expect(kept.map((row) => row.id)).toEqual([pair.syncedId, pair.manualId]);
		expect(loadReconcile(userId, accountId, null)?.dismissedPairs).toContain(`${pair.manualId}:${pair.syncedId}`);
	});

	test('deleting a reconciled row rolls back a staged keep both', () => {
		const userId = user('keep-lock@example.com');
		const accountId = account(userId, 'demo');
		const rent = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-02', -100, 'Rent', 1, datetime('now'))`
			)
			.run(userId, accountId);
		const synced = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 'demo', 'cafe', 1)`
			)
			.run(userId, accountId);
		const manual = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, '2026-11-12', -480, 'Coffee Shop', 0)`
			)
			.run(userId, accountId);
		expect(() =>
			finishReconcile(userId, accountId, {
				bankBalanceCents: -480,
				statementDate: '2026-11-14',
				adjustment: null,
				addUnimportedIds: [],
				deleteIds: [Number(rent.lastInsertRowid)],
				dismissPairs: [{ manualId: Number(manual.lastInsertRowid), syncedId: Number(synced.lastInsertRowid) }]
			})
		).toThrow(/Unlock/);
		expect(dismissalCount()).toBe(0);
		expect(sessionCount()).toBe(0);
		expect((db().query('SELECT id FROM transactions WHERE merchant = ?').get('Rent') as { id: number }).id).toBe(
			Number(rent.lastInsertRowid)
		);
	});
});

describe('balance adjustment on home', () => {
	test('recent feeds omit a $2.50 adjustment and the account balance includes it', () => {
		const userId = user('home-adj@example.com');
		const now = new Date();
		const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, opening_balance_cents, opening_as_of)
				 VALUES (?, 'Checking', 'bank', 0, ?)`
			)
			.run(userId, monthStart);
		const accountId = (db().query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id;
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, cleared)
				 VALUES (?, ?, ?, -1000, 'Grocery', 0)`
			)
			.run(userId, accountId, monthStart);

		finishReconcile(userId, accountId, {
			bankBalanceCents: 250,
			statementDate: today,
			adjustment: { amountCents: 250, date: today, note: 'Reconcile' },
			addUnimportedIds: [],
			deleteIds: []
		});

		const summary = getHomeSummary(userId);
		expect(summary.recent.map((row) => row.merchant)).toEqual(['Grocery']);
		expect(summary.recent.some((row) => row.amount_cents === 250)).toBe(false);
		expect(summary.balanceCents).toBe(250 - 1000);
		expect(summary.monthIncomeCents).toBe(0);
		expect(getAccountBalances(userId).get(accountId)).toBe(250 - 1000);

		const widgets = computeDashboardData(userId, [
			{ id: 'recent', type: 'recent', x: 0, y: 0, w: 6, h: 5, filters: { limit: 10 } },
			{ id: 'balances', type: 'balances', x: 0, y: 0, w: 4, h: 4, filters: {} },
			{ id: 'month', type: 'month', x: 0, y: 0, w: 4, h: 2, filters: {} },
			{ id: 'notifications', type: 'notifications', x: 0, y: 0, w: 4, h: 4, filters: {} }
		]);
		const recent = widgets.recent;
		expect(recent?.kind).toBe('recent');
		if (recent?.kind === 'recent') {
			expect(recent.items.map((row) => row.merchant)).toEqual(['Grocery']);
			expect(recent.items.some((row) => row.amount_cents === 250)).toBe(false);
		}
		const balances = widgets.balances;
		if (balances?.kind === 'balances') {
			expect(balances.items.find((row) => row.id === accountId)?.balanceCents).toBe(250 - 1000);
		}
		const month = widgets.month;
		if (month?.kind === 'month') expect(month.incomeCents).toBe(0);

		generateComputedAlerts(userId);
		const notes = listNotifications(userId);
		expect(notes.some((row) => /balance adjustment/i.test(`${row.title} ${row.body}`))).toBe(false);
		const widgetNotes = widgets.notifications;
		if (widgetNotes?.kind === 'notifications') {
			expect(widgetNotes.items.some((row) => /balance adjustment/i.test(`${row.title} ${row.body}`))).toBe(false);
		}

		const ledger = getTransactions(userId, {
			accountIds: [],
			categoryIds: [],
			tagIds: [],
			emptyFields: [],
			amountOp: '',
			amountFrom: null,
			amountTo: null,
			dateFrom: null,
			dateTo: null,
			q: '',
			page: 1,
			pageSize: 20
		});
		expect(ledger.items.map((row) => row.merchant)).toContain('Balance adjustment');
		expect(ledger.items.find((row) => row.merchant === 'Balance adjustment')?.amount_cents).toBe(250);
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

	test('a reconciled pending row folds into its posted row once', () => {
		const userId = user('fold@example.com');
		const accountId = account(userId, 'demo');
		const category = db()
			.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Dining', 'expense')`)
			.run(userId);
		const categoryId = Number(category.lastInsertRowid);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, category_id, date, amount_cents, merchant, notes, provider, external_id, pending, cleared, reconciled_at)
				 VALUES (?, ?, ?, '2026-11-10', -400, 'Auth', 'lunch', 'demo', 'pend-lock', 1, 1, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId, categoryId);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending, cleared)
				 VALUES (?, ?, '2026-11-12', -450, 'Posted', 'demo', 'posted-lock', 0, 1)`
			)
			.run(userId, accountId);
		foldPendingIntoPosted(userId, 'demo', accountId, 'pend-lock', 'posted-lock');
		const rows = db()
			.query('SELECT external_id, amount_cents, cleared, reconciled_at, category_id, notes FROM transactions')
			.all() as {
			external_id: string;
			amount_cents: number;
			cleared: number;
			reconciled_at: string | null;
			category_id: number | null;
			notes: string | null;
		}[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.external_id).toBe('posted-lock');
		expect(rows[0]?.amount_cents).toBe(-450);
		expect(rows.reduce((sum, row) => sum + row.amount_cents, 0)).toBe(-450);
		expect(rows[0]?.cleared).toBe(1);
		expect(rows[0]?.reconciled_at).toBeNull();
		expect(rows[0]?.category_id).toBe(categoryId);
		expect(rows[0]?.notes).toBe('lunch');

		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-12', -450, 'Auth', 'demo', 'pend-same', 1, 1, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		db().query(`UPDATE transactions SET reconciled_at = NULL, cleared = 0 WHERE external_id = 'posted-lock'`).run();
		foldPendingIntoPosted(userId, 'demo', accountId, 'pend-same', 'posted-lock');
		const kept = db()
			.query(`SELECT external_id, cleared, reconciled_at FROM transactions ORDER BY external_id`)
			.all() as { external_id: string; cleared: number; reconciled_at: string | null }[];
		expect(kept.map((row) => row.external_id)).toEqual(['posted-lock']);
		expect(kept[0]?.cleared).toBe(1);
		expect(kept[0]?.reconciled_at).toBe('2026-11-14 00:00:00');
		expect(
			(db().query('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions').get() as { s: number }).s
		).toBe(-450);
	});

	test('a reconciled pending row the bank drops without posting is kept and demoted', () => {
		const userId = user('dropped@example.com');
		const accountId = account(userId, 'demo');
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, pending, cleared, reconciled_at)
				 VALUES (?, ?, '2026-11-10', -400, 'Auth', 'demo', 'pend-gone', 1, 1, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		db()
			.query(
				`INSERT INTO reconcile_sessions (user_id, account_id, statement_date, bank_balance_cents, finished_at)
				 VALUES (?, ?, '2026-11-14', -400, '2026-11-14 00:00:00')`
			)
			.run(userId, accountId);
		expect(mergeRepostedTransactions(userId, 'demo', '2026-11-01', new Set(), db())).toBe(0);
		const row = db().query('SELECT external_id, amount_cents, cleared, reconciled_at, pending FROM transactions').get() as {
			external_id: string;
			amount_cents: number;
			cleared: number;
			reconciled_at: string | null;
			pending: number;
		};
		expect(row.external_id).toBe('pend-gone');
		expect(row.amount_cents).toBe(-400);
		expect(row.pending).toBe(1);
		expect(row.cleared).toBe(1);
		expect(row.reconciled_at).toBeNull();
		expect(accountsNeedingReconcile(userId)[String(accountId)]).toBe(true);
	});
});
