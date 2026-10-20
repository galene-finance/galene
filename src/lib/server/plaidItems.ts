/**
 * Per-item Plaid health (ADO-58). A login-required item is stored here so one
 * broken bank does not fail the whole connection, and so the UI can ask the
 * user to sign in again without showing a raw provider error code.
 */
import { createHash } from 'node:crypto';
import { db } from './db';

type OwnedTable = 'transactions' | 'scheduled' | 'accounts' | 'categories' | 'tags' | 'budgets' | 'plaid_items';

/**
 * Positive ids that belong to this user in a user-scoped table.
 * Foreign or invalid ids are dropped — callers must never mutate them.
 * Lives here (not finance.ts) so finance can call Plaid helpers without a cycle.
 */
export function ownedIds(table: OwnedTable, userId: number, ids: number[]): number[] {
	const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
	if (unique.length === 0) return [];
	return (
		db()
			.query(
				`SELECT id FROM ${table} WHERE user_id = ? AND id IN (${unique.map(() => '?').join(',')})`
			)
			.all(userId, ...unique) as { id: number }[]
	).map((row) => row.id);
}

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

/** Incoming Link metadata (or post-exchange /accounts/get) used to detect a duplicate item. */
export interface PlaidDuplicateAccountHint {
	name?: string | null;
	mask?: string | null;
	subtype?: string | null;
}

export interface PlaidDuplicateMatch {
	id: number;
	itemId: string;
	institutionName: string | null;
	needsReconnect: boolean;
}

/** Persist institution id and name once /item/get (or a sync) has them. */
export function setPlaidItemInstitution(
	userId: number,
	itemRowId: number,
	institutionId: string | null,
	institutionName?: string | null
): void {
	const id = institutionId?.trim() || null;
	if (!id) return;
	if (ownedIds('plaid_items', userId, [itemRowId]).length !== 1) return;
	db()
		.query(
			`UPDATE plaid_items
			 SET institution_id = ?,
			     institution_name = COALESCE(?, institution_name),
			     updated_at = datetime('now')
			 WHERE id = ? AND user_id = ? AND institution_id IS NULL`
		)
		.run(id, institutionName?.trim() || null, itemRowId, userId);
}

/** This user's Plaid items that still have no institution_id (upgraded volumes). */
export function listPlaidItemsMissingInstitution(userId: number): { id: number; tokenHint: string }[] {
	return (
		db()
			.query(
				`SELECT id, token_hint AS tokenHint FROM plaid_items
				 WHERE user_id = ? AND institution_id IS NULL
				 ORDER BY id`
			)
			.all(userId) as { id: number; tokenHint: string }[]
	);
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
	institution_id: string | null;
	error_code: string | null;
	error_at: string | null;
	needs_reconnect: number;
	account_external_ids: string | null;
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
	input: {
		accessToken: string;
		itemId: string;
		institutionName?: string | null;
		institutionId?: string | null;
	}
): number {
	const hint = tokenHint(input.accessToken);
	const itemId = input.itemId.trim() || `unknown:${hint.slice(0, 12)}`;
	const institutionId = input.institutionId?.trim() || null;
	db()
		.query(
			`INSERT INTO plaid_items (user_id, connection_id, item_id, token_hint, institution_name, institution_id, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
			 ON CONFLICT (user_id, token_hint) DO UPDATE SET
			     connection_id = excluded.connection_id,
			     item_id = CASE WHEN excluded.item_id LIKE 'unknown:%' THEN plaid_items.item_id ELSE excluded.item_id END,
			     institution_name = COALESCE(excluded.institution_name, plaid_items.institution_name),
			     institution_id = COALESCE(excluded.institution_id, plaid_items.institution_id),
			     updated_at = datetime('now')`
		)
		.run(userId, connectionId, itemId, hint, input.institutionName?.trim() || null, institutionId);
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
	if (ownedIds('plaid_items', userId, [itemRowId]).length !== 1) return;
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


/** Remember which provider account ids belong to this item after a successful sync. */
export function setItemAccountExternalIds(userId: number, accessToken: string, externalIds: string[]): void {
	const unique = [...new Set(externalIds.map((id) => id.trim()).filter(Boolean))].sort();
	db()
		.query(
			`UPDATE plaid_items
			 SET account_external_ids = ?, updated_at = datetime('now')
			 WHERE user_id = ? AND token_hint = ?`
		)
		.run(JSON.stringify(unique), userId, tokenHint(accessToken));
}

export function parseAccountExternalIds(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.map((v) => String(v)).filter(Boolean);
	} catch {
		return [];
	}
}

function normalizeHint(value: string | null | undefined): string {
	return (value ?? '').trim().toLowerCase();
}

function hasNameAndMask(account: { name?: string | null; mask?: string | null }): boolean {
	return !!normalizeHint(account.name) && !!normalizeHint(account.mask);
}

