import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { closeDbForTests, db, migrate } from '$lib/server/db';
import { createLoginChallenge } from '$lib/server/mfa/mfa';
import { mfaCookieName } from '$lib/server/auth';
import { saveOidcSettings } from '$lib/server/oidc';
import { load, localPasswordEscape } from './+page.server';

const ENV_KEYS = [
	'GALENE_OIDC_ENABLED',
	'GALENE_OIDC_MODE',
	'GALENE_OIDC_ISSUER',
	'GALENE_OIDC_CLIENT_ID',
	'GALENE_OIDC_CLIENT_SECRET',
	'GALENE_OIDC_SCOPES'
] as const;

let dir: string;
const saved: Record<string, string | undefined> = {};

function enableOidc(mode: 'optional' | 'required') {
	const savedOk = saveOidcSettings({
		enabled: true,
		mode,
		issuer: 'https://auth.example/application/o/galene/',
		clientId: 'galene',
		clientSecret: 'super-secret-value',
		scopes: 'openid profile email'
	});
	expect(savedOk.ok).toBe(true);
}

function event(search = '', cookies: Record<string, string> = {}, user: App.Locals['user'] = null) {
	const jar = cookies;
	return {
		locals: { user } as App.Locals,
		cookies: { get: (name: string) => jar[name] },
		url: new URL(`http://localhost/login${search}`)
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-login-load-'));
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	closeDbForTests();
	migrate(db());
});

afterEach(() => {
	closeDbForTests();
	delete process.env.GALENE_DB_PATH;
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

describe('login load OIDC', () => {
	test('truthy local values count as the password escape', () => {
		expect(localPasswordEscape('1')).toBe(true);
		expect(localPasswordEscape(' TRUE ')).toBe(true);
		expect(localPasswordEscape('yes')).toBe(true);
		expect(localPasswordEscape('on')).toBe(true);
		expect(localPasswordEscape('0')).toBe(false);
		expect(localPasswordEscape(null)).toBe(false);
	});

	test('required and enabled redirects to the SSO start path', () => {
		db().query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'ada@example.com', 'x', 1)`).run();
		enableOidc('required');
		try {
			load(event());
			throw new Error('expected redirect');
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			if (!isRedirect(error)) return;
			expect(error.status).toBe(303);
			expect(error.location).toBe('/auth/oidc/start');
		}
	});

	test('required with local=1 stays on the password form', () => {
		db().query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'ada@example.com', 'x', 1)`).run();
		enableOidc('required');
		const page = load(event('?local=1'));
		expect(page.localPassword).toBe(true);
		expect(page.oidc?.mode).toBe('required');
		expect(page.setup).toBe(false);
	});

	test('optional and enabled does not auto-redirect', () => {
		db().query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'ada@example.com', 'x', 1)`).run();
		enableOidc('optional');
		const page = load(event());
		expect(page.oidc?.mode).toBe('optional');
		expect(page.localPassword).toBe(false);
	});

	test('required during first-time setup does not auto-redirect', () => {
		enableOidc('required');
		const page = load(event());
		expect(page.setup).toBe(true);
		expect(page.oidc?.mode).toBe('required');
	});

	test('a pending MFA challenge stays on the login page under required', () => {
		const inserted = db()
			.query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'ada@example.com', 'x', 1)`)
			.run();
		enableOidc('required');
		const token = createLoginChallenge(Number(inserted.lastInsertRowid));
		const page = load(event('', { [mfaCookieName()]: token }));
		expect(page.mfa?.email).toBe('ada@example.com');
	});

	test('an existing session still goes home', () => {
		try {
			load(event('', {}, { id: 1, email: 'ada@example.com', name: 'Ada', isAdmin: true, authMethod: 'password', idpLabel: '' }));
			throw new Error('expected redirect');
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			if (!isRedirect(error)) return;
			expect(error.location).toBe('/');
		}
	});
});
