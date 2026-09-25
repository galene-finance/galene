import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db, migrate } from '../../../../lib/server/db';
import { createGrant, revokeGrant } from '../../../../lib/server/advisor';
import { savePack } from '../../../../lib/server/pack';
import { GET, POST, _wantsPackForm } from './+server';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-pack-form-'));
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	closeDbForTests();
	const database = db();
	migrate(database);
	database
		.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner', 'owner@example.com', 'x')`)
		.run();
	database.query(`INSERT INTO accounts (user_id, name, type) VALUES (1, 'Checking', 'bank')`).run();
});

afterEach(() => {
	closeDbForTests();
	delete process.env.GALENE_DB_PATH;
	rmSync(dir, { recursive: true, force: true });
});

function packGrant() {
	const created = createGrant(1, {
		label: '2025 pack',
		kind: 'pack',
		dateFrom: '2025-01-01',
		dateTo: '2025-12-31',
		accountIds: [1],
		ttlDays: 14,
		password: 'pack-secret'
	});
	if ('error' in created) throw new Error(created.error);
	savePack(
		{
			userId: 1,
			grantId: created.grant.id,
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [1]
		},
		Buffer.from('PK\x03\x04pack-bytes')
	);
	return created;
}

describe('pack browser form vs zip client', () => {
	test('Accept html without a password is a form; a password query is a zip client', () => {
		expect(_wantsPackForm(new Request('http://localhost/advisor/pack/t', { headers: { accept: 'text/html' } }), null)).toBe(
			true
		);
		expect(
			_wantsPackForm(
				new Request('http://localhost/advisor/pack/t?password=x', { headers: { accept: 'text/html,application/xhtml+xml' } }),
				'x'
			)
		).toBe(false);
		expect(_wantsPackForm(new Request('http://localhost/advisor/pack/t', { headers: { accept: '*/*' } }), null)).toBe(false);
	});

	test('a browser GET shows the password form, not an expired or unknown-link error', async () => {
		const created = packGrant();
		const response = await GET({
			params: { token: created.token },
			url: new URL(`http://localhost/advisor/pack/${created.token}`),
			request: new Request(`http://localhost/advisor/pack/${created.token}`, {
				headers: { accept: 'text/html,application/xhtml+xml' }
			})
		} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('type="password"');
		expect(html).toContain('Download');
		expect(html).not.toContain('Unknown link or wrong password');
		expect(html).not.toContain('expired');
	});

	test('a wrong password stays on the form; the right password returns the zip', async () => {
		const created = packGrant();
		const wrong = await POST({
			params: { token: created.token },
			request: new Request(`http://localhost/advisor/pack/${created.token}`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
				body: 'password=nope'
			})
		} as Parameters<typeof POST>[0]);
		expect(wrong.status).toBe(401);
		const html = await wrong.text();
		expect(html).toContain('type="password"');
		expect(html).toContain('That password is not valid.');
		expect(html).not.toContain('expired');

		const right = await POST({
			params: { token: created.token },
			request: new Request(`http://localhost/advisor/pack/${created.token}`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
				body: 'password=pack-secret'
			})
		} as Parameters<typeof POST>[0]);
		expect(right.status).toBe(200);
		expect(right.headers.get('content-type')).toBe('application/zip');
		const bytes = Buffer.from(await right.arrayBuffer());
		expect(bytes.includes(Buffer.from('pack-bytes'))).toBe(true);
	});

	test('?password= still returns the zip for clients that also accept html', async () => {
		const created = packGrant();
		const response = await GET({
			params: { token: created.token },
			url: new URL(`http://localhost/advisor/pack/${created.token}?password=pack-secret`),
			request: new Request(`http://localhost/advisor/pack/${created.token}?password=pack-secret`, {
				headers: { accept: 'text/html,application/xhtml+xml' }
			})
		} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/zip');
	});

	test('a missing password without Accept html stays JSON 401', async () => {
		const created = packGrant();
		const response = await GET({
			params: { token: created.token },
			url: new URL(`http://localhost/advisor/pack/${created.token}`),
			request: new Request(`http://localhost/advisor/pack/${created.token}`)
		} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: 'Unknown link or wrong password.' });
	});

	test('an unknown or revoked link tells the browser it expired', async () => {
		const unknown = await GET({
			params: { token: 'not-a-token' },
			url: new URL('http://localhost/advisor/pack/not-a-token'),
			request: new Request('http://localhost/advisor/pack/not-a-token', { headers: { accept: 'text/html' } })
		} as Parameters<typeof GET>[0]);
		expect(unknown.status).toBe(410);
		expect(await unknown.text()).toContain('expired or was revoked');

		const created = packGrant();
		revokeGrant(1, created.grant.id);
		const revoked = await GET({
			params: { token: created.token },
			url: new URL(`http://localhost/advisor/pack/${created.token}`),
			request: new Request(`http://localhost/advisor/pack/${created.token}`, { headers: { accept: 'text/html' } })
		} as Parameters<typeof GET>[0]);
		expect(revoked.status).toBe(410);
		expect(await revoked.text()).toContain('expired or was revoked');
	});
});
