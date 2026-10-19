import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { closeDbForTests, db, migrate, migrationCount, migrationIndexBefore } from './db';
import { assertAllowed } from './loginThrottle';
import { unlinkUserOidc } from './users';
import {
	callbackErrorCopy,
	claimsFromIdToken,
	decodeJwtPayload,
	completeOidcSignIn,
	getOidcLink,
	loadOidcConfig,
	maskSecret,
	oidcThrottleEmailKey,
	parseUserinfo,
	resolveOidcUser,
	parseDiscovery,
	parseTokenResponse,
	pkceChallengeFor,
	providerLabel,
	saveOidcSettings,
	testOidcConnection
} from './oidc';

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

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-oidc-'));
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	for (const key of ENV_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
	closeDbForTests();
	migrate(db());
	db().query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Ada', 'Ada@Example.com', 'x', 1)`).run();
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

function b64url(value: object): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('OIDC discovery and settings', () => {
	test('mode defaults to optional and the secret stays masked', () => {
		const savedOk = saveOidcSettings({
			enabled: true,
			mode: 'optional',
			issuer: 'https://auth.example/application/o/galene/',
			clientId: 'galene',
			clientSecret: 'super-secret-value',
			scopes: 'openid profile email'
		});
		expect(savedOk.ok).toBe(true);
		const config = loadOidcConfig();
		expect(config.mode).toBe('optional');
		expect(config.enabled).toBe(true);
		expect(config.issuer).toBe('https://auth.example/application/o/galene');
		expect(maskSecret(config.clientSecret)).toBe('••••••••alue');
		expect(providerLabel(config.issuer)).toBe('SSO');
		expect(providerLabel('https://auth.example/application/o/authentik/')).toBe('Authentik');
	});

	test('environment overrides the saved issuer and mode', () => {
		saveOidcSettings({
			enabled: false,
			mode: 'optional',
			issuer: 'https://auth.example/application/o/galene',
			clientId: 'from-db',
			clientSecret: 'db-secret',
			scopes: 'openid email'
		});
		process.env.GALENE_OIDC_ENABLED = '1';
		process.env.GALENE_OIDC_MODE = 'required';
		process.env.GALENE_OIDC_ISSUER = 'https://auth.example/env';
		const config = loadOidcConfig();
		expect(config.enabled).toBe(true);
		expect(config.mode).toBe('required');
		expect(config.issuer).toBe('https://auth.example/env');
		expect(config.clientId).toBe('from-db');
	});

	test('parses a discovery document and rejects an issuer mismatch', () => {
		const doc = {
			issuer: 'https://auth.example/application/o/galene',
			authorization_endpoint: 'https://auth.example/application/o/authorize/',
			token_endpoint: 'https://auth.example/application/o/token/',
			userinfo_endpoint: 'https://auth.example/application/o/userinfo/',
			jwks_uri: 'https://auth.example/application/o/galene/jwks/'
		};
		const parsed = parseDiscovery(doc, 'https://auth.example/application/o/galene/');
		expect('error' in parsed).toBe(false);
		if ('error' in parsed) return;
		expect(parsed.userinfoEndpoint).toContain('userinfo');
		const mismatch = parseDiscovery(doc, 'https://other.example');
		expect(mismatch).toEqual({ error: 'Discovery issuer does not match the configured Issuer URL.' });
	});

	test('test connection accepts discovery plus an unsupported client-credentials grant', async () => {
		saveOidcSettings({
			enabled: true,
			mode: 'optional',
			issuer: 'https://auth.example/application/o/galene',
			clientId: 'galene',
			clientSecret: 'secret',
			scopes: 'openid profile email'
		});
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith('/.well-known/openid-configuration')) {
				return new Response(
					JSON.stringify({
						issuer: 'https://auth.example/application/o/galene',
						authorization_endpoint: 'https://auth.example/application/o/authorize/',
						token_endpoint: 'https://auth.example/application/o/token/'
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				);
			}
			expect(init?.method).toBe('POST');
			return new Response(JSON.stringify({ error: 'unsupported_grant_type' }), { status: 400 });
		}) as typeof fetch;
		const result = await testOidcConnection(fetchImpl);
		expect(result).toEqual({ ok: true, issuer: 'https://auth.example/application/o/galene' });
	});
});

