/**
 * ADO-59: refuse a second Plaid Item for a login that is already linked.
 * Sandbox keys are not available in this environment, so Plaid HTTP is mocked
 * (same pattern as the other Plaid tests).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '../db';
import { deleteAccountWithTransactions, setSetting } from '../finance';
import { createUser } from '../users';
import { connect, finishPlaidReconnect, reconnectLinkToken, syncNow } from '../sync';
import { setItemAccountExternalIds, tokenHint, upsertPlaidItem } from '../plaidItems';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

const EXISTING = 'access-sandbox-existing';
const NEW_TOKEN = 'access-sandbox-new';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-plaid-dup-'));
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

function user(email = 'sync@example.com'): number {
	const created = createUser({
		name: 'Sync',
		email,
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
	return (db().query('SELECT id FROM connections WHERE user_id = ? AND provider = ?').get(userId, 'plaid') as {
		id: number;
	}).id;
}

function plaidBody(url: string, init?: RequestInit): { path: string; body: Record<string, unknown> } {
	const path = new URL(url).pathname;
	const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
	return { path, body };
}

function metadata(institutionId: string, accounts: { name: string | null; mask: string | null }[]) {
	return JSON.stringify({
		institution: { institution_id: institutionId, name: 'Example Bank' },
		accounts
	});
}

function storedTokens(): string[] {
	const row = db().query(`SELECT credentials FROM connections WHERE provider = 'plaid'`).get() as
		| { credentials: string }
		| undefined;
	if (!row) return [];
	const creds = JSON.parse(row.credentials) as { access_tokens?: string };
	return JSON.parse(creds.access_tokens ?? '[]') as string[];
}

interface MockOpts {
	institutionId?: string;
	accounts?: { account_id: string; name: string; mask?: string | null; subtype?: string | null; type?: string }[];
	calls: { path: string; token?: string; publicToken?: string; products?: unknown; accessToken?: string }[];
}

function mockPlaid(opts: MockOpts) {
	const original = globalThis.fetch;
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const { path, body } = plaidBody(String(url), init);
		const access = body.access_token ? String(body.access_token) : undefined;
		opts.calls.push({
			path,
			token: access,
			publicToken: body.public_token ? String(body.public_token) : undefined,
			products: body.products,
			accessToken: access
		});
		if (path === '/item/public_token/exchange') {
			return Response.json({ access_token: NEW_TOKEN });
		}
		if (path === '/item/get') {
			const existing = access === EXISTING;
			return Response.json({
				item: {
					item_id: existing ? 'item-existing' : 'item-new',
					institution_id: opts.institutionId ?? 'ins_test_1'
				}
			});
		}
		if (path === '/institutions/get_by_id') {
			return Response.json({ institution: { name: 'Example Bank' } });
		}
		if (path === '/accounts/get') {
			return Response.json({ accounts: opts.accounts ?? [] });
		}
		if (path === '/transactions/get') {
			return Response.json({ transactions: [], total_transactions: 0 });
		}
		if (path === '/item/remove') return Response.json({ removed: true });
		if (path === '/link/token/create') {
			return Response.json({ link_token: 'link-sandbox-update' });
		}
		return Response.json({});
	}) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

function seedExistingItem(userId: number, opts: { mask: string | null; institutionId?: string }) {
	const connectionId = link(userId, [EXISTING]);
	upsertPlaidItem(userId, connectionId, {
		accessToken: EXISTING,
		itemId: 'item-existing',
		institutionName: 'Example Bank',
		institutionId: opts.institutionId ?? 'ins_test_1'
	});
	setItemAccountExternalIds(userId, EXISTING, ['acc-existing']);
	db()
		.query(
			`INSERT INTO accounts (user_id, name, type, provider, external_id, mask, subtype)
			 VALUES (?, 'Checking', 'bank', 'plaid', 'acc-existing', ?, 'checking')`
		)
		.run(userId, opts.mask);
	db()
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, provider, external_id)
			 VALUES (?, (SELECT id FROM accounts WHERE user_id = ? AND external_id = 'acc-existing'), '2026-09-01', -500, 'Cafe', 'plaid', 'tx-existing')`
		)
		.run(userId, userId);
	return connectionId;
}

describe('Plaid duplicate item guard (ADO-59)', () => {
	test('blocks a name and mask match before exchange', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234' });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({ calls });
		try {
			const result = await connect(userId, 'plaid', {
				public_token: 'public-sandbox-once',
				plaid_metadata: metadata('ins_test_1', [{ name: 'Checking', mask: '1234' }])
			});
			expect(result && 'alreadyLinked' in result && result.alreadyLinked).toBe(true);
			if (result && 'alreadyLinked' in result) {
				expect(result.item.label).toBe('Example Bank');
			}
			expect(result && 'alreadyLinked' in result && result.exchanged).toBe(false);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(false);
		expect(storedTokens()).toEqual([EXISTING]);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(1);
	});

	test('institution id alone matches when masks are null', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: null });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({ calls });
		try {
			const result = await connect(userId, 'plaid', {
				public_token: 'public-sandbox-once',
				plaid_metadata: metadata('ins_test_1', [{ name: 'Checking', mask: '1234' }])
			});
			expect(result && 'alreadyLinked' in result && result.alreadyLinked).toBe(true);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(false);
		expect(storedTokens()).toEqual([EXISTING]);
	});

	test('institution id alone matches when incoming name and mask are missing', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234' });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({ calls });
		try {
			const result = await connect(userId, 'plaid', {
				public_token: 'public-sandbox-once',
				plaid_metadata: metadata('ins_test_1', [{ name: null, mask: null }])
			});
			expect(result && 'alreadyLinked' in result && result.alreadyLinked).toBe(true);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(false);
		expect(storedTokens()).toEqual([EXISTING]);
	});

	test('override exchanges and stores the new item', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234' });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			accounts: [{ account_id: 'acc-new', name: 'Checking', mask: '1234', subtype: 'checking', type: 'depository' }]
		});
		try {
			const result = await connect(userId, 'plaid', {
				public_token: 'public-sandbox-once',
				plaid_allow_duplicate: '1',
				plaid_metadata: metadata('ins_test_1', [{ name: 'Checking', mask: '1234' }])
			});
			expect(result == null).toBe(true);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(true);
		expect(calls.some((c) => c.path === '/item/remove')).toBe(false);
		expect(storedTokens()).toEqual([EXISTING, NEW_TOKEN]);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts WHERE external_id = ?').get('acc-existing') as { n: number }).n).toBe(
			1
		);
	});

	test('a different institution proceeds', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234', institutionId: 'ins_test_1' });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			institutionId: 'ins_test_2',
			accounts: [{ account_id: 'acc-other', name: 'Savings', mask: '9999', type: 'depository' }]
		});
		try {
			const result = await connect(userId, 'plaid', {
				public_token: 'public-sandbox-once',
				plaid_metadata: metadata('ins_test_2', [{ name: 'Savings', mask: '9999' }])
			});
			expect(result == null).toBe(true);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(true);
		expect(calls.some((c) => c.path === '/item/remove')).toBe(false);
		expect(storedTokens()).toContain(NEW_TOKEN);
	});

	test('safety net removes the new token when metadata is missing', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234' });
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			institutionId: 'ins_test_1',
			accounts: [{ account_id: 'acc-new', name: 'Checking', mask: '1234', type: 'depository' }]
		});
		try {
			const result = await connect(userId, 'plaid', { public_token: 'public-sandbox-once' });
			expect(result && 'alreadyLinked' in result && result.alreadyLinked).toBe(true);
			// The spent public token cannot be resubmitted; the UI must relink.
			expect(result && 'alreadyLinked' in result && result.exchanged).toBe(true);
		} finally {
			restore();
		}
		expect(calls.some((c) => c.path === '/item/public_token/exchange')).toBe(true);
		expect(calls.some((c) => c.path === '/accounts/get')).toBe(true);
		expect(calls.some((c) => c.path === '/item/remove' && c.token === NEW_TOKEN)).toBe(true);
		expect(storedTokens()).toEqual([EXISTING]);
		expect((db().query('SELECT COUNT(*) AS n FROM plaid_items WHERE token_hint = ?').get(tokenHint(NEW_TOKEN)) as { n: number }).n).toBe(
			0
		);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
	});

	test('reconnect works on a healthy item', async () => {
		const userId = user();
		seedExistingItem(userId, { mask: '1234' });
		const itemId = (db().query('SELECT id FROM plaid_items').get() as { id: number }).id;
		expect(
			(db().query('SELECT needs_reconnect AS n FROM plaid_items WHERE id = ?').get(itemId) as { n: number }).n
		).toBe(0);
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			accounts: [
				{
					account_id: 'acc-existing',
					name: 'Checking',
					mask: '1234',
					subtype: 'checking',
					type: 'depository'
				}
			]
		});
		try {
			const token = await reconnectLinkToken(userId, itemId);
			expect(token).toBe('link-sandbox-update');
			const create = calls.find((c) => c.path === '/link/token/create');
			expect(create?.accessToken).toBe(EXISTING);
			expect(create?.products).toBeUndefined();
			const summary = await finishPlaidReconnect(userId, itemId);
			expect('created' in summary).toBe(true);
		} finally {
			restore();
		}
		expect(
			(db().query('SELECT needs_reconnect AS n FROM plaid_items WHERE id = ?').get(itemId) as { n: number }).n
		).toBe(0);
		expect(storedTokens()).toEqual([EXISTING]);
	});

	test('sync backfills institution_id and mask/subtype', async () => {
		const userId = user();
		const connectionId = link(userId, [EXISTING]);
		upsertPlaidItem(userId, connectionId, {
			accessToken: EXISTING,
			itemId: 'item-existing',
			institutionName: null
		});
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, provider, external_id)
				 VALUES (?, 'Checking', 'bank', 'plaid', 'acc-existing')`
			)
			.run(userId);
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			institutionId: 'ins_test_1',
			accounts: [
				{
					account_id: 'acc-existing',
					name: 'Checking',
					mask: '4321',
					subtype: 'savings',
					type: 'depository'
				}
			]
		});
		try {
			const summary = await syncNow(userId, 'plaid');
			expect('error' in summary && !('accounts' in summary)).toBe(false);
		} finally {
			restore();
		}
		const item = db()
			.query('SELECT institution_id FROM plaid_items WHERE token_hint = ?')
			.get(tokenHint(EXISTING)) as { institution_id: string };
		expect(item.institution_id).toBe('ins_test_1');
		const account = db().query('SELECT mask, subtype FROM accounts WHERE external_id = ?').get('acc-existing') as {
			mask: string;
			subtype: string;
		};
		expect(account).toEqual({ mask: '4321', subtype: 'savings' });
	});

	test('migration adds institution_id and account mask/subtype', () => {
		const itemCols = db().query('PRAGMA table_info(plaid_items)').all() as { name: string }[];
		const accountCols = db().query('PRAGMA table_info(accounts)').all() as { name: string }[];
		expect(itemCols.some((c) => c.name === 'institution_id')).toBe(true);
		expect(accountCols.some((c) => c.name === 'mask')).toBe(true);
		expect(accountCols.some((c) => c.name === 'subtype')).toBe(true);
	});

	test('blank mask on a later sync does not wipe a stored mask', async () => {
		const userId = user();
		link(userId, [EXISTING]);
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, provider, external_id, mask, subtype)
				 VALUES (?, 'Checking', 'bank', 'plaid', 'acc-existing', '1111', 'checking')`
			)
			.run(userId);
		const calls: MockOpts['calls'] = [];
		const restore = mockPlaid({
			calls,
			accounts: [{ account_id: 'acc-existing', name: 'Checking', mask: '', subtype: '', type: 'depository' }]
		});
		try {
			await syncNow(userId, 'plaid');
		} finally {
			restore();
		}
		const account = db().query('SELECT mask, subtype FROM accounts WHERE external_id = ?').get('acc-existing') as {
			mask: string;
			subtype: string;
		};
		expect(account).toEqual({ mask: '1111', subtype: 'checking' });
	});
});

describe('deleteAccountWithTransactions', () => {
	function seedAccount(userId: number, externalId: string, merchant: string) {
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, provider, external_id)
				 VALUES (?, ?, 'bank', 'plaid', ?)`
			)
			.run(userId, externalId, externalId);
		const accountId = (
			db().query('SELECT id FROM accounts WHERE user_id = ? AND external_id = ?').get(userId, externalId) as {
				id: number;
			}
		).id;
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant)
				 VALUES (?, ?, '2026-09-01', -100, ?)`
			)
			.run(userId, accountId, merchant);
		const txnId = (
			db().query('SELECT id FROM transactions WHERE user_id = ? AND account_id = ?').get(userId, accountId) as {
				id: number;
			}
		).id;
		db().query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Food', 'expense')`).run(userId);
		const categoryId = (db().query('SELECT id FROM categories WHERE user_id = ?').get(userId) as { id: number }).id;
		db()
			.query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, -100)`)
			.run(txnId, categoryId);
		db().query(`INSERT INTO tags (user_id, name) VALUES (?, 'cafe')`).run(userId);
		const tagId = (db().query('SELECT id FROM tags WHERE user_id = ?').get(userId) as { id: number }).id;
		db().query(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`).run(txnId, tagId);
		db()
			.query(
				`INSERT INTO sync_review_items (user_id, orphan_transaction_id, provider, candidate_transaction_ids)
				 VALUES (?, ?, 'plaid', '[]')`
			)
			.run(userId, txnId);
		return { accountId, txnId };
	}

	test('removes one account and leaves the other', () => {
		const userId = user();
		const target = seedAccount(userId, 'acc-a', 'Cafe');
		const otherUser = user('other@example.com');
		const otherUserAccount = seedAccount(otherUser, 'acc-other', 'Diner');
		db()
			.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Cash', 'cash')`)
			.run(userId);
		const otherId = (
			db().query(`SELECT id FROM accounts WHERE user_id = ? AND name = 'Cash'`).get(userId) as { id: number }
		).id;
		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant)
				 VALUES (?, ?, '2026-09-02', -50, 'Shop')`
			)
			.run(userId, otherId);
		const keptTxn = (
			db().query('SELECT id FROM transactions WHERE account_id = ?').get(otherId) as { id: number }
		).id;
		db()
			.query(
				`INSERT INTO sync_review_items (user_id, orphan_transaction_id, provider, candidate_transaction_ids)
				 VALUES (?, ?, 'plaid', ?)`
			)
			.run(userId, keptTxn, JSON.stringify([target.txnId, keptTxn]));
		db()
			.query(
				`INSERT INTO scheduled (user_id, name, account_id, amount_cents, start_date, repeat_interval, repeat_unit)
				 VALUES (?, 'Rent', ?, -1000, '2026-09-01', 1, 'month')`
			)
			.run(userId, target.accountId);
		const scheduledId = (
			db().query('SELECT id FROM scheduled WHERE user_id = ? AND account_id = ?').get(userId, target.accountId) as {
				id: number;
			}
		).id;
		db()
			.query(
				`INSERT INTO scheduled_revisions (scheduled_id, effective_date, name, account_id, amount_cents)
				 VALUES (?, '2026-10-01', 'Rent', ?, -1100)`
			)
			.run(scheduledId, target.accountId);
		const revisionId = (
			db().query('SELECT id FROM scheduled_revisions WHERE scheduled_id = ?').get(scheduledId) as { id: number }
		).id;
		db()
			.query(
				`INSERT INTO scheduled_exceptions (scheduled_id, occurrence_date, display_date, name, account_id, amount_cents)
				 VALUES (?, '2026-11-01', '2026-11-03', 'Rent', ?, -1000)`
			)
			.run(scheduledId, target.accountId);
		const exceptionId = (
			db().query('SELECT id FROM scheduled_exceptions WHERE scheduled_id = ?').get(scheduledId) as { id: number }
		).id;
		const connectionId = link(userId, [EXISTING]);
		upsertPlaidItem(userId, connectionId, {
			accessToken: EXISTING,
			itemId: 'item-existing',
			institutionName: 'Example Bank',
			institutionId: 'ins_test_1'
		});
		setItemAccountExternalIds(userId, EXISTING, ['acc-a', 'acc-keep']);

		deleteAccountWithTransactions(userId, target.accountId);

		expect((db().query('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(target.accountId) as { n: number }).n).toBe(
			0
		);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(target.txnId) as { n: number }).n).toBe(
			0
		);
		expect(
			(db().query('SELECT COUNT(*) AS n FROM transaction_splits WHERE transaction_id = ?').get(target.txnId) as {
				n: number;
			}).n
		).toBe(0);
		expect(
			(db().query('SELECT COUNT(*) AS n FROM transaction_tags WHERE transaction_id = ?').get(target.txnId) as {
				n: number;
			}).n
		).toBe(0);
		expect(
			(db().query('SELECT COUNT(*) AS n FROM sync_review_items WHERE orphan_transaction_id = ?').get(target.txnId) as {
				n: number;
			}).n
		).toBe(0);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(otherId) as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(keptTxn) as { n: number }).n).toBe(1);
		const review = db()
			.query('SELECT candidate_transaction_ids AS c FROM sync_review_items WHERE orphan_transaction_id = ?')
			.get(keptTxn) as { c: string };
		expect(JSON.parse(review.c)).toEqual([keptTxn]);
		expect(
			(db().query('SELECT account_id AS a FROM scheduled WHERE id = ?').get(scheduledId) as { a: number | null }).a
		).toBe(null);
		expect(
			(db().query('SELECT account_id AS a FROM scheduled_revisions WHERE id = ?').get(revisionId) as {
				a: number | null;
			}).a
		).toBe(null);
		expect(
			(db().query('SELECT account_id AS a FROM scheduled_exceptions WHERE id = ?').get(exceptionId) as {
				a: number | null;
			}).a
		).toBe(null);
		expect(
			JSON.parse(
				(
					db().query('SELECT account_external_ids AS ids FROM plaid_items WHERE user_id = ?').get(userId) as {
						ids: string;
					}
				).ids
			)
		).toEqual(['acc-keep']);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(otherUserAccount.accountId) as { n: number }).n).toBe(
			1
		);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(otherUserAccount.txnId) as { n: number }).n).toBe(
			1
		);
	});

	test('refuses another user account id', () => {
		const owner = user();
		const { accountId } = seedAccount(owner, 'acc-a', 'Cafe');
		const stranger = user('stranger@example.com');
		expect(() => deleteAccountWithTransactions(stranger, accountId)).toThrow(/not found/i);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(accountId) as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(1);
	});

	test('throws in demo mode', () => {
		const userId = user();
		const { accountId } = seedAccount(userId, 'acc-a', 'Cafe');
		process.env.GALENE_DEMO = '1';
		expect(() => deleteAccountWithTransactions(userId, accountId)).toThrow(/demo/i);
		expect((db().query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(1);
	});
});
