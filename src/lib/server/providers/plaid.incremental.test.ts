/**
 * Plaid /transactions/get uses the incremental window, and a repeat sync
 * with no bank-side changes reports 0 updated (ADO-76).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '../db';
import { setSetting } from '../finance';
import { syncNow } from '../sync';
import { createUser } from '../users';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const TOKEN = 'access-sandbox-window';
const TX_DATE = '2024-06-15';
const SINCE = '2024-06-01';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-plaid-window-'));
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
		name: 'Sync',
		email: 'sync@example.com',
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	setSetting(created.userId, 'plaid_client_id', 'client');
	setSetting(created.userId, 'plaid_client_secret', 'client-secret-VALUE');
	setSetting(created.userId, 'plaid_env', 'sandbox');
	setSetting(created.userId, 'plaid_sandbox_instance', 'sandbox');
	return created.userId;
}

function link(userId: number) {
	db()
		.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
		.run(userId, JSON.stringify({ access_tokens: JSON.stringify([TOKEN]) }));
}

function seedTransaction(userId: number) {
	db()
		.query(
			`INSERT INTO accounts (user_id, name, type, provider, external_id)
			 VALUES (?, 'Checking', 'bank', 'plaid', 'acc-1')`
		)
		.run(userId);
	db()
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, notes, provider, external_id, pending, cleared)
			 VALUES (?, (SELECT id FROM accounts WHERE user_id = ?), ?, -500, 'Cafe', 'keep me', 'plaid', 'tx-1', 0, 1)`
		)
		.run(userId, userId, TX_DATE);
}

function plaidBody(url: string, init?: RequestInit): { path: string; body: Record<string, unknown> } {
	const path = new URL(url).pathname;
	const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
	return { path, body };
}

function mockFetch(amount = 5) {
	const starts: string[] = [];
	const impl = (async (url: string | URL | Request, init?: RequestInit) => {
		const { path, body } = plaidBody(String(url), init);
		if (path === '/institutions/get_by_id') {
			return Response.json({ institution: { name: 'Example Bank' } });
		}
		if (path === '/item/get') {
			return Response.json({
				item: { item_id: 'item-window', institution_id: 'ins-window', error: null }
			});
		}
		if (path === '/accounts/get') {
			return Response.json({
				accounts: [{ account_id: 'acc-1', name: 'Checking', type: 'depository', balances: { current: 10 } }]
			});
		}
		if (path === '/transactions/get') {
			starts.push(String(body.start_date ?? ''));
			return Response.json({
				transactions: [
					{
						transaction_id: 'tx-1',
						account_id: 'acc-1',
						date: TX_DATE,
						amount,
						name: 'Cafe',
						pending: false
					}
				],
				total_transactions: 1
			});
		}
		return Response.json({});
	}) as typeof fetch;
	return { impl, starts };
}

describe('Plaid incremental sync window', () => {
	test('requests start_date at newest transaction minus 14 days and a repeat reports 0 updated', async () => {
		const userId = user();
		link(userId);
		seedTransaction(userId);
		db()
			.query(`UPDATE transactions SET merchant = 'Morning coffee' WHERE provider = 'plaid'`)
			.run();
		const original = globalThis.fetch;
		const mocked = mockFetch();
		globalThis.fetch = mocked.impl;
		try {
			const first = await syncNow(userId, 'plaid');
			expect('updated' in first ? first.updated : -1).toBe(0);
			expect('created' in first ? first.created : -1).toBe(0);
			expect(mocked.starts).toEqual([SINCE]);
			const afterFirst = db()
				.query(`SELECT merchant, notes, provider_merchant, updated_at FROM transactions`)
				.get() as {
				merchant: string;
				notes: string;
				provider_merchant: string | null;
				updated_at: string;
			};
			expect(afterFirst.merchant).toBe('Morning coffee');
			expect(afterFirst.notes).toBe('keep me');
			expect(afterFirst.provider_merchant).toBe('Cafe');
			const frozen = afterFirst.updated_at;

			mocked.starts.length = 0;
			const second = await syncNow(userId, 'plaid');
			expect('updated' in second ? second.updated : -1).toBe(0);
			expect(mocked.starts).toEqual([SINCE]);
			const afterSecond = db()
				.query(`SELECT merchant, notes, updated_at, reconciled_at, cleared FROM transactions`)
				.get() as {
				merchant: string;
				notes: string;
				updated_at: string;
				reconciled_at: string | null;
				cleared: number;
			};
			expect(afterSecond.merchant).toBe('Morning coffee');
			expect(afterSecond.notes).toBe('keep me');
			expect(afterSecond.updated_at).toBe(frozen);
			expect(afterSecond.cleared).toBe(1);
			expect(afterSecond.reconciled_at).toBeNull();
		} finally {
			globalThis.fetch = original;
		}
	});

	test('a changed amount on the next sync counts as updated', async () => {
		const userId = user();
		link(userId);
		seedTransaction(userId);
		const original = globalThis.fetch;
		const mocked = mockFetch(5);
		globalThis.fetch = mocked.impl;
		try {
			const first = await syncNow(userId, 'plaid');
			expect('updated' in first ? first.updated : -1).toBe(0);
			mocked.starts.length = 0;
			globalThis.fetch = mockFetch(9).impl;
			const second = await syncNow(userId, 'plaid');
			expect('updated' in second ? second.updated : -1).toBe(1);
			expect(
				(db().query('SELECT amount_cents FROM transactions').get() as { amount_cents: number }).amount_cents
			).toBe(-900);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('the first sync with no transactions keeps the default window', async () => {
		const userId = user();
		link(userId);
		const expected = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
		const original = globalThis.fetch;
		const mocked = mockFetch();
		globalThis.fetch = mocked.impl;
		try {
			const summary = await syncNow(userId, 'plaid');
			expect('created' in summary ? summary.created : -1).toBe(1);
			expect(mocked.starts).toEqual([expected]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
