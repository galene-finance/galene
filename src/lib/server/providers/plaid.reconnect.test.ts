/**
 * ADO-58: per-item Plaid failures, update-mode Link tokens, reconnect, and
 * demo blocks. Sandbox credentials are not in this environment, so Plaid HTTP
 * is mocked. A live /sandbox/item/reset_login run belongs on a host that has
 * sandbox keys in Settings.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '../db';
import { setSetting } from '../finance';
import { createUser } from '../users';
import {
	completePlaidReconnect,
	reconnectLinkToken,
	removePlaidItemForUser,
	syncNow
} from '../sync';
import { recordItemFailure, tokenHint } from '../plaidItems';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const GOOD = 'access-sandbox-good';
const BAD = 'access-sandbox-bad';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-plaid-reconnect-'));
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

describe('Plaid item isolation (ADO-58)', () => {
	test('one failing item does not stop the other', async () => {
		const userId = user();
		link(userId, [BAD, GOOD]);
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
					accounts: [{ account_id: 'acc-good', name: 'Checking', type: 'depository', balances: { current: 12.5 } }]
				});
			}
			if (path === '/transactions/get') {
				return Response.json({
					transactions: [
						{
							transaction_id: 'tx-good',
							account_id: 'acc-good',
							date: '2026-10-01',
							amount: 4.25,
							name: 'Cafe'
						}
					],
					total_transactions: 1
				});
			}
			return Response.json({});
		}) as typeof fetch;

		try {
			const summary = await syncNow(userId, 'plaid');
			expect('created' in summary && summary.created).toBe(1);
			expect('error' in summary).toBe(true);
			const tx = db().query('SELECT external_id FROM transactions WHERE user_id = ?').get(userId) as {
				external_id: string;
			};
			expect(tx.external_id).toBe('tx-good');
			const item = db()
				.query('SELECT needs_reconnect AS n, error_code FROM plaid_items WHERE token_hint = ?')
				.get(tokenHint(BAD)) as { n: number; error_code: string };
			expect(item).toEqual({ n: 1, error_code: 'ITEM_LOGIN_REQUIRED' });
			const good = db()
				.query('SELECT needs_reconnect AS n FROM plaid_items WHERE token_hint = ?')
				.get(tokenHint(GOOD)) as { n: number };
			expect(good.n).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('update-mode link token includes that item access token', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'PENDING_DISCONNECT');
		const itemId = (db().query('SELECT id FROM plaid_items').get() as { id: number }).id;
		let sent: Record<string, unknown> | null = null;
		const original = globalThis.fetch;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
			return Response.json({ link_token: 'link-sandbox-update' });
		}) as typeof fetch;
		try {
			const token = await reconnectLinkToken(userId, itemId);
			expect(token).toBe('link-sandbox-update');
			expect(sent?.access_token).toBe(BAD);
			expect(sent?.products).toBeUndefined();
		} finally {
			globalThis.fetch = original;
		}
	});

	test('reconnect success clears the error and keeps mappings', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'ITEM_LOGIN_REQUIRED');
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, provider, external_id, name_locked)
				 VALUES (?, 'Everyday', 'bank', 'plaid', 'acc-1', 1)`
			)
			.run(userId);
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id)
				 VALUES (?, (SELECT id FROM accounts WHERE user_id = ?), '2026-09-01', -500, 'Cafe', 'plaid', 'tx-1')`
			)
			.run(userId, userId);
		const itemId = (db().query('SELECT id FROM plaid_items').get() as { id: number }).id;
		completePlaidReconnect(userId, itemId);
		const row = db().query('SELECT needs_reconnect AS n, error_code FROM plaid_items').get() as {
			n: number;
			error_code: string | null;
		};
		expect(row).toEqual({ n: 0, error_code: null });
		const creds = JSON.parse(
			(db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials
		) as { access_tokens: string };
		expect(JSON.parse(creds.access_tokens)).toEqual([BAD]);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(1);
		expect((db().query('SELECT name_locked AS n FROM accounts').get() as { n: number }).n).toBe(1);
	});

	test('demo mode blocks reconnect and remove', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD, GOOD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'PENDING_EXPIRATION');
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(BAD)) as { id: number }
		).id;
		process.env.GALENE_DEMO = '1';
		expect(() => completePlaidReconnect(userId, itemId)).toThrow(/demo/i);
		await expect(reconnectLinkToken(userId, itemId)).rejects.toThrow(/demo/i);
		await expect(removePlaidItemForUser(userId, itemId)).rejects.toThrow(/demo/i);
		const still = JSON.parse(
			(db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials
		) as { access_tokens: string };
		expect(JSON.parse(still.access_tokens)).toEqual([BAD, GOOD]);
		expect(
			(db().query('SELECT needs_reconnect AS n FROM plaid_items WHERE id = ?').get(itemId) as { n: number }).n
		).toBe(1);
	});

	test('remove drops one token and asks Plaid to remove that item', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD, GOOD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'ITEM_LOGIN_REQUIRED');
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(BAD)) as { id: number }
		).id;
		const calls: string[] = [];
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const { path, body } = plaidBody(String(url), init);
			calls.push(`${path}:${body.access_token}`);
			return Response.json({ removed: true });
		}) as typeof fetch;
		try {
			await removePlaidItemForUser(userId, itemId);
		} finally {
			globalThis.fetch = original;
		}
		expect(calls).toContain(`/item/remove:${BAD}`);
		const creds = JSON.parse(
			(db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials
		) as { access_tokens: string };
		expect(JSON.parse(creds.access_tokens)).toEqual([GOOD]);
		expect((db().query('SELECT COUNT(*) AS n FROM plaid_items').get() as { n: number }).n).toBe(0);
	});
});