/**
 * Existing linked item that matches a new Link of the same institution.
 * Same user + institution_id, then name+mask on any of that item's accounts
 * (via account_external_ids). When incoming name/mask is missing, or the
 * stored item has no masks yet, institution_id alone is enough.
 * Items whose institution_id is still NULL are not considered here — the
 * duplicate guard resolves those first, then uses the name fallback below.
 */
export function findDuplicatePlaidItem(
	userId: number,
	input: { institutionId?: string | null; accounts?: PlaidDuplicateAccountHint[] | null }
): PlaidDuplicateMatch | null {
	const institutionId = (input.institutionId ?? '').trim();
	if (!institutionId) return null;
	const incoming = input.accounts ?? [];
	const items = db()
		.query(
			`SELECT id, item_id, institution_name, institution_id, needs_reconnect, error_code, error_at, account_external_ids
			 FROM plaid_items WHERE user_id = ? AND institution_id = ?
			 ORDER BY id`
		)
		.all(userId, institutionId) as ItemRow[];
	const incomingComparable = incoming.filter(hasNameAndMask);
	for (const item of items) {
		const externalIds = parseAccountExternalIds(item.account_external_ids);
		const stored = accountsForExternalIds(userId, externalIds);
		const storedComparable = stored.filter(hasNameAndMask);
		if (incomingComparable.length === 0 || storedComparable.length === 0) {
			return matchFromItem(item);
		}
		const matched = incomingComparable.some((incomingAccount) =>
			storedComparable.some(
				(storedAccount) =>
					normalizeHint(storedAccount.name) === normalizeHint(incomingAccount.name) &&
					normalizeHint(storedAccount.mask) === normalizeHint(incomingAccount.mask)
			)
		);
		if (matched) return matchFromItem(item);
	}
	return null;
}

/**
 * Fallback when /item/get could not fill institution_id (Plaid error, missing
 * token, or network). Match institution name (case-insensitive, trimmed) plus
 * account name + mask + subtype on that item's accounts.
 * Upgraded volumes may also have NULL accounts.mask and accounts.subtype. When
 * both are NULL, the account name alone is enough together with the institution
 * name. Items that already have an institution_id stay on findDuplicatePlaidItem.
 */
export function findDuplicateUnresolvedPlaidItem(
	userId: number,
	input: {
		institutionName?: string | null;
		accounts?: PlaidDuplicateAccountHint[] | null;
	}
): PlaidDuplicateMatch | null {
	const institutionName = normalizeHint(input.institutionName);
	if (!institutionName) return null;
	const incoming = input.accounts ?? [];
	const items = db()
		.query(
			`SELECT id, item_id, institution_name, institution_id, needs_reconnect, error_code, error_at, account_external_ids
			 FROM plaid_items
			 WHERE user_id = ? AND institution_id IS NULL
			 ORDER BY id`
		)
		.all(userId) as ItemRow[];
	for (const item of items) {
		if (normalizeHint(item.institution_name) !== institutionName) continue;
		const stored = accountsForExternalIds(userId, parseAccountExternalIds(item.account_external_ids));
		const matched = incoming.some((incomingAccount) =>
			stored.some((storedAccount) => unresolvedAccountMatches(incomingAccount, storedAccount))
		);
		if (matched) return matchFromItem(item);
	}
	return null;
}

/** Name, and mask + subtype when the stored account has them. */
function unresolvedAccountMatches(
	incoming: PlaidDuplicateAccountHint,
	stored: { name: string; mask: string | null; subtype: string | null }
): boolean {
	if (!normalizeHint(stored.name) || normalizeHint(stored.name) !== normalizeHint(incoming.name)) return false;
	const storedMask = normalizeHint(stored.mask);
	const storedSubtype = normalizeHint(stored.subtype);
	// Both empty: the upgraded row never stored a mask or subtype, so the
	// institution name plus the account name is the whole comparison.
	if (!storedMask && !storedSubtype) return true;
	if (storedMask && storedMask !== normalizeHint(incoming.mask)) return false;
	if (storedSubtype && storedSubtype !== normalizeHint(incoming.subtype)) return false;
	return true;
}

function matchFromItem(item: ItemRow): PlaidDuplicateMatch {
	return {
		id: item.id,
		itemId: item.item_id,
		institutionName: item.institution_name,
		needsReconnect: stateFromRow(item).needsReconnect
	};
}

function accountsForExternalIds(
	userId: number,
	externalIds: string[]
): { name: string; mask: string | null; subtype: string | null }[] {
	if (externalIds.length === 0) return [];
	const placeholders = externalIds.map(() => '?').join(',');
	return db()
		.query(
			`SELECT name, mask, subtype FROM accounts
			 WHERE user_id = ? AND provider = 'plaid' AND external_id IN (${placeholders})`
		)
		.all(userId, ...externalIds) as { name: string; mask: string | null; subtype: string | null }[];
}

