import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDbForTests, db, migrate } from './db';

import { buildPackFiles, buildPackZip, loadPack, savePack, zipStore } from './pack';
import { forbidViewerMutation } from './viewerGuard';
import {
	acceptViewerInvite,
	createGrant,
	createViewerSession,
	getViewerByToken,
	inviteLanding,
	listAudit,
	resolveShareToken,
	revokeGrant,
	scopeAccountIds,
	scopeDateRange,
	type GrantScope
} from './advisor';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'galene-advisor-'));
	process.env.GALENE_DB_PATH = join(dir, 'galene.db');
	closeDbForTests();
	const database = db();
	migrate(database);
	database
		.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner', 'owner@example.com', 'x')`)
		.run();
	database.query(`INSERT INTO accounts (user_id, name, type) VALUES (1, 'Checking', 'bank')`).run();
	database.query(`INSERT INTO accounts (user_id, name, type) VALUES (1, 'Savings', 'bank')`).run();
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant) VALUES (1, 1, '2025-03-01', -1200, 'Cafe')`
		)
		.run();
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant) VALUES (1, 2, '2025-06-01', -500, 'Hidden')`
		)
		.run();
	database
		.query(
			`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant) VALUES (1, 1, '2024-01-01', -50, 'Old')`
		)
		.run();
});

afterEach(() => {
	closeDbForTests();
	delete process.env.GALENE_DB_PATH;
	rmSync(dir, { recursive: true, force: true });
});

describe('grant scope', () => {
	const scope: GrantScope = {
		userId: 1,
		grantId: 1,
		dateFrom: '2025-01-01',
		dateTo: '2025-12-31',
		accountIds: [1]
	};

	test('clamps dates and accounts in the query filters', () => {
		expect(scopeAccountIds(scope, [1, 2])).toEqual([1]);
		const dates = scopeDateRange(scope, '2024-01-01', '2026-01-01');
		expect(dates).toEqual({ dateFrom: '2025-01-01', dateTo: '2025-12-31' });
	});

	test('an empty account filter means the grant accounts only', () => {
		expect(scopeAccountIds(scope, [])).toEqual([1]);
	});

	test('a request entirely outside the window returns no range', () => {
		expect(scopeDateRange(scope, '2020-01-01', '2020-02-01')).toBeNull();
	});
});

describe('accountant pack', () => {
	test('frozen zip is unchanged after a later book edit', () => {
		const created = createGrant(1, {
			label: '2025',
			kind: 'pack',
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [1],
			ttlDays: 14
		});
		if ('error' in created) throw new Error(created.error);
		const scope: GrantScope = {
			userId: 1,
			grantId: created.grant.id,
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [1]
		};
		const files = buildPackFiles(scope, '2026-01-02T00:00:00.000Z');
		const zip = zipStore(files);
		savePack(scope, zip);
		const stored = loadPack(1, created.grant.id);
		expect(Buffer.compare(stored!, zip)).toBe(0);
		const csv = files.find((f) => f.name === 'transactions.csv')!.data.toString('utf8');
		expect(csv).toContain('Cafe');
		expect(csv).not.toContain('Hidden');
		expect(csv).not.toContain('password');
		expect(files.find((f) => f.name === 'manifest.json')!.data.toString('utf8')).toContain(
			'ledger through date_to'
		);

		db()
			.query(
				`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant) VALUES (1, 1, '2025-04-01', -999, 'After')`
			)
			.run();
		const again = buildPackFiles(scope, '2026-02-01T00:00:00.000Z');
		expect(again.find((f) => f.name === 'transactions.csv')!.data.toString('utf8')).toContain('After');
		expect(Buffer.compare(loadPack(1, created.grant.id)!, zip)).toBe(0);
		expect(buildPackZip(scope, '2026-01-02T00:00:00.000Z').readUInt32LE(0)).toBe(0x04034b50);

		const open = resolveShareToken(created.token, null);
		expect(open.ok).toBe(true);
		revokeGrant(1, created.grant.id);
		const closed = resolveShareToken(created.token, null);
		expect(closed.ok).toBe(false);
		if (!closed.ok) expect(closed.status).toBe(410);
	});

	test('zip round-trips local file headers', () => {
		const z = zipStore([{ name: 'manifest.json', data: Buffer.from('{"ok":true}\n') }]);
		expect(z.readUInt32LE(0)).toBe(0x04034b50);
		expect(z.includes(Buffer.from('manifest.json'))).toBe(true);
	});
});

