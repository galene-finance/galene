/**
 * Demo mode on Settings → Accounts: the page load reports demo, and
 * delete-account-with-transactions is a real 403 that changes nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from '$lib/server/db';
import { createUser } from '$lib/server/users';
import { actions, load } from './+page.server';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir = '';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-accounts-demo-'));
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

function owner(): App.Locals['user'] {
	const created = createUser({
		name: 'Owner',
		email: 'owner@example.com',
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return { id: created.userId, name: 'Owner', email: 'owner@example.com', is_admin: 1, role: 'owner' };
}

function seedAccount(userId: number): number {
	db().query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Checking', 'bank')`).run(userId);
	const accountId = (db().query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id;
	db()
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant)
			 VALUES (?, ?, '2026-09-01', -100, 'Cafe')`
		)
		.run(userId, accountId);
	return accountId;
}

describe('accounts demo mode', () => {
	test('load returns demo true when GALENE_DEMO is set', () => {
		const user = owner();
		process.env.GALENE_DEMO = '1';
		const page = load({ locals: { user, viewer: null, apiToken: null } } as Parameters<typeof load>[0]);
		expect(page.demo).toBe(true);
	});

	test('load returns demo false outside demo mode', () => {
		const user = owner();
		const page = load({ locals: { user, viewer: null, apiToken: null } } as Parameters<typeof load>[0]);
		expect(page.demo).toBe(false);
	});

	test('delete-account-with-transactions returns 403 and keeps the rows', async () => {
		const user = owner();
		const accountId = seedAccount(user.id);
		process.env.GALENE_DEMO = '1';
		const body = new FormData();
		body.set('id', String(accountId));
		const request = new Request('http://localhost/settings/accounts?/delete-account-with-transactions', {
			method: 'POST',
			body
		});
		const result = await actions['delete-account-with-transactions']({
			request,
			locals: { user, viewer: null, apiToken: null }
		} as Parameters<(typeof actions)['delete-account-with-transactions']>[0]);
		expect('status' in result && result.status).toBe(403);
		const data = (result as { data: { error: string } }).data;
		expect(data.error).toContain('public demo');
		expect((db().query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
		expect((db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(1);
	});
});
