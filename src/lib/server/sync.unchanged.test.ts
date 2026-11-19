/**
 * Repeat syncs skip unchanged rows and keep user payees and notes (ADO-76).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from './db';
import { saveTransaction } from './finance';
import { upsertProviderTransaction } from './sync';
import { createUser } from './users';
import type { ProviderTransaction } from '../types';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-sync-unchanged-'));
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

function user(): number {
	const created = createUser({
		name: 'Owner',
		email: 'sync@example.com',
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function account(userId: number): number {
	db()
		.query(
			`INSERT INTO accounts (user_id, name, type, provider, external_id)
			 VALUES (?, 'Checking', 'bank', 'demo', 'acct')`
		)
		.run(userId);
	return (db().query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id;
}

function line(over: Partial<ProviderTransaction> = {}): ProviderTransaction {
	return {
		external_id: 'tx-1',
		account_external_id: 'acct',
		date: '2026-11-10',
		amount_cents: -480,
		merchant: 'Cafe',
		...over
	};
}

function row() {
	return db()
		.query(
			`SELECT id, date, amount_cents, merchant, notes, pending, pending_transaction_id,
			        provider_merchant, cleared, reconciled_at, updated_at, pending_last_seen_at
			 FROM transactions`
		)
		.get() as {
		id: number;
		date: string;
		amount_cents: number;
		merchant: string | null;
		notes: string | null;
		pending: number;
		pending_transaction_id: string | null;
		provider_merchant: string | null;
		cleared: number;
		reconciled_at: string | null;
		updated_at: string;
		pending_last_seen_at: string | null;
	};
}

function freezeUpdatedAt(id: number) {
	db().query(`UPDATE transactions SET updated_at = '2020-01-01 00:00:00' WHERE id = ?`).run(id);
}

describe('upsert skips unchanged provider rows', () => {
	test('a repeat with no bank-side changes reports unchanged and leaves updated_at', () => {
		const userId = user();
		const accountId = account(userId);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00')).toBe('inserted');
		const inserted = row();
		freezeUpdatedAt(inserted.id);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-11 00:00:00')).toBe('unchanged');
		const again = row();
		expect(again.updated_at).toBe('2020-01-01 00:00:00');
		expect(again.amount_cents).toBe(-480);
		expect(again.merchant).toBe('Cafe');
		expect(again.provider_merchant).toBe('Cafe');
		expect(again.cleared).toBe(1);
	});

	test('refreshing pending_last_seen_at does not count as updated', () => {
		const userId = user();
		const accountId = account(userId);
		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ pending: true }), '2026-11-10 00:00:00')
		).toBe('inserted');
		freezeUpdatedAt(row().id);
		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ pending: true }), '2026-11-12 01:00:00')
		).toBe('unchanged');
		const again = row();
		expect(again.pending_last_seen_at).toBe('2026-11-12 01:00:00');
		expect(again.updated_at).toBe('2020-01-01 00:00:00');
		expect(again.pending).toBe(1);
		expect(again.cleared).toBe(0);
	});

	test('a changed amount or a pending line that posts counts as updated', () => {
		const userId = user();
		const accountId = account(userId);
		upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00');
		freezeUpdatedAt(row().id);
		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ amount_cents: -500 }), '2026-11-11 00:00:00')
		).toBe('updated');
		expect(row().amount_cents).toBe(-500);
		expect(row().updated_at).not.toBe('2020-01-01 00:00:00');

		expect(
			upsertProviderTransaction(
				userId,
				'demo',
				accountId,
				line({ external_id: 'pend', pending: true, amount_cents: -100 }),
				'2026-11-11 00:00:00'
			)
		).toBe('inserted');
		expect(
			upsertProviderTransaction(
				userId,
				'demo',
				accountId,
				line({ external_id: 'pend', pending: false, amount_cents: -100 }),
				'2026-11-12 00:00:00'
			)
		).toBe('updated');
		const posted = db()
			.query(`SELECT pending, cleared FROM transactions WHERE external_id = 'pend'`)
			.get() as { pending: number; cleared: number };
		expect(posted.pending).toBe(0);
		expect(posted.cleared).toBe(0);
	});

	test('a date change demotes reconciled to cleared, and an unchanged row stays reconciled', () => {
		const userId = user();
		const accountId = account(userId);
		upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00');
		const id = row().id;
		db().query(`UPDATE transactions SET reconciled_at = '2026-11-14 00:00:00', cleared = 1 WHERE id = ?`).run(id);
		freezeUpdatedAt(id);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-15 00:00:00')).toBe('unchanged');
		expect(row().reconciled_at).toBe('2026-11-14 00:00:00');
		expect(row().cleared).toBe(1);
		expect(row().updated_at).toBe('2020-01-01 00:00:00');

		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ date: '2026-11-12' }), '2026-11-15 00:00:00')
		).toBe('updated');
		const changed = row();
		expect(changed.date).toBe('2026-11-12');
		expect(changed.cleared).toBe(1);
		expect(changed.reconciled_at).toBeNull();
	});

	test('a bank payee change updates the shown payee only while it still matches, and does not demote', () => {
		const userId = user();
		const accountId = account(userId);
		upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00');
		const id = row().id;
		db().query(`UPDATE transactions SET reconciled_at = '2026-11-14 00:00:00' WHERE id = ?`).run(id);
		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ merchant: 'Cafe counter' }), '2026-11-15 00:00:00')
		).toBe('updated');
		const renamed = row();
		expect(renamed.merchant).toBe('Cafe counter');
		expect(renamed.provider_merchant).toBe('Cafe counter');
		expect(renamed.reconciled_at).toBe('2026-11-14 00:00:00');
		expect(renamed.cleared).toBe(1);
	});

	test('a user note on a synced row survives the next sync', () => {
		const userId = user();
		const accountId = account(userId);
		upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00');
		const id = row().id;
		saveTransaction(userId, {
			id,
			type: 'expense',
			amountCents: 480,
			date: '2026-11-10',
			account: accountId,
			category: null,
			merchant: 'Cafe',
			notes: 'lunch with notes',
			color: null,
			tags: []
		});
		freezeUpdatedAt(id);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-16 00:00:00')).toBe('unchanged');
		const kept = row();
		expect(kept.notes).toBe('lunch with notes');
		expect(kept.merchant).toBe('Cafe');
		expect(kept.updated_at).toBe('2020-01-01 00:00:00');
	});

	test('a user payee edit on a synced row survives the next sync', () => {
		const userId = user();
		const accountId = account(userId);
		upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-10 00:00:00');
		const id = row().id;
		saveTransaction(userId, {
			id,
			type: 'expense',
			amountCents: 480,
			date: '2026-11-10',
			account: accountId,
			category: null,
			merchant: 'Morning coffee',
			notes: null,
			color: null,
			tags: []
		});
		freezeUpdatedAt(id);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-16 00:00:00')).toBe('unchanged');
		const kept = row();
		expect(kept.merchant).toBe('Morning coffee');
		expect(kept.provider_merchant).toBe('Cafe');
		expect(kept.notes).toBeNull();
		expect(kept.updated_at).toBe('2020-01-01 00:00:00');

		expect(
			upsertProviderTransaction(userId, 'demo', accountId, line({ merchant: 'Cafe kiosk' }), '2026-11-17 00:00:00')
		).toBe('updated');
		const followed = row();
		expect(followed.merchant).toBe('Morning coffee');
		expect(followed.provider_merchant).toBe('Cafe kiosk');
	});

	test('a legacy row keeps a payee that already differs from the bank', () => {
		const userId = user();
		const accountId = account(userId);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id, cleared)
				 VALUES (?, ?, '2026-11-10', -480, 'Morning coffee', 'demo', 'tx-1', 1)`
			)
			.run(userId, accountId);
		const id = row().id;
		freezeUpdatedAt(id);
		expect(upsertProviderTransaction(userId, 'demo', accountId, line(), '2026-11-16 00:00:00')).toBe('unchanged');
		const kept = row();
		expect(kept.merchant).toBe('Morning coffee');
		expect(kept.provider_merchant).toBe('Cafe');
		expect(kept.updated_at).toBe('2020-01-01 00:00:00');
		expect(kept.cleared).toBe(1);
	});
});
