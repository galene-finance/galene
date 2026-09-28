import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { closeDbForTests, db, migrate } from '$lib/server/db';
import { rememberOidcState, saveOidcSettings } from '$lib/server/oidc';
import { load } from './+page.server';

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
const realFetch = globalThis.fetch;

function b64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-oidc-cb-'));
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	closeDbForTests();
	migrate(db());
	db().query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'ada@example.com', 'x', 1)`).run();
	const savedOk = saveOidcSettings({
		enabled: true,
		mode: 'optional',
		issuer: 'https://auth.example/application/o/galene',
		clientId: 'galene',
		clientSecret: 'super-secret-value',
		scopes: 'openid profile email'
	});
	expect(savedOk.ok).toBe(true);
});

afterEach(() => {
	globalThis.fetch = realFetch;
	closeDbForTests();
	delete process.env.GALENE_DB_PATH;
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

describe('OIDC callback success', () => {
	test('a completed sign-in redirects home', async () => {
		const pending = rememberOidcState();
		const idToken = `hdr.${b64url({
			email: 'ada@example.com',
			email_verified: true,
			nonce: pending.nonce,
			iss: 'https://auth.example/application/o/galene',
			aud: 'galene',
			exp: Math.floor(Date.now() / 1000) + 120
		})}.sig`;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('openid-configuration')) {
				return new Response(
					JSON.stringify({
						issuer: 'https://auth.example/application/o/galene',
						authorization_endpoint: 'https://auth.example/application/o/authorize',
						token_endpoint: 'https://auth.example/application/o/token',
						userinfo_endpoint: 'https://auth.example/application/o/userinfo'
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			return new Response(JSON.stringify({ id_token: idToken, access_token: 'access' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof fetch;

		const setCookies: string[] = [];
		try {
			await load({
				url: new URL(`http://localhost/auth/oidc/callback?code=abc&state=${pending.state}`),
				locals: { user: null, viewer: null },
				cookies: {
					get: () => undefined,
					set: (name: string) => setCookies.push(name)
				},
				getClientAddress: () => '127.0.0.1'
			});
			throw new Error('expected redirect');
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			if (!isRedirect(error)) return;
			expect(error.status).toBe(303);
			expect(error.location).toBe('/');
		}
		expect(setCookies).toContain('galene_session');
	});

	test('welcome=1 is an error page, not an interstitial', async () => {
		const view = await load({
			url: new URL('http://localhost/auth/oidc/callback?welcome=1'),
			locals: { user: null, viewer: null },
			cookies: { get: () => undefined, set: () => {} },
			getClientAddress: () => '127.0.0.1'
		});
		expect(view.phase).toBe('error');
		expect(view.title).not.toBe('Welcome back');
	});
});
