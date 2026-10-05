import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiToken, resolveApiToken } from './apiTokens';
import { closeDbForTests, db, migrate } from './db';
import { saveAccount, saveCategory } from './finance';
import { createUser } from './users';
import {
	createWebhook,
	executeWrite,
	httpsWebhookUrl,
	isWriteApiEnabled,
	listWebhooks,
	projectPayload,
	rotateWebhookSecret,
	saveWriteApiSettings,
	setWebhookTransportForTests,
	signWebhookBody,
	type WebhookEvent
} from './writeApi';

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-write-api-'));
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
		delete process.env[key];
	}
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	process.env.GALENE_DATA_DIR = dir;
	process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
	closeDbForTests();
	migrate(db());
	setWebhookTransportForTests(null);
});

afterEach(() => {
	setWebhookTransportForTests(null);
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const v = saved[key];
		if (v === undefined) delete process.env[key];
		else process.env[key] = v;
		delete saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

function userId(): number {
	const created = createUser({
		name: 'Writer',
		email: 'writer@example.com',
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function accountId(id: number): number {
	saveAccount(id, null, { name: 'Checking', type: 'bank', color: null });
	return (db().query('SELECT id FROM accounts WHERE user_id = ?').get(id) as { id: number }).id;
}

describe('write API gate', () => {
	test('write API is off by default', async () => {
		expect(isWriteApiEnabled()).toBe(false);
		const id = userId();
		const { info } = createApiToken(id, 'writer', 'write');
		const result = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: {}
		});
		expect(result.status).toBe(403);
		expect(String((result.body as { error: string }).error)).toContain('off');
	});

	test('read token is rejected for writes', async () => {
		const id = userId();
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const { info, token } = createApiToken(id, 'reader', 'read');
		const resolved = resolveApiToken(token);
		expect(resolved?.scope).toBe('read');
		const result = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'read' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: {}
		});
		expect(result.status).toBe(403);
		expect(String((result.body as { error: string }).error)).toContain('cannot write');
	});

	test('write token is allowed only when the toggle is on', async () => {
		const id = userId();
		const acct = accountId(id);
		const { info, token } = createApiToken(id, 'writer', 'write');
		expect(resolveApiToken(token)?.scope).toBe('write');
		const blocked = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: { date: '2026-10-04', amount_cents: -500, account_id: acct, merchant: 'Cafe' }
		});
		expect(blocked.status).toBe(403);

		expect(saveWriteApiSettings(true).ok).toBe(true);
		const result = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: { date: '2026-10-04', amount_cents: -500, account_id: acct, merchant: 'Cafe' }
		});
		expect(result.status).toBe(200);
		const audit = db().query('SELECT action, resource, token_id, detail FROM api_audit WHERE user_id = ?').all(id) as {
			action: string;
			resource: string;
			token_id: number;
			detail: string;
		}[];
		expect(audit).toHaveLength(1);
		expect(audit[0]!.action).toBe('create');
		expect(audit[0]!.resource).toBe('transaction');
		expect(audit[0]!.token_id).toBe(info.id);
		expect(audit[0]!.detail).toContain('Cafe');
	});

	test('demo mode rejects writes even when the toggle was on', async () => {
		const id = userId();
		const acct = accountId(id);
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const { info } = createApiToken(id, 'writer', 'write');
		process.env.GALENE_DEMO = '1';
		const result = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: { date: '2026-10-04', amount_cents: -500, account_id: acct, merchant: 'Cafe' }
		});
		expect(result.status).toBe(403);
		expect(String((result.body as { error: string }).error)).toContain('demo');
		expect(isWriteApiEnabled()).toBe(false);
	});
});

describe('webhooks', () => {
	test('rejects non-HTTPS URLs and has no unsigned option', () => {
		expect(() => httpsWebhookUrl('http://example.com/hook')).toThrow(/HTTPS/);
		expect(() => httpsWebhookUrl('https://user:pw@example.com/hook')).toThrow(/credentials/);
		const id = userId();
		const created = createWebhook(id, {
			name: 'bad',
			url: 'http://example.com/hook',
			events: ['transaction.created'],
			filters: {},
			fields: ['id']
		});
		expect(created.ok).toBe(false);
	});

	test('payload omits unselected fields and the request is HMAC signed', async () => {
		const id = userId();
		const acct = accountId(id);
		saveCategory(id, null, { name: 'Food', type: 'expense', parent_id: null, color: null });
		const created = createWebhook(id, {
			name: 'books',
			url: 'https://example.com/hook',
			events: ['transaction.created'],
			filters: {},
			fields: ['id', 'merchant']
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const listed = listWebhooks(id);
		expect(listed).toHaveLength(1);
		expect(listed[0]).not.toHaveProperty('secret');
		expect(listed[0]!.secret_hint).toBe(created.secret.slice(-4));

		const full: WebhookEvent = {
			event: 'transaction.created',
			resource: 'transaction',
			action: 'created',
			id: 9,
			merchant: 'Cafe',
			amount_cents: -500,
			account_id: acct
		};
		const projected = projectPayload(full, ['id', 'merchant']);
		expect(projected).toEqual({ id: 9, merchant: 'Cafe' });
		expect('amount_cents' in projected).toBe(false);

		const calls: { body: string; signature: string }[] = [];
		setWebhookTransportForTests(async (_url, init) => {
			const headers = init.headers as Record<string, string>;
			calls.push({ body: String(init.body), signature: headers['x-galene-signature'] });
			return new Response('ok');
		});
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const { info } = createApiToken(id, 'writer', 'write');
		const result = await executeWrite({
			caller: { userId: id, token: { id: info.id, scope: 'write' } },
			resource: 'transaction',
			method: 'POST',
			id: null,
			body: { date: '2026-10-04', amount_cents: -500, account_id: acct, merchant: 'Cafe' }
		});
		expect(result.status).toBe(200);
		expect(calls).toHaveLength(1);
		const payload = JSON.parse(calls[0]!.body) as Record<string, unknown>;
		expect(payload.merchant).toBe('Cafe');
		expect(payload).not.toHaveProperty('amount_cents');
		expect(payload).not.toHaveProperty('account_id');
		expect(calls[0]!.signature).toBe(signWebhookBody(created.secret, calls[0]!.body));
		expect(calls[0]!.signature.startsWith('sha256=')).toBe(true);

		const rotated = rotateWebhookSecret(id, created.webhook.id);
		expect(rotated.ok).toBe(true);
		if (!rotated.ok) return;
		expect(rotated.secret).not.toBe(created.secret);
		expect(listWebhooks(id)[0]).not.toHaveProperty('secret');
	});
});
