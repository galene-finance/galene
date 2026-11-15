/**
 * Encryption at rest for reversible secrets (ADO-60).
 * Fake values only — nothing here is a live provider credential.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db } from './db';
import { setSetting, getSetting } from './finance';
import { confirmTotpEnroll } from './mfa/mfa';
import { totpNow } from './mfa/totp';
import { ensureDemoBootstrap } from './demoMode';
import { canPublicSignup, createUser } from './users';
import { saveOidcSettings, loadOidcConfig, oidcSettingsView } from './oidc';
import { createWebhook, listWebhooks } from './writeApi';
import { ensureInstanceKey } from './themeGallery';
import { redactSecretText } from './providers/http';
import { plaidItemFailureLogLine } from './plaidItemStatus';
import { plaidConfigForClient } from './providers/plaid';
import {
	SecretKeyError,
	isSecretEnvelope,
	keyIdFor,
	loadSecretKeys,
	openConnectionCredentials,
	openSecret,
	plaintextSecretLocations,
	resetSecretWarningForTests,
	rotateStoredSecrets,
	sealConnectionCredentials,
	sealSecret
} from './secrets';

const ENV_KEYS = [
	'GALENE_SECRET_KEY',
	'GALENE_SECRET_KEY_PREVIOUS',
	'GALENE_DEMO',
	'GALENE_DB_PATH',
	'GALENE_DATA_DIR',
	'GALENE_ALLOW_EPHEMERAL_DATA',
	'GALENE_OIDC_CLIENT_SECRET',
	'GALENE_OIDC_ENABLED'
] as const;

const saved: Record<string, string | undefined> = {};
let dir = '';
const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');
const TOKEN = 'access-sandbox-stored-value';
const CLIENT_SECRET = 'client-secret-VALUE';

function rememberEnv() {
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
	}
}

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
	rememberEnv();
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

function freshDb() {
	closeDbForTests();
	dir = mkdtempSync(join(tmpdir(), 'galene-secrets-'));
	setEnv('GALENE_DB_PATH', join(dir, 'galene.db'));
	setEnv('GALENE_DATA_DIR', dir);
	setEnv('GALENE_ALLOW_EPHEMERAL_DATA', '1');
	setEnv('GALENE_DEMO', undefined);
	setEnv('GALENE_OIDC_CLIENT_SECRET', undefined);
	setEnv('GALENE_OIDC_ENABLED', undefined);
	resetSecretWarningForTests();
}

beforeEach(() => {
	freshDb();
	setEnv('GALENE_SECRET_KEY', KEY_A);
	setEnv('GALENE_SECRET_KEY_PREVIOUS', undefined);
});

afterEach(() => {
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
		delete saved[key];
	}
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = '';
});

function userId(): number {
	const created = createUser({
		name: 'Ada',
		email: 'ada@example.com',
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

describe('secret envelope', () => {
	test('round-trips and never double-encrypts', () => {
		const sealed = sealSecret(CLIENT_SECRET);
		expect(sealed.startsWith('enc:v1:')).toBe(true);
		expect(isSecretEnvelope(sealed)).toBe(true);
		expect(sealed).not.toContain(CLIENT_SECRET);
		const parts = sealed.split(':');
		expect(parts[0]).toBe('enc');
		expect(parts[1]).toBe('v1');
		expect(parts[2]).toBe(keyIdFor(Buffer.from(KEY_A, 'base64')));
		expect(parts).toHaveLength(5);
		expect(openSecret(sealed)).toBe(CLIENT_SECRET);
		expect(sealSecret(sealed)).toBe(sealed);
		expect(openSecret('{"access_token":"legacy"}')).toBe('{"access_token":"legacy"}');
		expect(sealSecret('')).toBe('');
	});

	test('a wrong key fails without echoing the secret', () => {
		const sealed = sealConnectionCredentials({ access_tokens: JSON.stringify([TOKEN]) });
		setEnv('GALENE_SECRET_KEY', KEY_B);
		let message = '';
		try {
			openSecret(sealed);
		} catch (error) {
			expect(error).toBeInstanceOf(SecretKeyError);
			message = error instanceof Error ? error.message : '';
		}
		expect(message).toMatch(/GALENE_SECRET_KEY/);
		expect(message).not.toContain(TOKEN);
		expect(message).not.toContain(sealed);
	});

	test('the previous key can read a row until it is re-encrypted', () => {
		const sealed = sealSecret(CLIENT_SECRET);
		setEnv('GALENE_SECRET_KEY', KEY_B);
		setEnv('GALENE_SECRET_KEY_PREVIOUS', KEY_A);
		expect(openSecret(sealed)).toBe(CLIENT_SECRET);
		expect(loadSecretKeys().current?.id).not.toBe(loadSecretKeys().previous?.id);
	});

	test('redaction strips envelopes and access tokens from log text', () => {
		const sealed = sealSecret(CLIENT_SECRET);
		expect(redactSecretText(`failed ${sealed} ${TOKEN}`)).not.toContain('enc:v1:');
		expect(redactSecretText(`failed ${sealed} ${TOKEN}`)).not.toContain(TOKEN);
		const line = plaidItemFailureLogLine({
			itemId: 'item-1',
			institutionName: sealed,
			code: 'ITEM_LOGIN_REQUIRED',
			errorType: 'ITEM_ERROR'
		});
		expect(line).not.toContain('enc:v1:');
		expect(line).not.toContain(CLIENT_SECRET);
	});
});

describe('startup and restore', () => {
	test('warns and starts when no key and no encrypted rows', () => {
		setEnv('GALENE_SECRET_KEY', undefined);
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...args: unknown[]) => {
			warnings.push(args.map(String).join(' '));
		};
		try {
			resetSecretWarningForTests();
			db();
			expect(warnings.some((line) => line.includes('GALENE_SECRET_KEY is not set'))).toBe(true);
			expect(warnings.some((line) => line.includes('demo mode'))).toBe(true);
		} finally {
			console.warn = original;
		}
	});

	test('a malformed key fails startup and does not echo the value', () => {
		setEnv('GALENE_SECRET_KEY', 'not-a-key');
		expect(() => db()).toThrow(/32 bytes, base64-encoded/);
		try {
			db();
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			expect(message).not.toContain('not-a-key');
		}
	});

	test('encrypted rows without the key fail startup; with the key they restore', () => {
		const id = userId();
		db()
			.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
			.run(id, sealConnectionCredentials({ access_tokens: JSON.stringify([TOKEN]) }));
		setSetting(id, 'plaid_client_secret', CLIENT_SECRET);
		db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
		const src = process.env.GALENE_DB_PATH!;
		const copy = join(dir, 'restored.db');
		closeDbForTests();
		copyFileSync(src, copy);

		setEnv('GALENE_DB_PATH', copy);
		setEnv('GALENE_SECRET_KEY', undefined);
		let missing = '';
		try {
			db();
		} catch (error) {
			missing = error instanceof Error ? error.message : '';
		}
		expect(missing).toMatch(/GALENE_SECRET_KEY is not set/);
		expect(missing).toMatch(/backup/i);
		expect(missing).not.toContain(TOKEN);
		expect(missing).not.toContain(CLIENT_SECRET);

		setEnv('GALENE_SECRET_KEY', KEY_B);
		closeDbForTests();
		let wrong = '';
		try {
			db();
		} catch (error) {
			wrong = error instanceof Error ? error.message : '';
		}
		expect(wrong).toMatch(/cannot decrypt/);
		expect(wrong).not.toContain(TOKEN);

		setEnv('GALENE_SECRET_KEY', KEY_A);
		closeDbForTests();
		const row = db().query('SELECT credentials FROM connections').get() as { credentials: string };
		expect(row.credentials.startsWith('enc:v1:')).toBe(true);
		expect(JSON.parse(openConnectionCredentials(row.credentials).access_tokens!)).toEqual([TOKEN]);
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);
		expect(plaintextSecretLocations(db())).toEqual([]);
	});

	test('a key added later encrypts plaintext rows on the next open', () => {
		setEnv('GALENE_SECRET_KEY', undefined);
		const id = userId();
		db()
			.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
			.run(id, JSON.stringify({ access_tokens: JSON.stringify([TOKEN]) }));
		setSetting(id, 'plaid_client_secret', CLIENT_SECRET);
		expect(plaintextSecretLocations(db()).length).toBeGreaterThan(0);
		closeDbForTests();
		setEnv('GALENE_SECRET_KEY', KEY_A);
		db();
		expect(plaintextSecretLocations(db())).toEqual([]);
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);
		const raw = (db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials;
		expect(raw).not.toContain(TOKEN);
		expect(JSON.parse(openConnectionCredentials(raw).access_tokens!)).toEqual([TOKEN]);
	});

	test('demo mode starts without a key', () => {
		setEnv('GALENE_SECRET_KEY', undefined);
		setEnv('GALENE_DEMO', '1');
		ensureDemoBootstrap();
		expect(canPublicSignup()).toBe(false);
		expect(plaintextSecretLocations(db())).toEqual([]);
		expect((db().query('SELECT COUNT(*) AS n FROM connections').get() as { n: number }).n).toBe(0);
	});
});

describe('stored secret columns', () => {
	test('settings, SSO, webhooks, authenticator, and the gallery key are sealed', () => {
		const id = userId();
		setSetting(id, 'plaid_client_secret', CLIENT_SECRET);
		setSetting(id, 'plaid_client_id', 'client-id-visible');
		const savedOidc = saveOidcSettings({
			enabled: true,
			mode: 'optional',
			issuer: 'https://auth.example/application/o/galene',
			clientId: 'galene',
			clientSecret: 'super-secret-value',
			scopes: 'openid profile email'
		});
		expect(savedOidc.ok).toBe(true);
		const totp = 'JBSWY3DPEHPK3PXP';
		const enrolled = confirmTotpEnroll(id, totp, totpNow(totp));
		expect(enrolled.ok).toBe(true);
		const hook = createWebhook(id, {
			name: 'Hook',
			url: 'https://example.com/hook',
			events: ['account.created'],
			filters: {},
			fields: ['event']
		});
		expect(hook.ok).toBe(true);
		if (!hook.ok) return;
		const keys = ensureInstanceKey();
		expect(keys.publicKey.length).toBeGreaterThan(0);

		expect(plaintextSecretLocations(db())).toEqual([]);
		const setting = (
			db().query(`SELECT value FROM settings WHERE key = 'plaid_client_secret'`).get() as { value: string }
		).value;
		expect(setting.startsWith('enc:v1:')).toBe(true);
		expect(setting).not.toContain(CLIENT_SECRET);
		const clientId = (db().query(`SELECT value FROM settings WHERE key = 'plaid_client_id'`).get() as { value: string })
			.value;
		expect(clientId).toBe('client-id-visible');
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);
		const clientView = plaidConfigForClient(id);
		expect(clientView.secretConfigured).toBe(true);
		expect(clientView).not.toHaveProperty('clientSecret');

		const oidc = (db().query('SELECT client_secret FROM oidc_config').get() as { client_secret: string }).client_secret;
		expect(oidc).not.toContain('super-secret-value');
		expect(loadOidcConfig().clientSecret).toBe('super-secret-value');
		const view = oidcSettingsView('https://app.example');
		expect(view.secretMasked).toBe('••••••••alue');
		expect(view.secretMasked).not.toContain('super-secret');
		expect(JSON.stringify(view)).not.toContain('super-secret-value');

		const wh = (db().query('SELECT secret FROM webhooks').get() as { secret: string }).secret;
		expect(wh).not.toContain(hook.secret);
		expect(openSecret(wh)).toBe(hook.secret);
		expect(listWebhooks(id)[0]).not.toHaveProperty('secret');

		const mfa = (db().query('SELECT secret FROM user_mfa_methods').get() as { secret: string }).secret;
		expect(mfa).not.toContain(totp);
		expect(openSecret(mfa)).toBe(totp);

		const pem = (db().query('SELECT private_key FROM gallery_instance').get() as { private_key: string }).private_key;
		expect(pem.startsWith('enc:v1:')).toBe(true);
		expect(pem).not.toContain('PRIVATE KEY');
		expect(ensureInstanceKey().publicKey).toBe(keys.publicKey);
	});
});

describe('key rotation', () => {
	test('re-encrypts to the new key and a second run is a no-op', () => {
		const id = userId();
		setSetting(id, 'plaid_client_secret', CLIENT_SECRET);
		db()
			.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
			.run(id, sealConnectionCredentials({ access_url: 'https://user:pass@example.com/access' }));
		const before = (db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials;

		setEnv('GALENE_SECRET_KEY', KEY_B);
		setEnv('GALENE_SECRET_KEY_PREVIOUS', KEY_A);
		closeDbForTests();
		const first = rotateStoredSecrets(db());
		expect(first.updated).toBeGreaterThan(0);
		const after = (db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials;
		expect(after).not.toBe(before);
		expect(after.startsWith(`enc:v1:${keyIdFor(Buffer.from(KEY_B, 'base64'))}:`)).toBe(true);
		expect(after).not.toContain('pass@');
		expect(openConnectionCredentials(after).access_url).toBe('https://user:pass@example.com/access');
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);

		const second = rotateStoredSecrets(db());
		expect(second.updated).toBe(0);
		expect((db().query('SELECT credentials FROM connections').get() as { credentials: string }).credentials).toBe(after);

		setEnv('GALENE_SECRET_KEY_PREVIOUS', undefined);
		closeDbForTests();
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);
	});

	test('the rotate script re-encrypts and does not print secrets', () => {
		const id = userId();
		setSetting(id, 'plaid_client_secret', CLIENT_SECRET);
		db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
		closeDbForTests();
		const result = spawnSync('bun', ['src/cli/rotate-secrets.ts'], {
			cwd: join(import.meta.dir, '../../..'),
			env: {
				...process.env,
				GALENE_SECRET_KEY: KEY_B,
				GALENE_SECRET_KEY_PREVIOUS: KEY_A,
				GALENE_DB_PATH: join(dir, 'galene.db'),
				GALENE_DATA_DIR: dir,
				GALENE_ALLOW_EPHEMERAL_DATA: '1'
			},
			encoding: 'utf8'
		});
		const output = `${result.stdout}\n${result.stderr}`;
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Re-encrypted \d+ stored secret/);
		expect(output).not.toContain(CLIENT_SECRET);
		expect(output).not.toContain(KEY_A);
		expect(output).not.toContain(KEY_B);

		setEnv('GALENE_SECRET_KEY', KEY_B);
		setEnv('GALENE_SECRET_KEY_PREVIOUS', undefined);
		expect(getSetting(id, 'plaid_client_secret')).toBe(CLIENT_SECRET);
		const again = spawnSync('bun', ['src/cli/rotate-secrets.ts'], {
			cwd: join(import.meta.dir, '../../..'),
			env: {
				...process.env,
				GALENE_SECRET_KEY: KEY_B,
				GALENE_SECRET_KEY_PREVIOUS: KEY_A,
				GALENE_DB_PATH: join(dir, 'galene.db'),
				GALENE_DATA_DIR: dir,
				GALENE_ALLOW_EPHEMERAL_DATA: '1'
			},
			encoding: 'utf8'
		});
		expect(again.status).toBe(0);
		expect(again.stdout).toMatch(/Re-encrypted 0 stored secret/);
	});
});
