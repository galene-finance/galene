import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { closeDbForTests, db, migrate } from './db';
import {
	callbackErrorCopy,
	claimsFromIdToken,
	decodeJwtPayload,
	loadOidcConfig,
	mapEmailToUser,
	maskSecret,
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
	test('matches an existing user case-insensitively and does not insert', () => {
		const before = (db().query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
		expect(mapEmailToUser('ada@example.com', true)).toEqual({ ok: true, userId: 1 });
		expect(mapEmailToUser('missing@example.com', null)).toEqual({ ok: false, error: 'email_mismatch' });
		expect(mapEmailToUser('ada@example.com', false)).toEqual({ ok: false, error: 'not_provisioned' });
		const after = (db().query('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
		expect(after).toBe(before);
	});

	test('calm copy covers the three callback errors', () => {
		expect(callbackErrorCopy('access_denied', 'Authentik').title).toBe('Access denied');
		expect(callbackErrorCopy('email_mismatch', 'Authentik').title).toBe('Email doesn’t match an existing account');
		expect(callbackErrorCopy('not_provisioned', 'SSO').title).toBe('Not provisioned');
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
