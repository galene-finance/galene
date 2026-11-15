import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getAppearance, PUT as putAppearance } from '../../routes/api/v1/integration/appearance/+server';
import { GET as getDashboard, PUT as putDashboard } from '../../routes/api/v1/integration/dashboard/+server';
import { sanitizeLayout } from '$lib/dashboard';
import { DEFAULT_THEMES } from '$lib/themes';
import { createApiToken } from './apiTokens';
import { isApiBearerPath, resolveApiBearer } from './api';
import { closeDbForTests, db, migrate } from './db';
import {
	getAppearanceIntegrationState,
	getDashboardIntegrationState
} from './customizationApi';
import { getSetting, saveAccount, saveCategory, saveTag } from './finance';
import { saveUserTheme } from './themes';
import { createUser } from './users';
import { saveWriteApiSettings, setWebhookTransportForTests } from './writeApi';

const ENV_KEYS = ['GALENE_DEMO', 'GALENE_DB_PATH', 'GALENE_DATA_DIR', 'GALENE_ALLOW_EPHEMERAL_DATA'] as const;
const saved: Record<string, string | undefined> = {};
let dir: string;
let webhookCalls: number;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-customization-api-'));
	for (const key of ENV_KEYS) {
		if (!(key in saved)) saved[key] = process.env[key];
		delete process.env[key];
	}
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	process.env.GALENE_DATA_DIR = dir;
	process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
	closeDbForTests();
	migrate(db());
	webhookCalls = 0;
	setWebhookTransportForTests(async () => {
		webhookCalls += 1;
		return new Response('ok');
	});
});

afterEach(() => {
	setWebhookTransportForTests(null);
	closeDbForTests();
	for (const key of ENV_KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
		delete saved[key];
	}
	rmSync(dir, { recursive: true, force: true });
});

function createOwner(label = 'Owner'): number {
	const created = createUser({
		name: label,
		email: `${label.toLowerCase()}@example.com`,
		password: 'password1',
		isAdmin: true,
		demoData: false
	});
	if (!created.ok) throw new Error(created.error);
	return created.userId;
}

function user(userId: number, role: 'owner' | 'viewer' = 'owner') {
	return {
		id: userId,
		name: role === 'owner' ? 'Owner' : 'Viewer',
		email: `${role}@example.com`,
		is_admin: role === 'owner' ? 1 : 0,
		role
	};
}

function event(
	userId: number,
	input: {
		method?: 'GET' | 'PUT';
		body?: unknown;
		token?: { id: number; scope: 'read' | 'write' } | null;
		role?: 'owner' | 'viewer';
		viewer?: boolean;
	} = {}
) {
	const method = input.method ?? 'GET';
	const request = new Request('http://localhost/api/v1/integration/test', {
		method,
		headers: input.body === undefined ? undefined : { 'content-type': 'application/json' },
		body: input.body === undefined ? undefined : JSON.stringify(input.body)
	});
	return {
		request,
		locals: {
			user: user(userId, input.role),
			apiToken: input.token ?? null,
			viewer: input.viewer ? { grantId: 1, scope: {} } : null
		}
	} as never;
}

function streamEvent(userId: number, tokenInfo: { id: number; scope: 'read' | 'write' }) {
	const stream = new TransformStream<Uint8Array, Uint8Array>();
	return {
		event: {
			request: { headers: new Headers(), body: stream.readable },
			locals: { user: user(userId), apiToken: tokenInfo, viewer: null }
		} as never,
		writer: stream.writable.getWriter()
	};
}

async function body(response: Response): Promise<Record<string, any>> {
	return (await response.json()) as Record<string, any>;
}

function token(userId: number, scope: 'read' | 'write') {
	const created = createApiToken(userId, `${scope}-token`, scope);
	return { raw: created.token, info: { id: created.info.id, scope } };
}

