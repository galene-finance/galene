import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db, migrate } from './db';
import {
	DEMO_EMAIL,
	DEMO_PASSWORD,
	ensureDemoBootstrap,
	isDemoMode,
	demoBlockedMessage
} from './demoMode';
import { canPublicSignup, createUser, listUsers } from './users';
import { createApiToken } from './apiTokens';
import { saveOidcSettings } from './oidc';
import { isMcpEnabled } from './mcp';

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ['GALENE_DEMO', 'GALENE_ENABLE_MCP', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;

function setEnv(key: string, value: string | undefined) {
	if (!(key in saved)) saved[key] = process.env[key];
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-demo-'));
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

describe('isDemoMode', () => {
	test('reads GALENE_DEMO truthy values', () => {
		setEnv('GALENE_DEMO', '1');
		expect(isDemoMode()).toBe(true);
		setEnv('GALENE_DEMO', 'true');
		expect(isDemoMode()).toBe(true);
		setEnv('GALENE_DEMO', '0');
		expect(isDemoMode()).toBe(false);
		setEnv('GALENE_DEMO', undefined);
		expect(isDemoMode()).toBe(false);
	});
});

describe('ensureDemoBootstrap', () => {
	test('no-op when demo mode off', () => {
		setEnv('GALENE_DEMO', undefined);
		ensureDemoBootstrap();
		expect(canPublicSignup()).toBe(true);
	});

	test('creates shared demo admin with seed when empty', () => {
		setEnv('GALENE_DEMO', '1');
		ensureDemoBootstrap();
		expect(canPublicSignup()).toBe(false);
		const users = listUsers();
		expect(users).toHaveLength(1);
		expect(users[0]!.email).toBe(DEMO_EMAIL);
		expect(users[0]!.is_admin).toBe(1);
		ensureDemoBootstrap();
		expect(listUsers()).toHaveLength(1);
	});
});

describe('demo locks', () => {
	test('createUser refused in demo except bootstrap flag', () => {
		setEnv('GALENE_DEMO', '1');
		ensureDemoBootstrap();
		const blocked = createUser({
			name: 'Other',
			email: 'other@test.com',
			password: 'password1',
			isAdmin: false,
			demoData: false
		});
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) expect(blocked.error).toContain('disabled');
	});

	test('API token create throws in demo', () => {
		setEnv('GALENE_DEMO', '1');
		ensureDemoBootstrap();
		const id = listUsers()[0]!.id;
		expect(() => createApiToken(id, 'nope')).toThrow(/disabled/);
	});

	test('OIDC save refused in demo', () => {
		setEnv('GALENE_DEMO', '1');
		const result = saveOidcSettings({
			enabled: true,
			mode: 'optional',
			issuer: 'https://example.com',
			clientId: 'x',
			clientSecret: 'y',
			scopes: 'openid'
		});
		expect(result.ok).toBe(false);
	});

	test('MCP forced off in demo', () => {
		setEnv('GALENE_DEMO', '1');
		setEnv('GALENE_ENABLE_MCP', '1');
		expect(isMcpEnabled()).toBe(false);
	});
});

describe('demoBlockedMessage', () => {
	test('mentions demo', () => {
		expect(demoBlockedMessage('Bank sync')).toContain('public demo');
		expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
	});
});
