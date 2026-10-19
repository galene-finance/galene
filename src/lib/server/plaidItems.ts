/**
 * Per-item Plaid health (ADO-58). A login-required item is stored here so one
 * broken bank does not fail the whole connection, and so the UI can ask the
 * user to sign in again without showing a raw provider error code.
 */
import { createHash } from 'node:crypto';
import { db } from './db';
import { ownedIds } from './finance';

/**
 * Item error codes that only the account holder can clear, by signing in
 * again through Link update mode. Anything else is a plain item failure.
 */
export const RECONNECT_ERROR_CODES = [
	'ITEM_LOGIN_REQUIRED',
	'PENDING_EXPIRATION',
	'PENDING_DISCONNECT',
	'USER_PERMISSION_REVOKED',
	'USER_ACCOUNT_REVOKED',
	'ITEM_LOCKED'
] as const;

export type ReconnectErrorCode = (typeof RECONNECT_ERROR_CODES)[number];

/** Persisted health for one linked item. `needsReconnect` is the structural flag. */
export type PlaidItemState =
	| { needsReconnect: false; errorCode: null; errorAt: null }
	| { needsReconnect: true; errorCode: ReconnectErrorCode; errorAt: string };

export interface PlaidItemView {
	id: number;
	itemId: string;
	institutionName: string | null;
	state: PlaidItemState;
	accountNames: string[];
}

export function tokenHint(accessToken: string): string {
	return createHash('sha256').update(accessToken).digest('hex');
}

export function isReconnectCode(code: string | null | undefined): code is ReconnectErrorCode {
	return !!code && (RECONNECT_ERROR_CODES as readonly string[]).includes(code);
}

/** User-facing sentence. Never the raw error code. */
export function reconnectMessage(): string {
	return 'Your bank needs you to sign in again.';
}

interface ItemRow {
	id: number;
	item_id: string;
	token_hint: string;
	institution_name: string | null;
	error_code: string | null;
	error_at: string | null;
	needs_reconnect: number;
}

function stateFromRow(row: Pick<ItemRow, 'error_code' | 'error_at' | 'needs_reconnect'>): PlaidItemState {
	if (row.needs_reconnect === 1 && isReconnectCode(row.error_code) && row.error_at) {
		return { needsReconnect: true, errorCode: row.error_code, errorAt: row.error_at };
	}
	return { needsReconnect: false, errorCode: null, errorAt: null };
}

export function upsertPlaidItem(
	userId: number,
	connectionId: number,
	input: { accessToken: string; itemId: string; institutionName?: string | null }
): number {
	const hint = tokenHint(input.accessToken);
	const itemId = input.itemId.trim() || `unknown:${hint.slice(0, 12)}`;
	db()
		.query(
			`INSERT INTO plaid_items (user_id, connection_id, item_id, token_hint, institution_name, updated_at)
			 VALUES (?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (user_id, token_hint) DO UPDATE SET
			     connection_id = excluded.connection_id,
			     item_id = CASE WHEN excluded.item_id LIKE 'unknown:%' THEN plaid_items.item_id ELSE excluded.item_id END,
			     institution_name = COALESCE(excluded.institution_name, plaid_items.institution_name),
			     updated_at = datetime('now')`
		)
		.run(userId, connectionId, itemId, hint, input.institutionName?.trim() || null);
	const row = db()
		.query('SELECT id FROM plaid_items WHERE user_id = ? AND token_hint = ?')
		.get(userId, hint) as { id: number };
	return row.id;
}