function seedFilterRows(userId: number) {
	saveAccount(userId, null, { name: 'Synthetic account', type: 'bank', color: null });
	saveCategory(userId, null, { name: 'Synthetic category', type: 'expense', parent_id: null, color: null });
	saveTag(userId, null, 'Synthetic tag');
	return {
		account: (db().query('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: number }).id,
		category: (db().query('SELECT id FROM categories WHERE user_id = ?').get(userId) as { id: number }).id,
		tag: (db().query('SELECT id FROM tags WHERE user_id = ?').get(userId) as { id: number }).id
	};
}

function financeCounts(userId: number) {
	const tables = ['accounts', 'categories', 'tags', 'transactions', 'budgets', 'scheduled'] as const;
	return Object.fromEntries(
		tables.map((table) => [
			table,
			(db().query(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n
		])
	);
}

describe('integration authentication and bearer fence', () => {
	test('requires an actual API token and rejects owner/viewer cookie substitution', async () => {
		const userId = createOwner();
		const reader = token(userId, 'read');

		expect((await getDashboard(event(userId))).status).toBe(401);
		expect((await getDashboard(event(userId, { token: reader.info, role: 'viewer' }))).status).toBe(401);
		expect((await getDashboard(event(userId, { token: reader.info, viewer: true }))).status).toBe(401);
		expect((await getDashboard(event(userId, { token: reader.info }))).status).toBe(200);
	});

	test('resolves bearer credentials only for API descendants and exact MCP', () => {
		const userId = createOwner();
		const reader = token(userId, 'read');
		const authorization = `Bearer ${reader.raw}`;

		expect(isApiBearerPath('/api/v1/integration/dashboard')).toBe(true);
		expect(isApiBearerPath('/mcp')).toBe(true);
		expect(isApiBearerPath('/mcp/')).toBe(false);
		expect(isApiBearerPath('/dashboard')).toBe(false);
		expect(resolveApiBearer('/dashboard', authorization)).toBeNull();
		expect(resolveApiBearer('/api/v1/integration/dashboard', authorization)?.tokenId).toBe(reader.info.id);
		expect(resolveApiBearer('/mcp', authorization)?.scope).toBe('read');
		expect(resolveApiBearer('/api/v1/integration/dashboard', 'Bearer invalid')).toBeNull();
	});

	test('rejects mismatched or invalid persisted token scopes', async () => {
		const userId = createOwner();
		const reader = token(userId, 'read');
		expect((await getAppearance(event(userId, { token: { id: reader.info.id, scope: 'write' } }))).status).toBe(401);
		db().run('PRAGMA ignore_check_constraints = ON');
		db().query("UPDATE api_tokens SET scope = 'unexpected' WHERE id = ?").run(reader.info.id);
		db().run('PRAGMA ignore_check_constraints = OFF');
		expect((await getAppearance(event(userId, { token: reader.info }))).status).toBe(401);
	});
});

describe('dashboard integration', () => {
	test('returns only the canonical native layout, fixed catalog, and revision', async () => {
		const userId = createOwner();
		const reader = token(userId, 'read');
		const response = await getDashboard(event(userId, { token: reader.info }));
		const result = await body(response);

		expect(response.status).toBe(200);
		expect(Object.keys(result).sort()).toEqual(['catalog', 'layout', 'revision']);
		expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
		expect(result.catalog.max_widgets).toBe(12);
		expect(result.catalog.widget_types).toHaveLength(7);
		expect(JSON.stringify(result)).not.toContain('balance_cents');
		expect(JSON.stringify(result)).not.toContain('amount_cents');
	});

	test('applies one canonical layout atomically with metadata-only audit and no finance/webhook change', async () => {
		const userId = createOwner();
		const rows = seedFilterRows(userId);
		const beforeFinance = financeCounts(userId);
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getDashboardIntegrationState(userId);
		const changed = structuredClone(state.layout);
		const recent = changed.find((widget) => widget.type === 'recent')!;
		recent.filters = {
			accountIds: [rows.account],
			categoryIds: [rows.category],
			tagIds: [rows.tag],
			limit: 5
		};
		const layout = sanitizeLayout(changed);

		const response = await putDashboard(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: { revision: state.revision, layout }
			})
		);
		const result = await body(response);

		expect(response.status).toBe(200);
		expect(Object.keys(result).sort()).toEqual(['layout', 'ok', 'revision']);
		expect(result.ok).toBe(true);
		expect(result.layout).toEqual(layout);
		expect(financeCounts(userId)).toEqual(beforeFinance);
		expect(webhookCalls).toBe(0);
		const audit = db()
			.query('SELECT action, resource, resource_id, detail FROM api_audit WHERE user_id = ?')
			.get(userId) as { action: string; resource: string; resource_id: number | null; detail: string };
		expect(audit.action).toBe('update');
		expect(audit.resource).toBe('dashboard');
		expect(audit.resource_id).toBeNull();
		const detail = JSON.parse(audit.detail);
		expect(Object.keys(detail).sort()).toEqual(['after_revision', 'before_revision', 'changed_fields']);
		expect(detail.changed_fields).toEqual(['layout']);
		expect(audit.detail).not.toContain('accountIds');
		expect(audit.detail).not.toContain('Synthetic');
	});

	test('returns a no-op without persisting the default layout or auditing', async () => {
		const userId = createOwner();
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getDashboardIntegrationState(userId);

		const response = await putDashboard(
			event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, layout: state.layout } })
		);
		const result = await body(response);

		expect(response.status).toBe(200);
		expect(result.changed).toBe(false);
		expect(db().query("SELECT count(*) AS n FROM settings WHERE user_id = ? AND key = 'dashboard_layout'").get(userId)).toEqual({ n: 0 });
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });
	});

	test('rejects write gates, stale revisions, noncanonical input, and cross-user filters before mutation', async () => {
		const userId = createOwner('First');
		const otherId = createOwner('Second');
		const otherRows = seedFilterRows(otherId);
		const reader = token(userId, 'read');
		const writer = token(userId, 'write');
		const state = getDashboardIntegrationState(userId);
		const changed = structuredClone(state.layout);
		changed.find((widget) => widget.type === 'recent')!.filters = { accountIds: [otherRows.account], limit: 10 };
		const layout = sanitizeLayout(changed);

		expect(
			(await putDashboard(event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, layout } }))).status
		).toBe(403);
		expect(saveWriteApiSettings(true).ok).toBe(true);
		expect(
			(await putDashboard(event(userId, { method: 'PUT', token: reader.info, body: { revision: state.revision, layout } }))).status
		).toBe(403);
		expect(
			(await putDashboard(event(userId, { method: 'PUT', token: writer.info, body: { revision: 'a'.repeat(64), layout } }))).status
		).toBe(409);
		expect(
			(await putDashboard(event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, layout } }))).status
		).toBe(422);
		const noncanonical = structuredClone(state.layout);
		noncanonical[0]!.x = 1;
		expect(
			(await putDashboard(event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, layout: noncanonical } }))).status
		).toBe(422);
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });
	});

	test('rolls the native save back if metadata auditing fails', async () => {
		const userId = createOwner();
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const before = getDashboardIntegrationState(userId);
		const layout = before.layout.slice(0, -1);
		db().run(`CREATE TRIGGER reject_customization_audit BEFORE INSERT ON api_audit BEGIN SELECT RAISE(ABORT, 'synthetic'); END`);

		const response = await putDashboard(
			event(userId, { method: 'PUT', token: writer.info, body: { revision: before.revision, layout } })
		);
		const result = await body(response);

		expect(response.status).toBe(500);
		expect(result.outcome_unknown).toBe(true);
		expect(getDashboardIntegrationState(userId)).toEqual(before);
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });
	});

	test('rechecks token and write-toggle gates after a slow request body', async () => {
		const userId = createOwner();
		const writerToken = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getDashboardIntegrationState(userId);
		const layout = state.layout.slice(0, -1);
		const encoded = new TextEncoder().encode(JSON.stringify({ revision: state.revision, layout }));

		const toggleStream = streamEvent(userId, writerToken.info);
		const togglePending = putDashboard(toggleStream.event);
		expect(saveWriteApiSettings(false).ok).toBe(true);
		await toggleStream.writer.write(encoded);
		await toggleStream.writer.close();
		expect((await togglePending).status).toBe(403);
		expect(getDashboardIntegrationState(userId)).toEqual(state);

		expect(saveWriteApiSettings(true).ok).toBe(true);
		const tokenStream = streamEvent(userId, writerToken.info);
		const tokenPending = putDashboard(tokenStream.event);
		db().query('DELETE FROM api_tokens WHERE id = ?').run(writerToken.info.id);
		await tokenStream.writer.write(encoded);
		await tokenStream.writer.close();
		expect((await tokenPending).status).toBe(401);
		expect(getDashboardIntegrationState(userId)).toEqual(state);
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });
	});

	test('bounds request bytes, rejects malformed UTF-8, and reports post-commit mismatch as outcome unknown', async () => {
		const userId = createOwner();
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getDashboardIntegrationState(userId);

		const oversized = await putDashboard(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: { padding: 'x'.repeat(256 * 1024 + 1) }
			})
		);
		expect(oversized.status).toBe(422);
		const declared = {
			request: { headers: new Headers({ 'content-length': String(256 * 1024 + 1) }), body: null },
			locals: { user: user(userId), apiToken: writer.info, viewer: null }
		} as never;
		expect((await putDashboard(declared)).status).toBe(422);

		const malformed = streamEvent(userId, writer.info);
		const malformedPending = putDashboard(malformed.event);
		await malformed.writer.write(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
		await malformed.writer.close();
		expect((await malformedPending).status).toBe(422);

		db().run(`CREATE TRIGGER mutate_dashboard_after_audit AFTER INSERT ON api_audit
			WHEN NEW.resource = 'dashboard'
			BEGIN
				UPDATE settings SET value = '[]' WHERE user_id = NEW.user_id AND key = 'dashboard_layout';
			END`);
		const response = await putDashboard(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: { revision: state.revision, layout: state.layout.slice(0, -1) }
			})
		);
		const result = await body(response);
		expect(response.status).toBe(500);
		expect(result.outcome_unknown).toBe(true);
		expect(result.retryable).toBe(false);
		expect(getDashboardIntegrationState(userId).layout).toEqual([]);
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 1 });
	});
});

