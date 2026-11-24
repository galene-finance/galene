/**
 * Bearer routing through the real handle.
 * Import runs with demo mode on so schedulers and provider backfill stay idle.
 * Each test then uses its own temp database with demo mode off unless noted.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { createGrant, createViewerSession } from '$lib/server/advisor';
import { createApiToken, deleteApiToken } from '$lib/server/apiTokens';
import { createSession } from '$lib/server/auth';
import { closeDbForTests, db, migrate } from '$lib/server/db';
import { createUser } from '$lib/server/users';
import { isWriteApiEnabled } from '$lib/server/writeApi';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];

const bootDir = mkdtempSync(join(tmpdir(), 'galene-handle-boot-'));
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
process.env.GALENE_DATA_DIR = bootDir;
process.env.GALENE_DB_PATH = join(bootDir, 'boot.db');
process.env.GALENE_DEMO = '1';
const globals = globalThis as { __galeneSyncScheduler?: boolean; __galeneBackupScheduler?: boolean };
globals.__galeneSyncScheduler = true;
globals.__galeneBackupScheduler = true;
const { handle } = await import('./hooks.server');
closeDbForTests();
if (saved.GALENE_DEMO === undefined) delete process.env.GALENE_DEMO;
else process.env.GALENE_DEMO = saved.GALENE_DEMO;

let dir = '';

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-handle-'));
	process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
	process.env.GALENE_DATA_DIR = dir;
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	delete process.env.GALENE_DEMO;
	closeDbForTests();
	migrate(db());
});

afterEach(() => {
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = '';
});

afterAll(() => {
	closeDbForTests();
	rmSync(bootDir, { recursive: true, force: true });
});

function makeUser(name: string, email: string): number {
	const created = createUser({
		name,
		email,
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function addAccount(userId: number, name: string) {
	db().query(`INSERT INTO accounts (user_id, name, type) VALUES (?, ?, 'bank')`).run(userId, name);
}

function lastUsed(tokenId: number): string | null {
	const row = db().query('SELECT last_used_at FROM api_tokens WHERE id = ?').get(tokenId) as
		| { last_used_at: string | null }
		| undefined;
	return row?.last_used_at ?? null;
}

type Invoke = 'none' | 'accounts' | 'index' | 'create-token' | 'save-write-api';

async function call(opts: {
	method?: string;
	path: string;
	routeId: string | null;
	cookie?: string;
	authorization?: string;
	form?: Record<string, string>;
	invoke?: Invoke;
}): Promise<{ status: number | null; location: string | null; resolved: boolean; json: unknown; locals: App.Locals }> {
	const headers = new Headers();
	if (opts.cookie) headers.set('cookie', `galene_session=${opts.cookie}`);
	if (opts.authorization !== undefined) headers.set('authorization', opts.authorization);
	const url = new URL(opts.path, 'http://localhost');
	const form = opts.form ? new FormData() : null;
	if (form && opts.form) {
		for (const [key, value] of Object.entries(opts.form)) form.set(key, value);
	}
	const request = new Request(url, {
		method: opts.method ?? 'GET',
		headers,
		body: form
	});
	const jar = new Map<string, string>();
	if (opts.cookie) jar.set('galene_session', opts.cookie);
	const event = {
		cookies: {
			get: (name: string) => jar.get(name),
			getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
			set: (name: string, value: string, cookieOpts?: { maxAge?: number }) => {
				if (value === '' || cookieOpts?.maxAge === 0) jar.delete(name);
				else jar.set(name, value);
			},
			delete: (name: string) => {
				jar.delete(name);
			},
			serialize: (name: string, value: string) => `${name}=${value}`
		},
		locals: {} as App.Locals,
		request,
		route: { id: opts.routeId },
		url,
		params: {},
		fetch: globalThis.fetch,
		setHeaders: () => {},
		platform: undefined,
		isDataRequest: false,
		isSubRequest: false
	} as unknown as RequestEvent;

	let resolved = false;
	try {
		const response = await handle({
			event,
			resolve: async (resolvedEvent) => {
				resolved = true;
				const invoke = opts.invoke ?? 'none';
				if (invoke === 'accounts') {
					const { GET } = await import('./routes/api/v1/accounts/+server');
					return GET(resolvedEvent as unknown as Parameters<typeof GET>[0]);
				}
				if (invoke === 'index') {
					const { GET } = await import('./routes/api/v1/+server');
					return GET(resolvedEvent as unknown as Parameters<typeof GET>[0]);
				}
				if (invoke === 'create-token') {
					const { actions } = await import('./routes/(app)/settings/api/+page.server');
					const result = await actions.create({
						request: resolvedEvent.request,
						locals: resolvedEvent.locals
					} as Parameters<typeof actions.create>[0]);
					const tokenName = result && 'tokenName' in result ? result.tokenName : null;
					return new Response(JSON.stringify({ ok: result.ok === true, tokenName }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (invoke === 'save-write-api') {
					const { actions } = await import('./routes/(app)/settings/api/+page.server');
					const saveWriteApi = actions['save-write-api'];
					const result = await saveWriteApi({
						request: resolvedEvent.request,
						locals: resolvedEvent.locals
					} as Parameters<typeof saveWriteApi>[0]);
					return new Response(JSON.stringify(result), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				return new Response('ok', { status: 200 });
			}
		});
		const text = await response.text();
		let json: unknown = null;
		if (text) {
			try {
				json = JSON.parse(text);
			} catch {
				json = text;
			}
		}
		return { status: response.status, location: null, resolved, json, locals: event.locals };
	} catch (error) {
		if (!isRedirect(error)) throw error;
		return { status: error.status, location: error.location, resolved, json: null, locals: event.locals };
	}
}

describe('API token routing', () => {
	test('a bearer token on an app page does not sign the request in', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const { token, info } = createApiToken(owner, 'reader', 'read');
		const page = await call({
			path: '/transactions',
			routeId: '/(app)/transactions',
			authorization: `Bearer ${token}`
		});
		expect(page.locals.user).toBeNull();
		expect(page.locals.apiToken).toBeNull();
		expect(page.locals.viewer).toBeNull();
		expect(page.resolved).toBe(true);
		expect(page.location).toBeNull();
		expect(lastUsed(info.id)).toBeNull();

		const posted = await call({
			method: 'POST',
			path: '/settings/api?/create',
			routeId: '/(app)/settings/api',
			authorization: `Bearer ${token}`,
			form: { name: 'laptop', scope: 'read' },
			invoke: 'create-token'
		});
		expect(posted.status).toBe(303);
		expect(posted.location).toBe('/login');
		expect(posted.resolved).toBe(false);
		expect(posted.locals.user).toBeNull();
	});

	test('a read-only bearer does not run settings form actions', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const { token } = createApiToken(owner, 'reader', 'read');
		const cookie = createSession(owner);

		const created = await call({
			method: 'POST',
			path: '/settings/api?/create',
			routeId: '/(app)/settings/api',
			authorization: `Bearer ${token}`,
			form: { name: 'laptop', scope: 'write' },
			invoke: 'create-token'
		});
		expect(created.location).toBe('/login');
		expect(created.resolved).toBe(false);
		expect(db().query('SELECT COUNT(*) AS c FROM api_tokens').get()).toEqual({ c: 1 });

		const toggled = await call({
			method: 'POST',
			path: '/settings/api?/save-write-api',
			routeId: '/(app)/settings/api',
			authorization: `Bearer ${token}`,
			form: { enabled: '1' },
			invoke: 'save-write-api'
		});
		expect(toggled.location).toBe('/login');
		expect(toggled.resolved).toBe(false);
		expect(isWriteApiEnabled()).toBe(false);

		const withCookie = await call({
			method: 'POST',
			path: '/settings/api?/create',
			routeId: '/(app)/settings/api',
			cookie,
			authorization: `Bearer ${token}`,
			form: { name: 'laptop', scope: 'read' },
			invoke: 'create-token'
		});
		expect(withCookie.location).toBeNull();
		expect(withCookie.resolved).toBe(true);
		expect(withCookie.locals.user?.id).toBe(owner);
		expect(withCookie.locals.apiToken).toBeNull();
		expect(withCookie.json).toEqual({ ok: true, tokenName: 'laptop' });
		expect(isWriteApiEnabled()).toBe(false);
	});

	test('a bearer token on /api/v1 wins over another user session cookie', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const other = makeUser('Other', 'other@example.com');
		addAccount(owner, 'Token Checking');
		addAccount(other, 'Cookie Checking');
		const { token, info } = createApiToken(owner, 'reader', 'read');
		const result = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie: createSession(other),
			authorization: `Bearer ${token}`,
			invoke: 'accounts'
		});
		expect(result.status).toBe(200);
		expect(result.locals.user?.id).toBe(owner);
		expect(result.locals.user?.role).toBe('owner');
		expect(result.locals.viewer).toBeNull();
		expect(result.locals.apiToken).toEqual({ id: info.id, scope: 'read' });
		const names = (result.json as { accounts: { name: string }[] }).accounts.map((row) => row.name);
		expect(names).toEqual(['Token Checking']);
	});

	test('a bearer token on /api/v1 wins over a viewer session', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const reader = makeUser('Reader', 'reader@example.com');
		addAccount(owner, 'Owner Checking');
		addAccount(reader, 'Reader Checking');
		const grant = createGrant(owner, {
			label: 'Viewer',
			kind: 'viewer',
			dateFrom: '2026-01-01',
			dateTo: '2026-12-31',
			accountIds: [],
			ttlDays: 7,
			password: 'share-secret'
		});
		if ('error' in grant) throw new Error(grant.error);
		const viewerCookie = createViewerSession(grant.grant.id, grant.grant.user_id, grant.grant.expires_at);
		const { token, info } = createApiToken(reader, 'reader', 'read');

		const asViewer = await call({
			path: '/transactions',
			routeId: '/(app)/transactions',
			cookie: viewerCookie
		});
		expect(asViewer.locals.user?.id).toBe(owner);
		expect(asViewer.locals.user?.role).toBe('viewer');
		expect(asViewer.locals.viewer?.grantId).toBe(grant.grant.id);
		expect(asViewer.location).toBeNull();

		const asToken = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie: viewerCookie,
			authorization: `Bearer ${token}`,
			invoke: 'accounts'
		});
		expect(asToken.status).toBe(200);
		expect(asToken.locals.user?.id).toBe(reader);
		expect(asToken.locals.user?.role).toBe('owner');
		expect(asToken.locals.viewer).toBeNull();
		expect(asToken.locals.apiToken).toEqual({ id: info.id, scope: 'read' });
		const names = (asToken.json as { accounts: { name: string }[] }).accounts.map((row) => row.name);
		expect(names).toEqual(['Reader Checking']);

		const unresolved = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie: viewerCookie,
			authorization: 'Bearer not-a-token',
			invoke: 'accounts'
		});
		expect(unresolved.status).toBe(401);
		expect(unresolved.locals.user).toBeNull();
		expect(unresolved.locals.viewer).toBeNull();
		expect(unresolved.locals.apiToken).toBeNull();
	});

	test('an unresolved bearer on /api/v1 does not use the session cookie', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const cookie = createSession(owner);
		const { token, info } = createApiToken(owner, 'revoked', 'read');
		deleteApiToken(owner, info.id);

		const revoked = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie,
			authorization: `Bearer ${token}`,
			invoke: 'accounts'
		});
		expect(revoked.status).toBe(401);
		expect(revoked.locals.user).toBeNull();
		expect(revoked.locals.viewer).toBeNull();
		expect(revoked.locals.apiToken).toBeNull();

		const malformed = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie,
			authorization: 'Bearer not-a-token',
			invoke: 'accounts'
		});
		expect(malformed.status).toBe(401);
		expect(malformed.locals.user).toBeNull();
		expect(malformed.locals.apiToken).toBeNull();
	});

	test('a non-Bearer Authorization scheme on /api/v1 does not use the session cookie', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const result = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie: createSession(owner),
			authorization: 'Basic abc',
			invoke: 'accounts'
		});
		expect(result.status).toBe(401);
		expect(result.locals.user).toBeNull();
		expect(result.locals.viewer).toBeNull();
		expect(result.locals.apiToken).toBeNull();
	});

	test('a session cookie on /api/v1 still works when Authorization is absent', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		addAccount(owner, 'Cookie Checking');
		const result = await call({
			path: '/api/v1/accounts',
			routeId: '/api/v1/accounts',
			cookie: createSession(owner),
			invoke: 'accounts'
		});
		expect(result.status).toBe(200);
		expect(result.locals.user?.id).toBe(owner);
		expect(result.locals.apiToken).toBeNull();
		expect(result.locals.viewer).toBeNull();
		const names = (result.json as { accounts: { name: string }[] }).accounts.map((row) => row.name);
		expect(names).toEqual(['Cookie Checking']);
	});

	test('an app page keeps the session cookie when Authorization is present', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const other = makeUser('Other', 'other@example.com');
		const { token, info } = createApiToken(owner, 'reader', 'read');
		const result = await call({
			path: '/transactions',
			routeId: '/(app)/transactions',
			cookie: createSession(other),
			authorization: `Bearer ${token}`
		});
		expect(result.locals.user?.id).toBe(other);
		expect(result.locals.user?.role).toBe('owner');
		expect(result.locals.apiToken).toBeNull();
		expect(result.locals.viewer).toBeNull();
		expect(lastUsed(info.id)).toBeNull();
	});

	test('demo mode ignores a bearer token', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		addAccount(owner, 'Demo Checking');
		const { token, info } = createApiToken(owner, 'reader', 'read');
		const cookie = createSession(owner);
		process.env.GALENE_DEMO = '1';
		try {
			const bearerOnly = await call({
				path: '/api/v1/accounts',
				routeId: '/api/v1/accounts',
				authorization: `Bearer ${token}`,
				invoke: 'accounts'
			});
			expect(bearerOnly.status).toBe(401);
			expect(bearerOnly.locals.user).toBeNull();
			expect(bearerOnly.locals.apiToken).toBeNull();
			expect(lastUsed(info.id)).toBeNull();

			const withCookie = await call({
				path: '/api/v1/accounts',
				routeId: '/api/v1/accounts',
				cookie,
				authorization: `Bearer ${token}`,
				invoke: 'accounts'
			});
			expect(withCookie.status).toBe(200);
			expect(withCookie.locals.user?.id).toBe(owner);
			expect(withCookie.locals.apiToken).toBeNull();
			expect(lastUsed(info.id)).toBeNull();
			const names = (withCookie.json as { accounts: { name: string }[] }).accounts.map((row) => row.name);
			expect(names).toEqual(['Demo Checking']);
		} finally {
			delete process.env.GALENE_DEMO;
		}
	});

	test('the /api/v1 index and /mcp accept a bearer token', async () => {
		const owner = makeUser('Owner', 'owner@example.com');
		const { token, info } = createApiToken(owner, 'reader', 'read');
		const index = await call({
			path: '/api/v1',
			routeId: '/api/v1',
			authorization: `Bearer ${token}`,
			invoke: 'index'
		});
		expect(index.status).toBe(200);
		expect(index.locals.user?.id).toBe(owner);
		expect(index.locals.apiToken).toEqual({ id: info.id, scope: 'read' });
		expect((index.json as { name: string }).name).toBe('galene-api');

		const mcp = await call({
			path: '/mcp',
			routeId: '/mcp',
			method: 'POST',
			authorization: `Bearer ${token}`
		});
		expect(mcp.resolved).toBe(true);
		expect(mcp.locals.user?.id).toBe(owner);
		expect(mcp.locals.viewer).toBeNull();
		expect(mcp.locals.apiToken).toEqual({ id: info.id, scope: 'read' });

		const prefix = await call({
			path: '/mcpfoo',
			routeId: null,
			authorization: `Bearer ${token}`
		});
		expect(prefix.locals.user).toBeNull();
		expect(prefix.locals.apiToken).toBeNull();
		expect(prefix.resolved).toBe(true);

		const nearApi = await call({
			path: '/api/v1foo',
			routeId: null,
			authorization: `Bearer ${token}`
		});
		expect(nearApi.locals.user).toBeNull();
		expect(nearApi.locals.apiToken).toBeNull();
	});
});
