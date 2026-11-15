/**
 * Boot refuses to continue when stored secrets cannot be read.
 * The fake exit stands in for process.exit so the test process stays up.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db, openDatabaseOrExit } from './db';
import { ensureDemoBootstrap } from './demoMode';
import { canPublicSignup } from './users';
import { databaseReady } from './health';
import { GET as healthGet } from '../../routes/health/+server';
import { sealConnectionCredentials } from './secrets';

const ENV_KEYS = [
	'GALENE_SECRET_KEY',
	'GALENE_SECRET_KEY_PREVIOUS',
	'GALENE_DEMO',
	'GALENE_DB_PATH',
	'GALENE_DATA_DIR',
	'GALENE_ALLOW_EPHEMERAL_DATA'
] as const;

const saved: Record<string, string | undefined> = {};
let dir = '';
const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');
const TOKEN = 'access-sandbox-boot-value';

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
	if (!(key in saved)) saved[key] = process.env[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

function freshDb() {
	closeDbForTests();
	dir = mkdtempSync(join(tmpdir(), 'galene-boot-'));
	setEnv('GALENE_DB_PATH', join(dir, 'galene.db'));
	setEnv('GALENE_DATA_DIR', dir);
	setEnv('GALENE_ALLOW_EPHEMERAL_DATA', '1');
	setEnv('GALENE_DEMO', undefined);
	setEnv('GALENE_SECRET_KEY_PREVIOUS', undefined);
}

beforeEach(() => {
	freshDb();
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

function seedEncryptedConnection() {
	setEnv('GALENE_SECRET_KEY', KEY_A);
	db()
		.query(`INSERT INTO users (name, email, password_hash) VALUES ('Ada', 'ada@example.com', 'x')`)
		.run();
	const userId = (db().query('SELECT id FROM users').get() as { id: number }).id;
	db()
		.query(`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, 'plaid', ?, 'connected')`)
		.run(userId, sealConnectionCredentials({ access_tokens: JSON.stringify([TOKEN]) }));
	closeDbForTests();
}

function captureExit(): {
	code: number | undefined;
	lines: string[];
	exit: (code: number) => void;
	restore: () => void;
} {
	const lines: string[] = [];
	const original = console.error;
	console.error = (...args: unknown[]) => {
		lines.push(args.map(String).join(' '));
	};
	const result = {
		code: undefined as number | undefined,
		lines,
		exit: (code: number) => {
			result.code = code;
		},
		restore: () => {
			console.error = original;
		}
	};
	return result;
}

describe('openDatabaseOrExit', () => {
	test('a fresh database with no key does not exit', () => {
		setEnv('GALENE_SECRET_KEY', undefined);
		const captured = captureExit();
		try {
			openDatabaseOrExit(captured.exit);
			expect(captured.code).toBeUndefined();
			expect(databaseReady()).toEqual({ ok: true });
		} finally {
			captured.restore();
		}
	});

	test('demo mode with no key and no encrypted rows does not exit', () => {
		setEnv('GALENE_SECRET_KEY', undefined);
		setEnv('GALENE_DEMO', '1');
		const captured = captureExit();
		try {
			openDatabaseOrExit(captured.exit);
			expect(captured.code).toBeUndefined();
			ensureDemoBootstrap();
			expect(canPublicSignup()).toBe(false);
			expect(databaseReady()).toEqual({ ok: true });
		} finally {
			captured.restore();
		}
	});

	test('a missing key with encrypted rows exits non-zero', () => {
		seedEncryptedConnection();
		setEnv('GALENE_SECRET_KEY', undefined);
		const captured = captureExit();
		try {
			openDatabaseOrExit(captured.exit);
			expect(captured.code).toBe(1);
			const text = captured.lines.join('\n');
			expect(text).toMatch(/GALENE_SECRET_KEY is not set/);
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(KEY_A);
		} finally {
			captured.restore();
		}
	});

	test('a wrong key with encrypted rows exits non-zero', () => {
		seedEncryptedConnection();
		setEnv('GALENE_SECRET_KEY', KEY_B);
		const captured = captureExit();
		try {
			openDatabaseOrExit(captured.exit);
			expect(captured.code).toBe(1);
			const text = captured.lines.join('\n');
			expect(text).toMatch(/cannot decrypt/);
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(KEY_A);
			expect(text).not.toContain(KEY_B);
		} finally {
			captured.restore();
		}
	});
});

describe('GET /health', () => {
	test('returns 200 after the database opens and 503 when the key is wrong', async () => {
		setEnv('GALENE_SECRET_KEY', KEY_A);
		const ready = healthGet();
		expect(ready.status).toBe(200);
		expect(await ready.json()).toEqual({ ok: true });

		seedEncryptedConnection();
		setEnv('GALENE_SECRET_KEY', KEY_B);
		const captured = captureExit();
		try {
			const failed = healthGet();
			expect(failed.status).toBe(503);
			const body = await failed.json();
			expect(body).toEqual({ ok: false });
			expect(JSON.stringify(body)).not.toContain(TOKEN);
			expect(captured.lines.join('\n')).not.toContain(TOKEN);
		} finally {
			captured.restore();
		}
	});
});