describe('viewer session', () => {
	test('login then revoke blocks the session and writes audit rows', () => {
		const created = createGrant(1, {
			label: 'CPA',
			kind: 'viewer',
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [],
			ttlDays: 7,
			password: 'share-secret'
		});
		if ('error' in created) throw new Error(created.error);
		expect(resolveShareToken(created.token, null).ok).toBe(false);
		const authed = resolveShareToken(created.token, 'share-secret');
		expect(authed.ok).toBe(true);
		if (!authed.ok) return;
		const session = createViewerSession(authed.row.id, authed.row.user_id, authed.row.expires_at);
		expect(getViewerByToken(session)?.role).toBe('viewer');
		revokeGrant(1, created.grant.id);
		expect(getViewerByToken(session)).toBeNull();
		const events = listAudit(1).map((row) => row.event);
		expect(events).toContain('invite_created');
		expect(events).toContain('grant_revoked');
	});

	test('passworded invite load asks for a password; submit checks it', () => {
		const created = createGrant(1, {
			label: 'CPA',
			kind: 'viewer',
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [],
			ttlDays: 7,
			password: 'share-secret'
		});
		if ('error' in created) throw new Error(created.error);
		expect(inviteLanding(created.token)).toEqual({ expired: false, needsPassword: true, label: '' });

		const wrong = acceptViewerInvite(created.token, 'nope');
		expect(wrong.ok).toBe(false);
		if (!wrong.ok) {
			expect(wrong.status).toBe(401);
			expect(wrong.error).toBe('That link or password is not valid.');
		}

		const right = acceptViewerInvite(created.token, 'share-secret');
		expect(right.ok).toBe(true);
		if (right.ok) expect(getViewerByToken(right.session)?.role).toBe('viewer');

		const open = createGrant(1, {
			label: 'Bookkeeper',
			kind: 'viewer',
			dateFrom: '2025-01-01',
			dateTo: '2025-12-31',
			accountIds: [],
			ttlDays: 7
		});
		if ('error' in open) throw new Error(open.error);
		expect(inviteLanding(open.token)).toEqual({ expired: false, needsPassword: false, label: '' });
		const openSession = acceptViewerInvite(open.token, '');
		expect(openSession.ok).toBe(true);

		expect(inviteLanding('not-a-token').expired).toBe(true);
		revokeGrant(1, created.grant.id);
		expect(inviteLanding(created.token).expired).toBe(true);
	});

	test('pack links still reject a missing password and accept the right one', () => {
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
		const missing = resolveShareToken(created.token, null);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.status).toBe(401);
		const authed = resolveShareToken(created.token, 'pack-secret');
		expect(authed.ok).toBe(true);
		if (authed.ok) expect(authed.row.kind).toBe('pack');
		expect(inviteLanding(created.token).expired).toBe(true);
	});

	test('mutations are rejected for a viewer principal', () => {
		const event = {
			locals: { viewer: { grantId: 1, scope: { userId: 1, grantId: 1, dateFrom: '2025-01-01', dateTo: '2025-12-31', accountIds: [] } }, user: null },
			request: new Request('http://localhost/api/v1/transactions', { method: 'POST' }),
			route: { id: '/api/v1/transactions' }
		} as unknown as Parameters<typeof forbidViewerMutation>[0];
		let status = 0;
		try {
			forbidViewerMutation(event);
		} catch (err) {
			status = (err as { status?: number }).status ?? 0;
		}
		expect(status).toBe(403);
		const read = {
			...event,
			request: new Request('http://localhost/transactions', { method: 'GET' })
		} as unknown as Parameters<typeof forbidViewerMutation>[0];
		expect(() => forbidViewerMutation(read)).not.toThrow();
	});
});