export function recordItemFailure(
	userId: number,
	connectionId: number,
	accessToken: string,
	itemId: string,
	errorCode: string | null
): PlaidItemState {
	const id = upsertPlaidItem(userId, connectionId, { accessToken, itemId });
	const reconnect = isReconnectCode(errorCode);
	if (reconnect) {
		db()
			.query(
				`UPDATE plaid_items
				 SET error_code = ?, error_at = datetime('now'), needs_reconnect = 1, updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(errorCode, id, userId);
	} else {
		db()
			.query(
				`UPDATE plaid_items
				 SET error_code = ?, error_at = datetime('now'), needs_reconnect = 0, updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(errorCode, id, userId);
	}
	const row = db()
		.query('SELECT error_code, error_at, needs_reconnect FROM plaid_items WHERE id = ? AND user_id = ?')
		.get(id, userId) as ItemRow;
	return stateFromRow(row);
}

export function clearItemError(userId: number, itemRowId: number): void {
	const owned = ownedIds('plaid_items', userId, [itemRowId]);
	if (owned.length !== 1) return;
	db()
		.query(
			`UPDATE plaid_items
			 SET error_code = NULL, error_at = NULL, needs_reconnect = 0, updated_at = datetime('now')
			 WHERE id = ? AND user_id = ?`
		)
		.run(itemRowId, userId);
}

export function clearItemErrorByToken(userId: number, accessToken: string): void {
	db()
		.query(
			`UPDATE plaid_items
			 SET error_code = NULL, error_at = NULL, needs_reconnect = 0, updated_at = datetime('now')
			 WHERE user_id = ? AND token_hint = ?`
		)
		.run(userId, tokenHint(accessToken));
}

export function getItemById(userId: number, itemRowId: number): (ItemRow & { state: PlaidItemState }) | null {
	if (ownedIds('plaid_items', userId, [itemRowId]).length !== 1) return null;
	const row = db()
		.query(
			`SELECT id, item_id, token_hint, institution_name, error_code, error_at, needs_reconnect
			 FROM plaid_items WHERE id = ? AND user_id = ?`
		)
		.get(itemRowId, userId) as ItemRow | undefined;
	if (!row) return null;
	return { ...row, state: stateFromRow(row) };
}

export function accessTokenForItem(userId: number, itemRowId: number, tokens: string[]): string | null {
	const row = getItemById(userId, itemRowId);
	if (!row) return null;
	return tokens.find((token) => tokenHint(token) === row.token_hint) ?? null;
}

/** Drop stored rows whose tokens are gone, then return the remaining views. */
export function listPlaidItemViews(
	userId: number,
	connectionId: number,
	tokens: string[],
	accountNamesByExternal: Map<string, string[]>
): PlaidItemView[] {
	const hints = new Set(tokens.map(tokenHint));
	const rows = db()
		.query(
			`SELECT id, item_id, token_hint, institution_name, error_code, error_at, needs_reconnect
			 FROM plaid_items WHERE user_id = ? AND connection_id = ? ORDER BY id`
		)
		.all(userId, connectionId) as ItemRow[];
	for (const row of rows) {
		if (!hints.has(row.token_hint)) {
			db().query('DELETE FROM plaid_items WHERE id = ? AND user_id = ?').run(row.id, userId);
		}
	}
	const live = rows.filter((row) => hints.has(row.token_hint));
	return live.map((row) => ({
		id: row.id,
		itemId: row.item_id,
		institutionName: row.institution_name,
		state: stateFromRow(row),
		accountNames: accountNamesByExternal.get(row.item_id) ?? []
	}));
}

export function deletePlaidItem(userId: number, itemRowId: number): ItemRow | null {
	const row = getItemById(userId, itemRowId);
	if (!row) return null;
	db().query('DELETE FROM plaid_items WHERE id = ? AND user_id = ?').run(itemRowId, userId);
	return row;
}

/** Exhaustiveness helper: a reconnect-needed state must carry a known code. */
export function assertReconnectHandled(state: PlaidItemState): string | null {
	if (!state.needsReconnect) return null;
	switch (state.errorCode) {
		case 'ITEM_LOGIN_REQUIRED':
		case 'PENDING_EXPIRATION':
		case 'PENDING_DISCONNECT':
		case 'USER_PERMISSION_REVOKED':
		case 'USER_ACCOUNT_REVOKED':
		case 'ITEM_LOCKED':
			return reconnectMessage();
		default: {
			const _never: never = state.errorCode;
			return _never;
		}
	}
}
