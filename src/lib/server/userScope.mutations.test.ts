/**
 * User scoping for tag, split, and scheduled-tag mutations.
 * Two users share one database; B must not change A's junction rows.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGrant, getGrant } from './advisor';
import { closeDbForTests, db, migrate } from './db';
import { deleteAllData } from './data';
import {
	bulkAddTags,
	bulkSetCategory,
	clearTransactionSplits,
	saveBudget,
	saveRule,
	saveScheduled,
	saveTransaction,
	saveTransactionSplits,
	transactionInputFromForm,
	scheduledInputFromForm,
	type ScheduledInput,
	type TransactionInput
} from './finance';
import { createUser } from './users';
import { createApiToken } from './apiTokens';
import { executeWrite, saveWriteApiSettings } from './writeApi';

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-user-scope-'));
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
		delete process.env[key];
	}
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	process.env.GALENE_DATA_DIR = dir;
	process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
	closeDbForTests();
	migrate(db());
});

afterEach(() => {
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const v = saved[key];
		if (v === undefined) delete process.env[key];
		else process.env[key] = v;
		delete saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

function makeUser(name: string, email: string): number {
	const created = createUser({
		name,
		email,
		password: 'password1',
		isAdmin: false,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function seedLedger(userId: number, label: string) {
	const d = db();
	d.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, ?, 'bank')`).run(userId, `${label} Checking`);
	const accountId = Number(
		(d.query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id
	);
	d.query(`INSERT INTO categories (user_id, name, type) VALUES (?, ?, 'expense')`).run(userId, `${label} Food`);
	d.query(`INSERT INTO categories (user_id, name, type) VALUES (?, ?, 'expense')`).run(userId, `${label} Rent`);
	const cats = d
		.query('SELECT id, name FROM categories WHERE user_id = ? ORDER BY id')
		.all(userId) as { id: number; name: string }[];
	const foodId = cats.find((c) => c.name.endsWith('Food'))!.id;
	const rentId = cats.find((c) => c.name.endsWith('Rent'))!.id;
	d.query(`INSERT INTO tags (user_id, name) VALUES (?, ?)`).run(userId, `${label} Trip`);
	const tagId = Number((d.query('SELECT id FROM tags WHERE user_id = ?').get(userId) as { id: number }).id);
	d.query(
		`INSERT INTO transactions (user_id, account_id, category_id, date, amount_cents, merchant)
		 VALUES (?, ?, ?, '2026-01-15', -5000, ?)`
	).run(userId, accountId, foodId, `${label} Cafe`);
	const txId = Number(
		(d.query('SELECT id FROM transactions WHERE user_id = ?').get(userId) as { id: number }).id
	);
	d.query(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`).run(txId, tagId);
	d.query(
		`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, 3000)`
	).run(txId, foodId);
	d.query(
		`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, 2000)`
	).run(txId, rentId);
	d.query(
		`INSERT INTO scheduled (user_id, name, account_id, category_id, amount_cents, start_date, forecast_behavior)
		 VALUES (?, ?, ?, ?, -10000, '2026-01-01', 'bill')`
	).run(userId, `${label} Rent`, accountId, rentId);
	const schedId = Number(
		(d.query('SELECT id FROM scheduled WHERE user_id = ?').get(userId) as { id: number }).id
	);
	d.query(`INSERT INTO scheduled_tags (scheduled_id, tag_id) VALUES (?, ?)`).run(schedId, tagId);
	return { accountId, foodId, rentId, tagId, txId, schedId };
}

function aTagLinks(txId: number): number[] {
	return (
		db()
			.query('SELECT tag_id FROM transaction_tags WHERE transaction_id = ? ORDER BY tag_id')
			.all(txId) as { tag_id: number }[]
	).map((r) => r.tag_id);
}

function aSplitCats(txId: number): number[] {
	return (
		db()
			.query('SELECT category_id FROM transaction_splits WHERE transaction_id = ? ORDER BY category_id')
			.all(txId) as { category_id: number }[]
	).map((r) => r.category_id);
}

function aSchedTags(schedId: number): number[] {
	return (
		db()
			.query('SELECT tag_id FROM scheduled_tags WHERE scheduled_id = ? ORDER BY tag_id')
			.all(schedId) as { tag_id: number }[]
	).map((r) => r.tag_id);
}

describe('cross-user junction mutations', () => {
	test('clearTransactionSplits ignores another user transaction', () => {
		const a = makeUser('Alice', 'alice-scope@example.com');
		const b = makeUser('Bob', 'bob-scope@example.com');
		const alice = seedLedger(a, 'A');
		seedLedger(b, 'B');
		const before = aSplitCats(alice.txId);
		expect(before.length).toBe(2);
		clearTransactionSplits(b, alice.txId);
		expect(aSplitCats(alice.txId)).toEqual(before);
	});

	test('bulkSetCategory split cleanup only touches owned transactions', () => {
		const a = makeUser('Alice', 'alice-bulk@example.com');
		const b = makeUser('Bob', 'bob-bulk@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const before = aSplitCats(alice.txId);
		bulkSetCategory(b, [alice.txId, bob.txId], bob.foodId);
		expect(aSplitCats(alice.txId)).toEqual(before);
		expect(aSplitCats(bob.txId)).toEqual([]);
	});

	test('bulkAddTags does not attach tags to another user transaction', () => {
		const a = makeUser('Alice', 'alice-tags@example.com');
		const b = makeUser('Bob', 'bob-tags@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const before = aTagLinks(alice.txId);
		bulkAddTags(b, [alice.txId], [bob.tagId]);
		expect(aTagLinks(alice.txId)).toEqual(before);
		bulkAddTags(b, [bob.txId], [bob.tagId]);
		expect(aTagLinks(bob.txId)).toContain(bob.tagId);
	});

	test('saveTransaction does not replace tags on a foreign transaction id', () => {
		const a = makeUser('Alice', 'alice-save@example.com');
		const b = makeUser('Bob', 'bob-save@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const before = aTagLinks(alice.txId);
		const input: TransactionInput = {
			id: alice.txId,
			type: 'expense',
			amountCents: 100,
			date: '2026-02-01',
			account: bob.accountId,
			category: bob.foodId,
			merchant: 'Nope',
			notes: null,
			color: null,
			tags: [bob.tagId]
		};
		saveTransaction(b, input);
		expect(aTagLinks(alice.txId)).toEqual(before);
		const aliceTx = db()
			.query('SELECT merchant FROM transactions WHERE id = ?')
			.get(alice.txId) as { merchant: string };
		expect(aliceTx.merchant).toBe('A Cafe');
	});

	test('transactionInputFromForm rejects a foreign transaction id', () => {
		const a = makeUser('Alice', 'alice-form@example.com');
		const b = makeUser('Bob', 'bob-form@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const form = new FormData();
		form.set('id', String(alice.txId));
		form.set('type', 'expense');
		form.set('amount', '10.00');
		form.set('date', '2026-02-01');
		form.set('account_id', String(bob.accountId));
		const parsed = transactionInputFromForm(b, form);
		expect(parsed.error).toBe('Transaction not found.');
		expect(parsed.input).toBeUndefined();
	});

	test('saveScheduled does not replace tags on a foreign schedule id', () => {
		const a = makeUser('Alice', 'alice-sched@example.com');
		const b = makeUser('Bob', 'bob-sched@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const before = aSchedTags(alice.schedId);
		const input: ScheduledInput = {
			id: alice.schedId,
			name: 'Hijack',
			amountCents: -1,
			startDate: '2026-03-01',
			account: bob.accountId,
			category: bob.rentId,
			notes: null,
			color: null,
			repeats: false,
			repeatInterval: null,
			repeatUnit: null,
			untilDate: null,
			forecastBehavior: 'bill',
			tags: [bob.tagId]
		};
		expect(() => saveScheduled(b, input)).toThrow(/not found/i);
		expect(aSchedTags(alice.schedId)).toEqual(before);
		const row = db()
			.query('SELECT name FROM scheduled WHERE id = ?')
			.get(alice.schedId) as { name: string };
		expect(row.name).toBe('A Rent');
	});

	test('scheduledInputFromForm rejects a foreign schedule id', () => {
		const a = makeUser('Alice', 'alice-sform@example.com');
		const b = makeUser('Bob', 'bob-sform@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const form = new FormData();
		form.set('id', String(alice.schedId));
		form.set('name', 'X');
		form.set('amount', '10.00');
		form.set('start_date', '2026-01-01');
		form.set('account_id', String(bob.accountId));
		form.set('edit_scope', 'all');
		const parsed = scheduledInputFromForm(b, form);
		expect(parsed.error).toBe('Scheduled expectation not found.');
	});

	test('write API update cannot retarget another user transaction tags', async () => {
		const a = makeUser('Alice', 'alice-api@example.com');
		const b = makeUser('Bob', 'bob-api@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const { info } = createApiToken(b, 'writer', 'write');
		const before = aTagLinks(alice.txId);
		const result = await executeWrite({
			caller: { userId: b, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'PATCH',
			id: alice.txId,
			body: {
				amount_cents: -100,
				date: '2026-02-01',
				account_id: bob.accountId,
				category_id: bob.foodId,
				tag_ids: [bob.tagId],
				merchant: 'nope'
			}
		});
		expect(result.status).toBe(404);
		expect(aTagLinks(alice.txId)).toEqual(before);
	});
});

describe('FK ownership at the lib layer', () => {
	test('saveTransaction rejects another user account id', () => {
		const a = makeUser('Alice', 'alice-fk@example.com');
		const b = makeUser('Bob', 'bob-fk@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		expect(() =>
			saveTransaction(b, {
				type: 'expense',
				amountCents: 100,
				date: '2026-02-01',
				account: alice.accountId,
				category: bob.foodId,
				merchant: null,
				notes: null,
				color: null,
				tags: []
			})
		).toThrow(/account/i);
	});

	test('saveBudget rejects another user category', () => {
		const a = makeUser('Alice', 'alice-bud@example.com');
		const b = makeUser('Bob', 'bob-bud@example.com');
		const alice = seedLedger(a, 'A');
		seedLedger(b, 'B');
		expect(() => saveBudget(b, null, { categoryId: alice.foodId, period: 'month', limitCents: 1000 })).toThrow(
			/category/i
		);
	});

	test('saveRule rejects another user category', () => {
		const a = makeUser('Alice', 'alice-rule@example.com');
		const b = makeUser('Bob', 'bob-rule@example.com');
		const alice = seedLedger(a, 'A');
		seedLedger(b, 'B');
		expect(() =>
			saveRule(b, null, {
				name: 'x',
				conditions: [{ field: 'merchant', op: 'contains', value: 'cafe' }],
				categoryId: alice.foodId
			})
		).toThrow(/category/i);
	});

	test('saveTransactionSplits rejects another user category', () => {
		const a = makeUser('Alice', 'alice-split@example.com');
		const b = makeUser('Bob', 'bob-split@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		clearTransactionSplits(b, bob.txId);
		expect(() =>
			saveTransactionSplits(b, bob.txId, [
				{ categoryId: alice.foodId, amountCents: 2500 },
				{ categoryId: bob.rentId, amountCents: 2500 }
			])
		).toThrow(/category/i);
	});
});

describe('createGrant account filter', () => {
	test('drops account ids that are not the owner\'s', () => {
		const a = makeUser('Alice', 'alice-grant@example.com');
		const b = makeUser('Bob', 'bob-grant@example.com');
		const alice = seedLedger(a, 'A');
		const bob = seedLedger(b, 'B');
		const created = createGrant(b, {
			label: 'Tax',
			kind: 'viewer',
			dateFrom: '2026-01-01',
			dateTo: '2026-12-31',
			accountIds: [alice.accountId, bob.accountId],
			ttlDays: 7,
			password: 'secret-pass'
		});
		if ('error' in created) throw new Error(created.error);
		expect(created.grant.account_ids).toEqual([bob.accountId]);
		const again = getGrant(b, created.grant.id);
		expect(again?.account_ids).toEqual([bob.accountId]);
	});
});

describe('deleteAllData coverage', () => {
	test('clears webhooks, advisor grants, and sync review for the user', () => {
		const a = makeUser('Alice', 'alice-wipe@example.com');
		const alice = seedLedger(a, 'A');
		db()
			.query(
				`INSERT INTO webhooks (user_id, name, url, secret, secret_hint, events, filters, fields)
				 VALUES (?, 'Hook', 'https://example.com/h', 'sec', 'sec', '[]', '{}', '[]')`
			)
			.run(a);
		const grant = createGrant(a, {
			label: 'Pack',
			kind: 'pack',
			dateFrom: '2026-01-01',
			dateTo: '2026-12-31',
			accountIds: [alice.accountId],
			ttlDays: 7,
			password: 'secret-pass'
		});
		if ('error' in grant) throw new Error(grant.error);
		db()
			.query(
				`INSERT INTO sync_review_items (user_id, orphan_transaction_id, provider, status)
				 VALUES (?, ?, 'mock', 'open')`
			)
			.run(a, alice.txId);

		deleteAllData(a);

		expect(db().query('SELECT COUNT(*) AS c FROM webhooks WHERE user_id = ?').get(a)).toEqual({ c: 0 });
		expect(db().query('SELECT COUNT(*) AS c FROM advisor_grants WHERE user_id = ?').get(a)).toEqual({ c: 0 });
		expect(db().query('SELECT COUNT(*) AS c FROM sync_review_items WHERE user_id = ?').get(a)).toEqual({ c: 0 });
		expect(db().query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(a)).toEqual({ c: 0 });
		// User row remains
		expect(db().query('SELECT id FROM users WHERE id = ?').get(a)).toEqual({ id: a });
	});
});
