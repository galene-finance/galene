/**
 * Per-item Plaid sync status: one institution can fail without hiding the
 * reason, and a later success clears that item.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '../db';
import { setSetting } from '../finance';
import { tokenHint, upsertPlaidItem } from '../plaidItems';
import { listPlaidItemsForSettings, reconnectLinkToken, syncNow } from '../sync';
import { createUser } from '../users';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const SECRET = 'access-sandbox-SECRET123';
const OK = 'access-sandbox-ok';
const NO_ACCOUNTS = 'access-sandbox-no-accounts';
const LOGIN = 'access-sandbox-login';
const DOWN = 'access-sandbox-down';
const UNKNOWN = 'access-sandbox-unknown';

const NAMES: Record<string, { itemId: string; institutionId: string; name: string }> = {
	[OK]: { itemId: 'item-ok', institutionId: 'ins-ok', name: 'Plain Savings' },
	[NO_ACCOUNTS]: { itemId: 'item-none', institutionId: 'ins-none', name: 'Example Bank' },
	[LOGIN]: { itemId: 'item-login', institutionId: 'ins-login', name: 'Sample Credit Union' },
	[DOWN]: { itemId: 'item-down', institutionId: 'ins-down', name: 'Harbor Savings' },
	[UNKNOWN]: { itemId: 'item-unknown', institutionId: 'ins-unknown', name: 'Community Credit Union' },
	[SECRET]: { itemId: 'item-secret', institutionId: 'ins-secret', name: 'Example Bank' }
};

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-plaid-item-state-'));
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

function link(userId: number, tokens: string[]) {
	db()
		.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
		.run(userId, JSON.stringify({ access_tokens: JSON.stringify(tokens) }));
	return (db().query('SELECT id FROM connections WHERE user_id = ? AND provider = ?').get(userId, 'plaid') as { id: number }).id;
}

function plaidBody(url: string, init?: RequestInit): { path: string; body: Record<string, unknown> } {
	const path = new URL(url).pathname;
	const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
	return { path, body };
}

function errorBody(code: string, type: string, message: string) {
	return Response.json(
		{ error_code: code, error_type: type, error_message: message, display_message: 'shown to user' },
		{ status: 400 }
	);
}

function mockFetch(opts: { loginAtItemGet?: boolean; recoverNoAccounts?: boolean }) {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		const { path, body } = plaidBody(String(url), init);
		const token = String(body.access_token ?? '');
		const known = NAMES[token];
		if (path === '/institutions/get_by_id') {
			const id = String(body.institution_id ?? '');
			const match = Object.values(NAMES).find((row) => row.institutionId === id);
			return Response.json({ institution: { name: match?.name ?? 'Example Bank' } });
		}
		if (path === '/item/get') {
			if (opts.loginAtItemGet && token === LOGIN) {
				return errorBody('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 'login required');
			}
			if (token === SECRET) {
				return Response.json({
					item: { item_id: NAMES[SECRET].itemId, institution_id: NAMES[SECRET].institutionId, error: null }
				});
			}
			if (!known) return Response.json({ item: { item_id: 'item-x', institution_id: null } });
			return Response.json({
				item: { item_id: known.itemId, institution_id: known.institutionId, error: null }
			});
		}
		if (path === '/accounts/get') {
			if (token === SECRET) {
				return errorBody('NO_ACCOUNTS', 'ITEM_ERROR', `no accounts for ${SECRET}`);
			}
			if (token === NO_ACCOUNTS && !opts.recoverNoAccounts) {
				return errorBody('NO_ACCOUNTS', 'ITEM_ERROR', 'no accounts are authorized');
			}
			if (token === DOWN) return errorBody('INSTITUTION_DOWN', 'INSTITUTION_ERROR', 'institution down');
			if (token === UNKNOWN) return errorBody('PRODUCT_NOT_ENABLED', 'INVALID_REQUEST', 'product not enabled');
			if (token === LOGIN) return errorBody('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 'login required');
			const id = known?.itemId === 'item-ok' ? 'acc-ok' : `acc-${token.slice(-4)}`;
			return Response.json({
				accounts: [{ account_id: id, name: 'Checking', type: 'depository', balances: { current: 10 } }]
			});
		}
		if (path === '/transactions/get') {
			return Response.json({ transactions: [], total_transactions: 0 });
		}
		if (path === '/link/token/create') {
			return Response.json({ link_token: 'link-sandbox-update' });
		}
		return Response.json({});
	}) as typeof fetch;
}

describe('Plaid per-item sync status', () => {
	test('records each failure, names them in the banner, and clears a later success', async () => {
		const userId = user();
		const connectionId = link(userId, [OK, NO_ACCOUNTS, LOGIN, DOWN, UNKNOWN]);
		upsertPlaidItem(userId, connectionId, {
			accessToken: LOGIN,
			itemId: 'item-login',
			institutionName: 'Sample Credit Union',
			institutionId: 'ins-login'
		});
		const original = globalThis.fetch;
		const lines: string[] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			lines.push(args.map((part) => String(part)).join(' '));
		};
		globalThis.fetch = mockFetch({ loginAtItemGet: true });
		try {
			const summary = await syncNow(userId, 'plaid');
			expect('partialFailure' in summary && summary.partialFailure).toBe(true);
			expect('error' in summary && summary.error).toContain('Example Bank: Plaid found no accounts to sync.');
			expect(summary && 'error' in summary && summary.error).toContain(
				'Reconnect it and choose the accounts to share.'
			);
			expect('error' in summary && summary.error).toContain('Sample Credit Union');
			expect('error' in summary && summary.error).toContain('needs you to sign in again');
			expect('error' in summary && summary.error).toContain('Harbor Savings');
			expect('error' in summary && summary.error).toContain('Try again later.');
			expect('error' in summary && summary.error).toContain('Community Credit Union');
			expect('error' in summary && summary.error).toContain('PRODUCT_NOT_ENABLED');
			expect('error' in summary && summary.error).not.toContain('Plain Savings');
			expect('error' in summary && summary.error).not.toContain('Some linked institutions could not be synced');

			const lastError = (
				db().query('SELECT last_error FROM connections WHERE user_id = ?').get(userId) as { last_error: string }
			).last_error;
			expect(lastError).toBe('error' in summary ? summary.error : '');
			const note = db()
				.query(`SELECT body FROM notifications WHERE user_id = ? AND kind = 'sync_failed'`)
				.get(userId) as { body: string };
			expect(note.body).toBe(lastError);

			const views = listPlaidItemsForSettings(userId);
			const byLabel = Object.fromEntries(views.map((item) => [item.label, item]));
			expect(byLabel['Plain Savings'].state).toBe('connected');
			expect(byLabel['Plain Savings'].statusLabel).toBe('connected');
			expect(byLabel['Example Bank'].state).toBe('reselect_accounts');
			expect(byLabel['Example Bank'].statusLabel).toBe('choose accounts again');
			expect(byLabel['Example Bank'].showReconnect).toBe(true);
			expect(byLabel['Example Bank'].errorCode).toBe('NO_ACCOUNTS');
			expect(byLabel['Sample Credit Union'].state).toBe('needs_relogin');
			expect(byLabel['Sample Credit Union'].statusLabel).toBe('needs re-login');
			expect(byLabel['Harbor Savings'].state).toBe('temporary');
			expect(byLabel['Harbor Savings'].showReconnect).toBe(false);
			expect(byLabel['Community Credit Union'].state).toBe('error');
			expect(byLabel['Community Credit Union'].showReconnect).toBe(true);
			expect(byLabel['Community Credit Union'].reason).toContain('PRODUCT_NOT_ENABLED');

			const none = db()
				.query(
					`SELECT last_sync_status, error_code, error_type, error_message, needs_reconnect
					 FROM plaid_items WHERE token_hint = ?`
				)
				.get(tokenHint(NO_ACCOUNTS)) as {
				last_sync_status: string;
				error_code: string;
				error_type: string;
				error_message: string;
				needs_reconnect: number;
			};
			expect(none.last_sync_status).toBe('error');
			expect(none.error_code).toBe('NO_ACCOUNTS');
			expect(none.error_type).toBe('ITEM_ERROR');
			expect(none.error_message).toBe('no accounts are authorized');
			expect(none.needs_reconnect).toBe(0);

			const login = db()
				.query('SELECT needs_reconnect AS n, error_type FROM plaid_items WHERE token_hint = ?')
				.get(tokenHint(LOGIN)) as { n: number; error_type: string };
			expect(login).toEqual({ n: 1, error_type: 'ITEM_ERROR' });

			const ok = db()
				.query(
					`SELECT last_sync_status, error_code, needs_reconnect FROM plaid_items WHERE token_hint = ?`
				)
				.get(tokenHint(OK)) as { last_sync_status: string; error_code: string | null; needs_reconnect: number };
			expect(ok).toEqual({ last_sync_status: 'ok', error_code: null, needs_reconnect: 0 });

			const failureLines = lines.filter((line) => line.includes('[Plaid] item sync failed'));
			expect(failureLines).toHaveLength(4);
			expect(failureLines.some((line) => line.includes('item=item-login'))).toBe(true);
			expect(failureLines.some((line) => line.includes('code=ITEM_LOGIN_REQUIRED'))).toBe(true);
			expect(failureLines.some((line) => line.includes('type=ITEM_ERROR'))).toBe(true);
			expect(failureLines.join('\n')).not.toContain('client-secret-VALUE');
		} finally {
			console.error = originalError;
			globalThis.fetch = original;
		}

		globalThis.fetch = mockFetch({ loginAtItemGet: true, recoverNoAccounts: true });
		try {
			await syncNow(userId, 'plaid');
			const recovered = listPlaidItemsForSettings(userId).find((item) => item.label === 'Example Bank');
			expect(recovered?.state).toBe('connected');
			expect(recovered?.errorCode).toBe(null);
			expect(recovered?.reason).toBe(null);
			const row = db()
				.query(
					`SELECT last_sync_status, error_code, error_type, error_message, needs_reconnect
					 FROM plaid_items WHERE token_hint = ?`
				)
				.get(tokenHint(NO_ACCOUNTS)) as {
				last_sync_status: string;
				error_code: string | null;
				error_type: string | null;
				error_message: string | null;
				needs_reconnect: number;
			};
			expect(row).toEqual({
				last_sync_status: 'ok',
				error_code: null,
				error_type: null,
				error_message: null,
				needs_reconnect: 0
			});
			const lastError = (
				db().query('SELECT last_error FROM connections WHERE user_id = ?').get(userId) as { last_error: string }
			).last_error;
			expect(lastError).not.toContain('Example Bank');
			expect(lastError).toContain('Sample Credit Union');
		} finally {
			globalThis.fetch = original;
		}
	});

	test('link token for choose-accounts enables account selection and stays on that item', async () => {
		const userId = user();
		const connectionId = link(userId, [NO_ACCOUNTS, LOGIN]);
		upsertPlaidItem(userId, connectionId, {
			accessToken: NO_ACCOUNTS,
			itemId: 'item-none',
			institutionName: 'Example Bank'
		});
		db()
			.query(
				`UPDATE plaid_items
				 SET error_code = 'NO_ACCOUNTS', error_at = datetime('now'), needs_reconnect = 0,
				     last_sync_status = 'error', last_sync_at = datetime('now')
				 WHERE user_id = ? AND token_hint = ?`
			)
			.run(userId, tokenHint(NO_ACCOUNTS));
		const itemId = (
			db().query('SELECT id FROM plaid_items WHERE token_hint = ?').get(tokenHint(NO_ACCOUNTS)) as { id: number }
		).id;
		const captured: { body: Record<string, unknown> } = { body: {} };
		const original = globalThis.fetch;
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
			return Response.json({ link_token: 'link-sandbox-update' });
		}) as typeof fetch;
		try {
			const token = await reconnectLinkToken(userId, itemId);
			expect(token).toBe('link-sandbox-update');
			expect(captured.body.access_token).toBe(NO_ACCOUNTS);
			expect(captured.body.products).toBeUndefined();
			expect(captured.body.update).toEqual({ account_selection_enabled: true });
			expect(JSON.stringify(captured.body)).not.toContain(LOGIN);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('a failing sync logs one line and never the access token or its hint', async () => {
		const userId = user();
		link(userId, [SECRET]);
		const hint = tokenHint(SECRET);
		const lines: string[] = [];
		const originalError = console.error;
		const originalFetch = globalThis.fetch;
		console.error = (...args: unknown[]) => {
			lines.push(args.map((part) => String(part)).join(' '));
		};
		globalThis.fetch = mockFetch({});
		try {
			await syncNow(userId, 'plaid');
		} finally {
			console.error = originalError;
			globalThis.fetch = originalFetch;
		}
		const failureLines = lines.filter((line) => line.includes('[Plaid] item sync failed'));
		expect(failureLines).toHaveLength(1);
		const line = failureLines[0];
		expect(line).toContain('item=item-secret');
		expect(line).toContain('institution=Example Bank');
		expect(line).toContain('code=NO_ACCOUNTS');
		expect(line).toContain('type=ITEM_ERROR');
		expect(line).not.toContain(SECRET);
		expect(line).not.toContain(hint);
		expect(line).not.toContain('SECRET123');
		expect(line).not.toContain('client-secret-VALUE');
		const stored = db()
			.query('SELECT error_message FROM plaid_items WHERE token_hint = ?')
			.get(hint) as { error_message: string };
		expect(stored.error_message).not.toContain(SECRET);
		expect(stored.error_message).not.toContain('SECRET123');
		expect(stored.error_message).toContain('[redacted]');
	});
});
