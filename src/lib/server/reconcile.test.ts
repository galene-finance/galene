/**
 * Reconcile writes: ownership, the $0 gate, one transaction for finish,
 * unlock before edit/delete, and balance adjustments kept out of spend.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from './db';
import { cashflowForMonths, deleteTransaction, getHomeSummary, saveTransaction } from './finance';
import { finishReconcile, loadReconcile, setCleared, unlockTransaction } from './reconcile';
import { upsertProviderTransaction } from './sync';
import { isHeldProviderLine } from './syncHeld';
import { createUser } from './users';

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
