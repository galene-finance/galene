/**
 * Sync, reconnect (Link update mode), and remove read and write credentials
 * through the encryption helpers. Provider HTTP is mocked; values are fake.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from './db';
import { setSetting } from './finance';
import { createUser } from './users';
import { recordItemFailure, tokenHint } from './plaidItems';
import { reconnectLinkToken, removePlaidItemForUser, syncNow } from './sync';
import {
	openConnectionCredentials,
	plaintextSecretLocations,
	sealConnectionCredentials
} from './secrets';

const ENV_KEYS = [
	'GALENE_SECRET_KEY',
	'GALENE_SECRET_KEY_PREVIOUS',
	'GALENE_DEMO',
	'GALENE_DB_PATH',
	'GALENE_DATA_DIR',
	'GALENE_ALLOW_EPHEMERAL_DATA'
] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const KEY = randomBytes(32).toString('base64');
const GOOD = 'access-sandbox-goodtoken';
const BAD = 'access-sandbox-badtoken';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-secrets-sync-'));
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
		delete process.env[key];
	}
	process.env.GALENE_SECRET_KEY = KEY;
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

function link(userId: number, tokens: string[]) {
	db()
		.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
		.run(userId, sealConnectionCredentials({ access_tokens: JSON.stringify(tokens) }));
	return (db().query('SELECT id FROM connections WHERE user_id = ?').get(userId) as { id: number }).id;
}

function rawCredentials(): string {
	return (db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials;
}

function assertSealed(tokens: string[]) {
	const raw = rawCredentials();
	expect(raw.startsWith('enc:v1:')).toBe(true);
	for (const token of tokens) expect(raw).not.toContain(token);
	expect(JSON.parse(openConnectionCredentials(raw).access_tokens!)).toEqual(tokens);
	const secret = (
		db().query(`SELECT value FROM settings WHERE key = 'plaid_client_secret'`).get() as { value: string }
	).value;
	expect(secret.startsWith('enc:v1:')).toBe(true);
	expect(secret).not.toContain('client-secret-VALUE');
	expect(plaintextSecretLocations(db())).toEqual([]);
}

function plaidBody(url: string, init?: RequestInit): { path: string; body: Record<string, unknown> } {
	const path = new URL(url).pathname;
	const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
	return { path, body };
}

describe('encrypted connection credentials', () => {
	test('sync reads sealed credentials and leaves no plaintext', async () => {
		const userId = user();
		link(userId, [BAD, GOOD]);
		assertSealed([BAD, GOOD]);
		const logs: string[] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			logs.push(args.map(String).join(' '));
		};
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
			const tx = db().query('SELECT external_id FROM transactions WHERE user_id = ?').get(userId) as {
				external_id: string;
			};
			expect(tx.external_id).toBe('tx-good');
			assertSealed([BAD, GOOD]);
			const joined = logs.join('\n');
			expect(joined).not.toContain(GOOD);
			expect(joined).not.toContain(BAD);
			expect(joined).not.toContain('client-secret-VALUE');
		} finally {
			globalThis.fetch = original;
			console.error = originalError;
		}
	});

	test('reconnect update mode uses the sealed access token', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'PENDING_DISCONNECT');
		const itemId = (db().query('SELECT id FROM plaid_items').get() as { id: number }).id;
		const sent: { access_token?: string } = {};
		const original = globalThis.fetch;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { access_token?: string };
			sent.access_token = body.access_token;
			return Response.json({ link_token: 'link-sandbox-update' });
		}) as typeof fetch;
		try {
			const token = await reconnectLinkToken(userId, itemId);
			expect(token).toBe('link-sandbox-update');
			expect(sent.access_token).toBe(BAD);
		} finally {
			globalThis.fetch = original;
		}
		assertSealed([BAD]);
		expect(rawCredentials()).not.toContain(BAD);
	});

	test('remove writes the remaining tokens back as an envelope', async () => {
		const userId = user();
		const connectionId = link(userId, [BAD, GOOD]);
		recordItemFailure(userId, connectionId, BAD, 'item-bad', 'ITEM_LOGIN_REQUIRED');
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(BAD)) as { id: number }
		).id;
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			const { path, body } = plaidBody(String(url), init);
			if (path === '/item/remove') expect(body.access_token).toBe(BAD);
			if (path === '/accounts/get') return Response.json({ accounts: [] });
			return Response.json({ removed: true });
		}) as typeof fetch;
		try {
			await removePlaidItemForUser(userId, itemId);
		} finally {
			globalThis.fetch = original;
		}
		assertSealed([GOOD]);
		expect((db().query('SELECT COUNT(*) AS n FROM plaid_items').get() as { n: number }).n).toBe(0);
	});
});