describe('OIDC email mapping and callback errors', () => {
	test('calm copy covers every callback error and drops the nonexistent settings', () => {
		expect(callbackErrorCopy('access_denied', 'Authentik').title).toBe('Access denied');
		for (const code of ['email_mismatch', 'not_provisioned'] as const) {
			const copy = callbackErrorCopy(code, 'Authentik');
			expect(copy.title).toBe('No Galene account for this email');
			expect(copy.body).toContain('admin to create a user with exactly the email');
			expect(copy.body).not.toMatch(/automatic account creation|household admin|invite/i);
		}
		expect(callbackErrorCopy('email_unverified', 'SSO').title).toBe('Email not verified');
		expect(callbackErrorCopy('sub_mismatch', 'SSO').body).toContain('Settings → Users');
	});

	test('reads email and nonce from an identity token payload', () => {
		const token = `hdr.${b64url({
			email: 'Ada@Example.com',
			email_verified: true,
			nonce: 'abc',
			iss: 'https://auth.example/application/o/galene',
			aud: 'galene',
			exp: Math.floor(Date.now() / 1000) + 60
		})}.sig`;
		const claims = claimsFromIdToken(token);
		expect('error' in claims).toBe(false);
		if ('error' in claims) return;
		expect(claims.email).toBe('ada@example.com');
		expect(claims.nonce).toBe('abc');
		expect(claims.sub).toBeNull();
		const withSub = claimsFromIdToken(`hdr.${b64url({ sub: 'abc-123', email: 'a@example.com' })}.sig`);
		expect('error' in withSub ? null : withSub.sub).toBe('abc-123');
		expect(parseUserinfo({ sub: 's1', email: 'A@example.com', email_verified: 'true' })).toEqual({
			sub: 's1',
			email: 'a@example.com',
			emailVerified: true
		});
		expect(decodeJwtPayload('not-a-jwt')).toBeNull();
	});

	test('token error responses stay generic', () => {
		expect(parseTokenResponse({ error: 'invalid_grant' })).toEqual({ error: 'The sign-in code was rejected.' });
		expect(parseTokenResponse({ id_token: 'a.b.c' })).toEqual({ idToken: 'a.b.c', accessToken: null });
	});

	test('PKCE challenge is the S256 digest of the verifier', () => {
		const verifier = 'verifier-value';
		const expected = createHash('sha256').update(verifier).digest().toString('base64url');
		expect(pkceChallengeFor(verifier)).toBe(expected);
	});
});