describe('appearance integration', () => {
	test('returns built-in and owned custom themes without accepting browser-only controls', async () => {
		const userId = createOwner();
		const customId = saveUserTheme(userId, null, 'Synthetic calm', DEFAULT_THEMES[0]!.colors);
		const reader = token(userId, 'read');
		const response = await getAppearance(event(userId, { token: reader.info }));
		const result = await body(response);

		expect(response.status).toBe(200);
		expect(Object.keys(result).sort()).toEqual(['appearance', 'catalog', 'revision']);
		expect(result.catalog.built_in_themes).toHaveLength(6);
		expect(result.catalog.custom_themes).toEqual([
			{ id: customId, name: 'Synthetic calm', colors: DEFAULT_THEMES[0]!.colors }
		]);
		expect(result.catalog.icons.map((icon: { key: string }) => icon.key)).toContain('emblem');
		expect(JSON.stringify(result)).not.toContain('css');
		expect(JSON.stringify(result)).not.toContain('url');
	});

	test('creates and selects a bounded theme while preserving omissions and auditing only actual changes', async () => {
		const userId = createOwner();
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const beforeFinance = financeCounts(userId);
		const state = getAppearanceIntegrationState(userId);
		const colors = { ...DEFAULT_THEMES[0]!.colors, primary: '#123456', radius: '1rem' };
		const changes = {
			theme: { kind: 'custom', name: 'Synthetic quiet', colors },
			app_name: 'Example Money',
			icon: 'emblem',
			week_starts_on: 'monday'
		};

		const response = await putAppearance(
			event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, changes } })
		);
		const result = await body(response);

		expect(response.status).toBe(200);
		expect(Object.keys(result).sort()).toEqual(['appearance', 'ok', 'revision']);
		expect(result.appearance.theme).toMatchObject({ kind: 'custom', name: 'Synthetic quiet', colors });
		expect(result.appearance.app_name).toBe('Example Money');
		expect(result.appearance.favicon).toBe('emblem');
		expect(result.appearance.week_starts_on).toBe('monday');
		expect(financeCounts(userId)).toEqual(beforeFinance);
		expect(webhookCalls).toBe(0);
		const audit = db().query('SELECT detail FROM api_audit WHERE user_id = ?').get(userId) as { detail: string };
		const detail = JSON.parse(audit.detail);
		expect(detail.changed_fields).toEqual(['app_name', 'theme', 'week_starts_on']);
		expect(audit.detail).not.toContain('Example Money');
		expect(audit.detail).not.toContain('Synthetic quiet');
	});

	test('selects and updates an owned theme but rejects a cross-user theme id', async () => {
		const userId = createOwner('First');
		const otherId = createOwner('Second');
		const ownTheme = saveUserTheme(userId, null, 'Owned', DEFAULT_THEMES[0]!.colors);
		const otherTheme = saveUserTheme(otherId, null, 'Other', DEFAULT_THEMES[1]!.colors);
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getAppearanceIntegrationState(userId);
		const colors = { ...DEFAULT_THEMES[2]!.colors, primary: '#abcdef' };

		const updated = await putAppearance(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: {
					revision: state.revision,
					changes: { theme: { kind: 'custom', id: ownTheme, name: 'Owned updated', colors } }
				}
			})
		);
		expect(updated.status).toBe(200);
		const after = getAppearanceIntegrationState(userId);
		expect(after.appearance.theme).toEqual({ kind: 'custom', id: ownTheme, name: 'Owned updated', colors });

		const rejected = await putAppearance(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: {
					revision: after.revision,
					changes: { theme: { kind: 'custom', id: otherTheme } }
				}
			})
		);
		expect(rejected.status).toBe(422);
		expect(getSetting(userId, 'theme')).toBe(String(ownTheme));
	});

	test('rejects duplicate creates, code-like fields, unsafe text, and out-of-range radius before mutation', async () => {
		const userId = createOwner();
		saveUserTheme(userId, null, 'Existing', DEFAULT_THEMES[0]!.colors);
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getAppearanceIntegrationState(userId);
		const attempts = [
			{ theme: { kind: 'custom', name: 'existing', colors: DEFAULT_THEMES[0]!.colors } },
			{ css: 'body { display: none }' },
			{ app_name: 'Unsafe\u202eName' },
			{ theme: { kind: 'custom', name: 'Wide', colors: { ...DEFAULT_THEMES[0]!.colors, radius: '3rem' } } }
		];
		for (const changes of attempts) {
			const response = await putAppearance(
				event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, changes } })
			);
			expect(response.status).toBe(422);
		}
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });
		expect(getAppearanceIntegrationState(userId)).toEqual(state);
	});

	test('returns a no-op with zero audit and demo mode rejects reads and writes', async () => {
		const userId = createOwner();
		const writer = token(userId, 'write');
		expect(saveWriteApiSettings(true).ok).toBe(true);
		const state = getAppearanceIntegrationState(userId);
		const response = await putAppearance(
			event(userId, {
				method: 'PUT',
				token: writer.info,
				body: { revision: state.revision, changes: { app_name: '', icon: 'emblem' } }
			})
		);
		expect(response.status).toBe(200);
		expect((await body(response)).changed).toBe(false);
		expect(db().query('SELECT count(*) AS n FROM api_audit WHERE user_id = ?').get(userId)).toEqual({ n: 0 });

		process.env.GALENE_DEMO = '1';
		expect((await getAppearance(event(userId, { token: writer.info }))).status).toBe(403);
		expect(
			(
				await putAppearance(
					event(userId, { method: 'PUT', token: writer.info, body: { revision: state.revision, changes: { icon: 'star' } } })
				)
			).status
		).toBe(403);
	});
});
