import { randomBytes } from 'node:crypto';
import { db } from './db';
import { hashToken, tokenHint, verifyToken } from './tokenHash';
import type { User } from '$lib/types';
import { demoBlockedMessage, isDemoMode } from './demoMode';

/** Prefix so token lookups can be rejected before hitting the database. */
export const API_TOKEN_PREFIX = 'galene_';

export type ApiTokenScope = 'read' | 'write';

export interface ApiTokenInfo {
	id: number;
	name: string;
	scope: ApiTokenScope;
	created_at: string;
	last_used_at: string | null;
}

export interface ResolvedApiToken {
	user: User;
	tokenId: number;
	scope: ApiTokenScope;
}

/**
 * Create a token. Only the salted hash and a one-way hint are stored; the raw
 * token is returned to the caller for a one-time display in the UI and is
 * never written to the database.
 */
export function createApiToken(
	userId: number,
	name: string,
	scope: ApiTokenScope = 'read'
): { info: ApiTokenInfo; token: string } {
	if (isDemoMode()) throw new Error(demoBlockedMessage('API tokens'));
	if (scope !== 'read' && scope !== 'write') throw new Error('Token scope must be read or write.');
	const token = API_TOKEN_PREFIX + randomBytes(24).toString('hex');
	const { hint, salt, hash } = hashToken(token);
	const result = db()
		.query(
			'INSERT INTO api_tokens (user_id, name, token_hint, salt, token_hash, scope) VALUES (?, ?, ?, ?, ?, ?)'
		)
		.run(userId, name, hint, salt, hash, scope);
	const row = db()
		.query('SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE id = ?')
		.get(Number(result.lastInsertRowid)) as ApiTokenInfo;
	return { info: row, token };
}

export function listApiTokens(userId: number): ApiTokenInfo[] {
	return db()
		.query('SELECT id, name, scope, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at, id')
		.all(userId) as ApiTokenInfo[];
}

export function deleteApiToken(userId: number, id: number) {
	db().query('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(id, userId);
}

/**
 * Resolve an API token to its user. The raw token is hashed to a hint to
 * locate the row, then verified against the stored per-row salt + scrypt
 * hash. Updates last_used_at on success. Returns null for unknown or
 * malformed tokens.
 */
export function resolveApiToken(token: string): ResolvedApiToken | null {
	if (!token.startsWith(API_TOKEN_PREFIX)) return null;
	const row = db()
		.query(
			`SELECT u.id, u.name, u.email, u.is_admin, t.id AS token_id, t.salt, t.token_hash, t.scope
			 FROM api_tokens t
			 JOIN users u ON u.id = t.user_id
			 WHERE t.token_hint = ?`
		)
		.get(tokenHint(token)) as
		| {
				id: number;
				name: string;
				email: string;
				is_admin: number;
				token_id: number;
				salt: string;
				token_hash: string;
				scope: string;
		  }
		| undefined;
	if (!row || !verifyToken(token, row.salt, row.token_hash)) return null;
	db().query(`UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(row.token_id);
	const scope: ApiTokenScope = row.scope === 'write' ? 'write' : 'read';
	return {
		user: { id: row.id, name: row.name, email: row.email, is_admin: row.is_admin },
		tokenId: row.token_id,
		scope
	};
}

export function getUserByApiToken(token: string): User | null {
	return resolveApiToken(token)?.user ?? null;
}