/** Drop one provider account id from every item that lists it (user-scoped). */
export function dropAccountExternalIdFromPlaidItems(userId: number, externalId: string): void {
	const id = externalId.trim();
	if (!id) return;
	const items = db()
		.query('SELECT id, account_external_ids FROM plaid_items WHERE user_id = ?')
		.all(userId) as { id: number; account_external_ids: string | null }[];
	for (const item of items) {
		const ids = parseAccountExternalIds(item.account_external_ids);
		if (!ids.includes(id)) continue;
		const next = ids.filter((value) => value !== id);
		db()
			.query(
				`UPDATE plaid_items
				 SET account_external_ids = ?, updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(JSON.stringify(next), item.id, userId);
	}
}

/** Close open sync-review rows for orphans on these Galene account ids (user-scoped). */
export function closeOpenReviewsForAccounts(userId: number, accountIds: number[]): number {
	const ids = [...new Set(accountIds.filter((id) => Number.isFinite(id) && id > 0))];
	if (ids.length === 0) return 0;
	const placeholders = ids.map(() => '?').join(',');
	const result = db()
		.query(
			`UPDATE sync_review_items
			 SET status = 'dismissed', resolved_at = datetime('now')
			 WHERE user_id = ? AND status = 'open'
			   AND orphan_transaction_id IN (
			     SELECT id FROM transactions WHERE user_id = ? AND account_id IN (${placeholders})
			   )`
		)
		.run(userId, userId, ...ids);
	return Number(result.changes ?? 0);
}

/** Galene account ids whose provider external_id is in the given set. */
export function accountIdsForExternalIds(userId: number, externalIds: string[]): number[] {
	const ids = [...new Set(externalIds.map((id) => id.trim()).filter(Boolean))];
	if (ids.length === 0) return [];
	const placeholders = ids.map(() => '?').join(',');
	const rows = db()
		.query(
			`SELECT id FROM accounts
			 WHERE user_id = ? AND provider = 'plaid' AND external_id IN (${placeholders})`
		)
		.all(userId, ...ids) as { id: number }[];
	return rows.map((r) => r.id);
}

/**
 * One-shot cleanup: dismiss open review items for accounts that belong to a
 * reconnect-needed item, or whose external_id is not on any remaining item.
 * Safe, user-scoped UPDATEs only (no DELETE of transactions/accounts).
 */
export function cleanupStalePlaidSyncReviews(): number {
	const users = db().query('SELECT DISTINCT user_id FROM plaid_items').all() as { user_id: number }[];
	let closed = 0;
	for (const { user_id: userId } of users) {
		const items = db()
			.query(
				`SELECT needs_reconnect, account_external_ids FROM plaid_items WHERE user_id = ?`
			)
			.all(userId) as { needs_reconnect: number; account_external_ids: string | null }[];
		const liveExternal = new Set<string>();
		const brokenExternal = new Set<string>();
		for (const item of items) {
			const ids = parseAccountExternalIds(item.account_external_ids);
			for (const id of ids) {
				liveExternal.add(id);
				if (item.needs_reconnect === 1) brokenExternal.add(id);
			}
		}
		if (brokenExternal.size) {
			closed += closeOpenReviewsForAccounts(userId, accountIdsForExternalIds(userId, [...brokenExternal]));
		}
		// Accounts still marked plaid but no longer on any item (removed item).
		const orphans = db()
			.query(
				`SELECT id, external_id FROM accounts
				 WHERE user_id = ? AND provider = 'plaid' AND external_id IS NOT NULL AND external_id != ''`
			)
			.all(userId) as { id: number; external_id: string }[];
		const removedAccountIds = orphans
			.filter((a) => liveExternal.size > 0 && !liveExternal.has(a.external_id))
			.map((a) => a.id);
		if (removedAccountIds.length) {
			closed += closeOpenReviewsForAccounts(userId, removedAccountIds);
		}
	}
	return closed;
}

export function getItemById(userId: number, itemRowId: number): (ItemRow & { state: PlaidItemState }) | null {
	if (ownedIds('plaid_items', userId, [itemRowId]).length !== 1) return null;
	const row = db()
		.query(
			`SELECT id, item_id, token_hint, institution_name, institution_id, error_code, error_at, needs_reconnect, account_external_ids
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
			`SELECT id, item_id, token_hint, institution_name, institution_id, error_code, error_at, needs_reconnect, account_external_ids
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

/** Plain-language line when the item needs a sign-in. Null when it is healthy. */
export function assertReconnectHandled(state: PlaidItemState): string | null {
	if (!state.needsReconnect) return null;
	return isReconnectCode(state.errorCode) ? reconnectMessage() : null;
}