const ISS = 'https://idp.example.com/application/o/galene';
const userCount = () => (db().query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

describe('OIDC identity pinning (ADO-55)', () => {
	test('first link with a verified email pins issuer+sub and never inserts a user', () => {
		const before = userCount();
		expect(resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: true,
			userId: 1,
			linked: true
		});
		const row = db().query('SELECT user_id, issuer, sub FROM oidc_identities').all();
		expect(row).toEqual([{ user_id: 1, issuer: ISS, sub: 'sub-1' }]);
		expect(getOidcLink(1)?.issuer).toBe(ISS);
		expect(userCount()).toBe(before);
	});

	test('a pinned sub still signs in after the provider email changes', () => {
		resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		expect(resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada.new@example.com', emailVerified: null })).toEqual({
			ok: true,
			userId: 1,
			linked: false
		});
	});

	test('a different sub for an already linked email is rejected, not relinked', () => {
		resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		expect(resolveOidcUser({ issuer: ISS, sub: 'sub-2', email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: false,
			error: 'sub_mismatch'
		});
		const other = 'https://other.example.com';
		expect(resolveOidcUser({ issuer: other, sub: 'sub-1', email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: false,
			error: 'sub_mismatch'
		});
		expect(db().query('SELECT sub FROM oidc_identities WHERE user_id = 1').get()).toEqual({ sub: 'sub-1' });
	});

	test('(issuer, sub) is unique', () => {
		db().query(`INSERT INTO users (name, email, password_hash) VALUES ('Bea', 'bea@example.com', 'x')`).run();
		resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		expect(() =>
			db().query(`INSERT INTO oidc_identities (user_id, issuer, sub) VALUES (2, ?, 'sub-1')`).run(ISS)
		).toThrow();
	});

	test('missing or false email_verified is rejected for an unlinked identity', () => {
		for (const emailVerified of [null, false]) {
			expect(resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified })).toEqual({
				ok: false,
				error: 'email_unverified'
			});
		}
		expect(db().query('SELECT COUNT(*) AS n FROM oidc_identities').get()).toEqual({ n: 0 });
	});

	test('missing sub is invalid', () => {
		expect(resolveOidcUser({ issuer: ISS, sub: null, email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: false,
			error: 'invalid'
		});
	});

	test('no matching user is rejected with the new copy', () => {
		const result = resolveOidcUser({ issuer: ISS, sub: 'x', email: 'missing@example.com', emailVerified: true });
		expect(result).toEqual({ ok: false, error: 'email_mismatch' });
		if (!result.ok) expect(callbackErrorCopy(result.error, 'SSO').body).toContain('create a user with exactly the email');
	});

	test('per-email throttle locks repeated rejections across IPs without touching the password bucket', () => {
		for (let i = 0; i < 5; i++) {
			const r = completeOidcSignIn({ ip: `198.51.100.${i}`, issuer: ISS, sub: 'x', email: 'missing@example.com', emailVerified: true });
			expect(r.ok).toBe(false);
		}
		const locked = completeOidcSignIn({ ip: '198.51.100.99', issuer: ISS, sub: 'x', email: 'missing@example.com', emailVerified: true });
		expect(locked.ok).toBe(false);
		if (!locked.ok) expect(locked.throttled).toMatch(/Too many attempts/);
		expect(() => assertAllowed('198.51.100.99', oidcThrottleEmailKey('missing@example.com'))).toThrow();
		// The password-login email bucket for the same address is untouched.
		expect(() => assertAllowed('203.0.113.1', 'missing@example.com')).not.toThrow();
	});

	test('success clears the per-email bucket', () => {
		for (let i = 0; i < 3; i++) {
			completeOidcSignIn({ ip: '198.51.100.1', issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: false });
		}
		const ok = completeOidcSignIn({ ip: '198.51.100.1', issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		expect(ok.ok).toBe(true);
		expect(db().query(`SELECT COUNT(*) AS n FROM auth_throttle`).get()).toEqual({ n: 0 });
	});

	test('admin unlink then a new sub re-pins by verified email', () => {
		resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		expect(unlinkUserOidc(1)).toEqual({ ok: true });
		expect(getOidcLink(1)).toBeNull();
		expect(unlinkUserOidc(1).ok).toBe(false);
		expect(resolveOidcUser({ issuer: ISS, sub: 'sub-2', email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: true,
			userId: 1,
			linked: true
		});
		expect(resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true })).toEqual({
			ok: false,
			error: 'sub_mismatch'
		});
	});

	test('admin unlink is blocked in demo mode', () => {
		resolveOidcUser({ issuer: ISS, sub: 'sub-1', email: 'ada@example.com', emailVerified: true });
		const prev = process.env.GALENE_DEMO;
		process.env.GALENE_DEMO = '1';
		try {
			expect(unlinkUserOidc(1).ok).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.GALENE_DEMO;
			else process.env.GALENE_DEMO = prev;
		}
		expect(getOidcLink(1)).not.toBeNull();
	});

	test('upgrading an existing database keeps users and pins on first verified sign-in', () => {
		// Rewind to the schema before ADO-55 with an existing user.
		db().exec('DROP TABLE oidc_identities');
		db().run(`PRAGMA user_version = ${migrationIndexBefore('oidc_identities')}`);
		closeDbForTests();
		const before = userCount();
		expect(db().query(`SELECT name FROM sqlite_master WHERE name = 'oidc_identities'`).get()).toEqual({
			name: 'oidc_identities'
		});
		expect((db().query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrationCount());
		expect(userCount()).toBe(before);
		expect(resolveOidcUser({ issuer: ISS, sub: 'legacy', email: 'ADA@example.com', emailVerified: true })).toEqual({
			ok: true,
			userId: 1,
			linked: true
		});
	});
});
