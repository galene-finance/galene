/**
 * ADO-58 follow-ups: auto-sync after reconnect, dropped-from-feed sweep guard,
 * remove closes review items, and partial failure does not trigger the hour backoff.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '../db';
import { setSetting } from '../finance';
import { createUser } from '../users';
import {
	countOpenSyncReviews,
	finishPlaidReconnect,
	mergeRepostedTransactions,
	removePlaidItemForUser,
	syncNow
} from '../sync';
import { nextSyncDelayMinutes, FAILURE_BACKOFF_MINUTES } from '../scheduler';
import { recordItemFailure, setItemAccountExternalIds, tokenHint } from '../plaidItems';
import { PLAID_PARTIAL_FAILURE_FALLBACK } from '../plaidItemStatus';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const GOOD = 'access-sandbox-good';
const BAD = 'access-sandbox-bad';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-plaid-followup-'));
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
	setSetting(created.userId, 'plaid_client_secret', 'secret');
	setSetting(created.userId, 'plaid_env', 'sandbox');
	setSetting(created.userId, 'plaid_sandbox_instance', 'sandbox');
	return created.userId;
}

function link(userId: number, tokens: string[]) {
	db()
		.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
		.run(userId, JSON.stringify({ access_tokens: JSON.stringify(tokens) }));
	return (db().query('SELECT id FROM connections WHERE user_id = ?').get(userId) as { id: number }).id;
}

function plaidBody(url: string, init?: RequestInit): { path: string; body: Record<string, unknown> } {
	const path = new URL(url).pathname;
	const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
	return { path, body };
}

function insertAccount(userId: number, externalId: string, name: string) {
	const result = db()
		.query(
			`INSERT INTO accounts (user_id, name, type, provider, external_id, name_locked)
			 VALUES (?, ?, 'bank', 'plaid', ?, 0)`
		)
		.run(userId, name, externalId);
	return Number(result.lastInsertRowid);
}

function insertTx(userId: number, accountId: number, externalId: string) {
	const result = db()
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id)
			 VALUES (?, ?, '2026-10-01', -500, 'Cafe', 'plaid', ?)`
		)
		.run(userId, accountId, externalId);
	return Number(result.lastInsertRowid);
}

describe('ADO-58 follow-ups', () => {
	test('failed item makes no dropped-from-feed review items', async () => {
		const userId = user();
		link(userId, [BAD, GOOD]);
		const badAcct = insertAccount(userId, 'acc-bad', 'Broken');
		insertTx(userId, badAcct, 'tx-bad-1');
		insertTx(userId, badAcct, 'tx-bad-2');
		const goodAcct = insertAccount(userId, 'acc-good', 'Healthy');
		insertTx(userId, goodAcct, 'tx-good-old');

		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const { path, body } = plaidBody(String(url), init);
			const token = String(body.access_token ?? '');
			if (path === '/item/get') {
				if (token === BAD) {
					return Response.json(
						{ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login required' },
						{ status: 400 }
					);
				}
				return Response.json({ item: { item_id: 'item-good', institution_id: null } });
			}
			if (token === BAD) {
				return Response.json({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login required' }, { status: 400 });
			}
			if (path === '/accounts/get') {
				return Response.json({
					accounts: [{ account_id: 'acc-good', name: 'Healthy', type: 'depository', balances: { current: 1 } }]
				});
			}
			if (path === '/transactions/get') {
				return Response.json({
					transactions: [
						{
							transaction_id: 'tx-good-old',
							account_id: 'acc-good',
							date: '2026-10-01',
							amount: 5,
							name: 'Cafe'
						},
						{
							transaction_id: 'tx-good-new',
							account_id: 'acc-good',
							date: '2026-10-02',
							amount: 6,
							name: 'Market'
						}
					],
					total_transactions: 2
				});
			}
			return Response.json({});
		}) as typeof fetch;

		try {
			const summary = await syncNow(userId, 'plaid');
			expect('partialFailure' in summary && summary.partialFailure).toBe(true);
			expect(countOpenSyncReviews(userId)).toBe(0);
			expect(
				(db().query(`SELECT COUNT(*) AS n FROM transactions WHERE external_id = 'tx-good-new'`).get() as { n: number })
					.n
			).toBe(1);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('eligibleAccountIds skips orphans on other accounts', () => {
		const userId = user();
		const a = insertAccount(userId, 'acc-a', 'A');
		const b = insertAccount(userId, 'acc-b', 'B');
		const orphanA = insertTx(userId, a, 'gone-a');
		insertTx(userId, b, 'gone-b');
		mergeRepostedTransactions(userId, 'plaid', '2026-09-01', new Set(['live']), db(), new Set([b]));
		expect(countOpenSyncReviews(userId)).toBe(1);
		const open = db()
			.query(`SELECT orphan_transaction_id AS id FROM sync_review_items WHERE status = 'open'`)
			.get() as { id: number };
		expect(open.id).not.toBe(orphanA);
	});

	test('reconnect success syncs that item only and leaves no open reviews', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD, GOOD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'ITEM_LOGIN_REQUIRED');
		const badAcct = insertAccount(userId, 'acc-bad', 'Broken');
		const orphanId = insertTx(userId, badAcct, 'tx-bad-1');
		db()
			.query(
				`INSERT INTO sync_review_items (user_id, orphan_transaction_id, provider, status, candidate_transaction_ids, reason)
				 VALUES (?, ?, 'plaid', 'open', '[]', 'ambiguous_orphan')`
			)
			.run(userId, orphanId);
		setItemAccountExternalIds(userId, BAD, ['acc-bad']);
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(BAD)) as { id: number }
		).id;

		const tokensSeen: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const { path, body } = plaidBody(String(url), init);
			const token = String(body.access_token ?? '');
			if (token) tokensSeen.push(token);
			if (path === '/item/get') {
				return Response.json({ item: { item_id: 'item-bad', institution_id: null } });
			}
			if (path === '/accounts/get') {
				return Response.json({
					accounts: [{ account_id: 'acc-bad', name: 'Broken', type: 'depository', balances: { current: 2 } }]
				});
			}
			if (path === '/transactions/get') {
				return Response.json({
					transactions: [
						{
							transaction_id: 'tx-bad-1',
							account_id: 'acc-bad',
							date: '2026-10-01',
							amount: 5,
							name: 'Cafe'
						},
						{
							transaction_id: 'tx-bad-new',
							account_id: 'acc-bad',
							date: '2026-10-03',
							amount: 7,
							name: 'Shop'
						}
					],
					total_transactions: 2
				});
			}
			return Response.json({});
		}) as typeof fetch;

		try {
			const summary = await finishPlaidReconnect(userId, itemId);
			expect('created' in summary && summary.created).toBe(1);
			expect(tokensSeen.every((t) => t === BAD || t === '')).toBe(true);
			expect(tokensSeen.includes(GOOD)).toBe(false);
			expect(
				(db().query('SELECT needs_reconnect AS n FROM plaid_items WHERE id = ?').get(itemId) as { n: number }).n
			).toBe(0);
			expect(countOpenSyncReviews(userId)).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('removed item makes no new review items and closes its open ones', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD, GOOD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'ITEM_LOGIN_REQUIRED');
		setItemAccountExternalIds(userId, BAD, ['acc-bad']);
		const badAcct = insertAccount(userId, 'acc-bad', 'Broken');
		const orphanId = insertTx(userId, badAcct, 'tx-bad-1');
		db()
			.query(
				`INSERT INTO sync_review_items (user_id, orphan_transaction_id, provider, status, candidate_transaction_ids, reason)
				 VALUES (?, ?, 'plaid', 'open', '[]', 'ambiguous_orphan')`
			)
			.run(userId, orphanId);
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(BAD)) as { id: number }
		).id;

		const original = globalThis.fetch;
		globalThis.fetch = (async () => Response.json({ removed: true })) as typeof fetch;
		try {
			await removePlaidItemForUser(userId, itemId);
		} finally {
			globalThis.fetch = original;
		}
		expect(countOpenSyncReviews(userId)).toBe(0);
		expect((db().query('SELECT COUNT(*) AS n FROM plaid_items').get() as { n: number }).n).toBe(0);
		// Remaining token still present
		const creds = JSON.parse(
			(db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials
		) as { access_tokens: string };
		expect(JSON.parse(creds.access_tokens)).toEqual([GOOD]);
	});

	test('partial failure keeps the normal sync interval', () => {
		const interval = 15;
		expect(
			nextSyncDelayMinutes(
				{
					accounts: 1,
					created: 1,
					updated: 0,
					merged: 0,
					lastSyncedAt: '2026-10-19 12:00:00',
					error: PLAID_PARTIAL_FAILURE_FALLBACK,
					partialFailure: true
				},
				interval
			)
		).toBe(interval);
		expect(nextSyncDelayMinutes({ error: 'hard fail' }, interval)).toBe(
			Math.max(interval, FAILURE_BACKOFF_MINUTES)
		);
		expect(
			nextSyncDelayMinutes(
				{ accounts: 1, created: 0, updated: 0, merged: 0, lastSyncedAt: '2026-10-19 12:00:00' },
				interval
			)
		).toBe(interval);
	});
});
