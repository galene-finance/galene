import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { hashToken, tokenHint, verifyToken } from './tokenHash';

export type AdvisorKind = 'pack' | 'viewer';

export interface AdvisorGrant {
	id: number;
	user_id: number;
	label: string;
	kind: AdvisorKind;
	date_from: string;
	date_to: string;
	/** Empty means every account. */
	account_ids: number[];
	expires_at: string;
	revoked_at: string | null;
	created_at: string;
	has_password: boolean;
	active: boolean;
}

export interface GrantScope {
	userId: number;
	grantId: number;
	dateFrom: string;
	dateTo: string;
	accountIds: number[];
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isIsoDate(value: string): boolean {
	if (!DATE_RE.test(value)) return false;
	const [y, m, d] = value.split('-').map((n) => parseInt(n, 10));
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function yearRange(year: number): { dateFrom: string; dateTo: string } | null {
	if (!Number.isInteger(year) || year < 1970 || year > 2100) return null;
	return { dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` };
}

function parseAccountIds(raw: string | null): number[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
	} catch {
		return [];
	}
}

interface GrantRow {
	id: number;
	user_id: number;
	label: string;
	kind: string;
	date_from: string;
	date_to: string;
	account_ids: string | null;
	expires_at: string;
	revoked_at: string | null;
	created_at: string;
	password_hash: string | null;
}

function mapGrant(row: GrantRow): AdvisorGrant {
	const revoked = !!row.revoked_at;
	const expired = Date.parse(row.expires_at) <= Date.now();
	return {
		id: row.id,
		user_id: row.user_id,
		label: row.label,
		kind: row.kind === 'viewer' ? 'viewer' : 'pack',
		date_from: row.date_from,
		date_to: row.date_to,
		account_ids: parseAccountIds(row.account_ids),
		expires_at: row.expires_at,
		revoked_at: row.revoked_at,
		created_at: row.created_at,
		has_password: !!row.password_hash,
		active: !revoked && !expired
	};
}

export function listGrants(userId: number): AdvisorGrant[] {
	const rows = db()
		.query(
			`SELECT id, user_id, label, kind, date_from, date_to, account_ids, expires_at, revoked_at, created_at, password_hash
			 FROM advisor_grants WHERE user_id = ? ORDER BY id DESC`
		)
		.all(userId) as GrantRow[];
	return rows.map(mapGrant);
}

export function getGrant(userId: number, id: number): AdvisorGrant | null {
	const row = db()
		.query(
			`SELECT id, user_id, label, kind, date_from, date_to, account_ids, expires_at, revoked_at, created_at, password_hash
			 FROM advisor_grants WHERE user_id = ? AND id = ?`
		)
		.get(userId, id) as GrantRow | null;
	return row ? mapGrant(row) : null;
}

export function audit(userId: number, grantId: number | null, event: string, detail?: string) {
	db()
		.query('INSERT INTO advisor_audit (user_id, grant_id, event, detail) VALUES (?, ?, ?, ?)')
		.run(userId, grantId, event, detail ?? null);
}

export function listAudit(userId: number, limit = 40): { id: number; grant_id: number | null; event: string; detail: string | null; created_at: string }[] {
	return db()
		.query(
			`SELECT id, grant_id, event, detail, created_at FROM advisor_audit
			 WHERE user_id = ? ORDER BY id DESC LIMIT ?`
		)
		.all(userId, limit) as { id: number; grant_id: number | null; event: string; detail: string | null; created_at: string }[];
}

export function hashSharePassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 32).toString('hex');
	return `${salt}:${hash}`;
}

export function verifySharePassword(password: string, stored: string | null): boolean {
	if (!stored) return true;
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const candidate = scryptSync(password, salt, 32);
	const expected = Buffer.from(hash, 'hex');
	return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export interface CreateGrantInput {
	label: string;
	kind: AdvisorKind;
	dateFrom: string;
	dateTo: string;
	accountIds: number[];
	ttlDays: number;
	password?: string | null;
}

export function createGrant(
	userId: number,
	input: CreateGrantInput
): { grant: AdvisorGrant; token: string } | { error: string } {
	const label = input.label.trim();
	if (!label || label.length > 80) return { error: 'Label is required (80 characters max).' };
	if (input.kind !== 'pack' && input.kind !== 'viewer') return { error: 'Unknown grant type.' };
	if (!isIsoDate(input.dateFrom) || !isIsoDate(input.dateTo) || input.dateFrom > input.dateTo) {
		return { error: 'Choose a valid date range.' };
	}
	const ttl = Math.min(30, Math.max(1, Math.floor(input.ttlDays) || 14));
	const expiresAt = new Date(Date.now() + ttl * 24 * 3600 * 1000).toISOString();
	const token = randomBytes(32).toString('hex');
	const { hint, salt, hash } = hashToken(token);
	const password = input.password?.trim() ? hashSharePassword(input.password.trim()) : null;
	const ids = [...new Set(input.accountIds.filter((n) => Number.isInteger(n) && n > 0))];
	const result = db()
		.query(
			`INSERT INTO advisor_grants
			 (user_id, label, kind, date_from, date_to, account_ids, expires_at, token_hint, salt, token_hash, password_hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			userId,
			label,
			input.kind,
			input.dateFrom,
			input.dateTo,
			ids.length ? JSON.stringify(ids) : null,
			expiresAt,
			hint,
			salt,
			hash,
			password
		);
	const id = Number(result.lastInsertRowid);
	audit(userId, id, input.kind === 'viewer' ? 'invite_created' : 'grant_created', label);
	const grant = getGrant(userId, id);
	if (!grant) return { error: 'Could not create the grant.' };
	return { grant, token };
}

export function revokeGrant(userId: number, id: number): boolean {
	const grant = getGrant(userId, id);
	if (!grant || grant.revoked_at) return false;
	db().query(`UPDATE advisor_grants SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?`).run(id, userId);
	db().query('DELETE FROM viewer_sessions WHERE grant_id = ?').run(id);
	audit(userId, id, 'grant_revoked', grant.label);
	return true;
}

interface SecretRow {
	id: number;
	user_id: number;
	kind: string;
	date_from: string;
	date_to: string;
	account_ids: string | null;
	expires_at: string;
	revoked_at: string | null;
	salt: string;
	token_hash: string;
	password_hash: string | null;
}

function loadByToken(token: string): SecretRow | null {
	const row = db()
		.query(
			`SELECT id, user_id, kind, date_from, date_to, account_ids, expires_at, revoked_at, salt, token_hash, password_hash
			 FROM advisor_grants WHERE token_hint = ?`
		)
		.get(tokenHint(token)) as SecretRow | null;
	if (!row || !verifyToken(token, row.salt, row.token_hash)) return null;
	return row;
}

export function grantScopeFromRow(row: {
	id: number;
	user_id: number;
	date_from: string;
	date_to: string;
	account_ids: string | null;
}): GrantScope {
	return {
		userId: row.user_id,
		grantId: row.id,
		dateFrom: row.date_from,
		dateTo: row.date_to,
		accountIds: parseAccountIds(row.account_ids)
	};
}

/** Active grant matching the share token, or a reason it cannot be used. */
export function resolveShareToken(
	token: string,
	password: string | null
): { ok: true; row: SecretRow; scope: GrantScope } | { ok: false; status: 401 | 403 | 410 } {
	const row = loadByToken(token);
	if (!row) return { ok: false, status: 401 };
	if (row.revoked_at) return { ok: false, status: 410 };
	if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, status: 410 };
	if (row.password_hash && !verifySharePassword(password ?? '', row.password_hash)) {
		return { ok: false, status: 401 };
	}
	return { ok: true, row, scope: grantScopeFromRow(row) };
}

const VIEWER_SESSION_DAYS = 7;

export function createViewerSession(grantId: number, userId: number, grantExpiresAt: string): string {
	const token = randomBytes(32).toString('hex');
	const sessionEnd = Date.now() + VIEWER_SESSION_DAYS * 24 * 3600 * 1000;
	const grantEnd = Date.parse(grantExpiresAt);
	const expiresAt = new Date(Math.min(sessionEnd, grantEnd)).toISOString();
	const { hint, salt, hash } = hashToken(token);
	db()
		.query(
			`INSERT INTO viewer_sessions (token_hint, grant_id, user_id, salt, token_hash, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(hint, grantId, userId, salt, hash, expiresAt);
	return token;
}

export function destroyViewerSession(token: string) {
	db().query('DELETE FROM viewer_sessions WHERE token_hint = ?').run(tokenHint(token));
}

export interface ViewerPrincipal {
	role: 'viewer';
	userId: number;
	grantId: number;
	scope: GrantScope;
}

/** Resolve a viewer session cookie. Revoke and expiry both fail closed. */
export function getViewerByToken(token: string): ViewerPrincipal | null {
	const row = db()
		.query(
			`SELECT v.grant_id, v.user_id, v.salt, v.token_hash, v.expires_at AS session_expires,
			        g.date_from, g.date_to, g.account_ids, g.expires_at, g.revoked_at
			 FROM viewer_sessions v
			 JOIN advisor_grants g ON g.id = v.grant_id
			 WHERE v.token_hint = ?`
		)
		.get(tokenHint(token)) as
		| {
				grant_id: number;
				user_id: number;
				salt: string;
				token_hash: string;
				session_expires: string;
				date_from: string;
				date_to: string;
				account_ids: string | null;
				expires_at: string;
				revoked_at: string | null;
		  }
		| null;
	if (!row || !verifyToken(token, row.salt, row.token_hash)) return null;
	if (row.revoked_at) return null;
	if (Date.parse(row.session_expires) <= Date.now()) return null;
	if (Date.parse(row.expires_at) <= Date.now()) return null;
	return {
		role: 'viewer',
		userId: row.user_id,
		grantId: row.grant_id,
		scope: grantScopeFromRow({
			id: row.grant_id,
			user_id: row.user_id,
			date_from: row.date_from,
			date_to: row.date_to,
			account_ids: row.account_ids
		})
	};
}

/** Intersect a requested account list with the grant. Empty grant list means all accounts. */
export function scopeAccountIds(scope: GrantScope, requested: number[]): number[] {
	if (scope.accountIds.length === 0) return requested;
	if (requested.length === 0) return scope.accountIds;
	const allowed = new Set(scope.accountIds);
	return requested.filter((id) => allowed.has(id));
}

/** Clamp a date filter into the grant window. Returns null when the request is entirely outside. */
export function scopeDateRange(
	scope: GrantScope,
	from: string | null,
	to: string | null
): { dateFrom: string; dateTo: string } | null {
	const dateFrom = from && from > scope.dateFrom ? from : scope.dateFrom;
	const dateTo = to && to < scope.dateTo ? to : scope.dateTo;
	if (dateFrom > dateTo) return null;
	return { dateFrom, dateTo };
}
