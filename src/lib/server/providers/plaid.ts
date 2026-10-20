import type {
	BankProvider,
	PlaidAlreadyLinked,
	ProviderAccount,
	ProviderContext,
	ProviderTransaction
} from '../../types';
import { getSetting, setSetting } from '../finance';
import {
	clearItemErrorByToken,
	findDuplicatePlaidItem,
	isReconnectCode,
	recordItemFailure,
	setItemAccountExternalIds,
	tokenHint,
	upsertPlaidItem,
	type PlaidDuplicateMatch,
	type ReconnectErrorCode
} from '../plaidItems';
import { fetchJson, ProviderHttpError } from './http';

const NAME = 'Plaid';

// Plaid's field names differ across API versions (`transaction_id` in the
// current API vs `transactions_id`/`id` in older ones; `account_id` vs `id`;
// `type` as `{primary,subclass}` vs a flat string), so the parsers accept all.
interface PlaidAccount {
	id?: string;
	account_id?: string;
	name: string;
	mask?: string | null;
	subtype?: string | null;
	type: { primary?: string; subclass?: string } | string;
	balances?: {
		available?: number | null;
		current?: number | null;
	} | null;
}

interface PlaidTx {
	id?: string;
	transaction_id?: string;
	transactions_id?: string;
	date: string;
	amount: number;
	name?: string;
	original_description?: string | null;
	account?: { id?: string };
	account_id?: string;
	pending?: boolean;
	pending_transaction_id?: string | null;
}

/** Statement line when Plaid sent one. Otherwise the cleaned name. Blank is absent. */
export function plaidMerchant(tx: { name?: string | null; original_description?: string | null }): string | null {
	const statement = tx.original_description?.trim() ?? '';
	if (statement) return statement;
	const name = tx.name?.trim() ?? '';
	return name || null;
}

interface PlaidTxResponse {
	transactions: PlaidTx[];
	// 2020-09-14+ pagination
	total_transactions?: number;
	// 2020-09-06 pagination
	is_complete?: boolean;
	next_cursor?: string | null;
}

/**
 * Per-user Plaid configuration. Each user supplies their own client id and
 * secret (from their Plaid dashboard), stored in their settings — the server
 * no longer reads Plaid credentials from env variables.
 */
export interface PlaidConfig {
	clientId: string;
	clientSecret: string;
	/** 'sandbox' or 'production'. */
	env: string;
	/** Required for Plaid Link in sandbox (dashboard → Sandbox). */
	sandboxInstance: string;
}

// Plaid's current API has no version path prefix — the host encodes the
// environment. The old `api.plaid.com/plaid/api/2020-09-06` host no longer
// resolves (NXDOMAIN), which surfaced as "Could not reach Plaid".
export function plaidBase(env: string): string {
	return env === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com';
}

/** Read the user's saved Plaid config; empty strings when not set yet. */
export function getPlaidConfig(userId: number): PlaidConfig {
	return {
		clientId: getSetting(userId, 'plaid_client_id') ?? '',
		clientSecret: getSetting(userId, 'plaid_client_secret') ?? '',
		env: getSetting(userId, 'plaid_env') ?? 'sandbox',
		sandboxInstance: getSetting(userId, 'plaid_sandbox_instance') ?? ''
	};
}

/**
 * Client-safe view of the saved Plaid config. The client secret never reaches
 * the browser (it would sit in the SSR payload and DOM, where XSS or a shared
 * machine could steal it) — the form only needs to know whether one is stored,
 * so an empty secret field on save means "keep the existing one".
 */
export function plaidConfigForClient(userId: number): {
	clientId: string;
	env: string;
	sandboxInstance: string;
	secretConfigured: boolean;
} {
	const cfg = getPlaidConfig(userId);
	return {
		clientId: cfg.clientId,
		env: cfg.env,
		sandboxInstance: cfg.sandboxInstance,
		secretConfigured: cfg.clientSecret !== ''
	};
}

/**
 * Persist the user's Plaid config. Empty values clear the setting, so the user
 * can remove a credential. Returns the stored config.
 */
export function savePlaidConfig(userId: number, cfg: PlaidConfig): PlaidConfig {
	setSetting(userId, 'plaid_client_id', cfg.clientId);
	setSetting(userId, 'plaid_client_secret', cfg.clientSecret);
	setSetting(userId, 'plaid_env', cfg.env);
	setSetting(userId, 'plaid_sandbox_instance', cfg.sandboxInstance);
	return cfg;
}

/** True when the user has enough saved to sync an existing connection. */
export function plaidConfigured(userId: number): boolean {
	return !!getPlaidConfig(userId).clientId;
}

/** True when the user has everything needed to create new connections via Link. */
export function plaidLinkEnabled(userId: number): boolean {
	const cfg = getPlaidConfig(userId);
	if (!cfg.clientId || !cfg.clientSecret) return false;
	if (cfg.env !== 'production') return !!cfg.sandboxInstance;
	return true;
}

/**
 * The access tokens for every linked Plaid item (one per bank login), kept
 * as a JSON array string so the credentials record stays string-valued.
 * Falls back to the legacy single `access_token` field for connections made
 * before multi-bank support, so existing links keep working.
 */
export function accessTokensFromCredentials(creds: Record<string, string>): string[] {
	return accessTokens(creds);
}

/** Credential set with the access-token list replaced. Drops the legacy single-token field. */
export function replaceAccessTokens(creds: Record<string, string>, tokens: string[]): Record<string, string> {
	const next: Record<string, string> = { ...creds, access_tokens: JSON.stringify(tokens) };
	delete next.access_token;
	return next;
}

function accessTokens(creds: Record<string, string>): string[] {
	const raw = creds.access_tokens;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean);
		} catch {
			// malformed stored value; fall through to the legacy field
		}
	}
	const single = String(creds.access_token ?? '').trim();
	return single ? [single] : [];
}

/** Plaid error_code from a thrown provider error, when one was present. */
export function plaidErrorCode(error: unknown): string | null {
	if (error instanceof ProviderHttpError && error.code) return error.code;
	return null;
}

/** User-facing sync line for one item. Reconnect codes never leak the raw code. */
export function itemFailureMessage(code: string | null): string {
	if (isReconnectCode(code)) return 'A linked institution needs you to sign in again.';
	return 'One linked institution could not be synced. The others were updated.';
}

export class PlaidItemError extends Error {
	readonly code: string | null;
	readonly itemId: string;
	constructor(message: string, code: string | null, itemId: string) {
		super(message);
		this.code = code;
		this.itemId = itemId;
	}
}

/**
 * Create a short-lived, one-time-use Link token for a user. The current Plaid
 * Link SDK (link-initialize.js) is token-based: the client secret never reaches
 * the browser, everything the widget needs is baked into the token.
 */
/**
 * Create a short-lived Link token.
 * `accessToken` set means update mode: Plaid re-authenticates that existing
 * item and does not create a new one. Omit it to link a new institution.
 */
export async function createLinkToken(userId: number, accessToken?: string): Promise<string> {
	const cfg = getPlaidConfig(userId);
	if (!cfg.clientId || !cfg.clientSecret) {
		throw new ProviderHttpError(
			'Plaid is not configured yet — add your Plaid client id and secret below.'
		);
	}
	const updateMode = !!accessToken?.trim();
	// The current Link SDK always returns a one-time public token (via the
	// onSuccess metadata); the old `request_public_token` field is no longer
	// recognized by the production API and is rejected as an unknown field.
	// Update mode must not send products — Plaid rejects that combination.
	const body: Record<string, unknown> = {
		client_id: cfg.clientId,
		secret: cfg.clientSecret,
		client_name: 'Galene',
		user: { client_user_id: `galene-${userId}` },
		country_codes: ['US'],
		language: 'en',
		...(updateMode ? { access_token: accessToken!.trim() } : { products: ['transactions'] })
	};
	if (cfg.env !== 'production') {
		if (!cfg.sandboxInstance) {
			throw new ProviderHttpError(
				'Add your Plaid sandbox instance name (Plaid dashboard → Sandbox) to connect new accounts.'
			);
		}
		body.sandbox_instance_name = cfg.sandboxInstance;
	}
	const res = await fetchJson<{ link_token?: string }>(`${plaidBase(cfg.env)}/link/token/create`, NAME, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		authErrorMessage:
			'Plaid rejected the Link session request. Check your Plaid client id and secret below, then try again.'
	});
	const token = String(res.link_token ?? '').trim();
	if (!token) throw new ProviderHttpError('Plaid did not return a Link token. Try again.');
	return token;
}

/**
 * Plaid account type → Galene account type. Accepts both the older
 * `{primary,subclass}` primary values (DEPOSITS, CREDIT_CARD, …) and the newer
 * flat account-type strings (depository, credit, …).
 */
/**
 * Map Plaid account balances to Galene signed cents.
 * Plaid `current` (else `available`) is dollars; for credit/loan liabilities
 * Plaid reports a positive amount owed — flip to Galene's negative convention.
 */
function plaidBalanceCents(a: PlaidAccount, type: ProviderAccount['type']): number | null {
	const bal = a.balances;
	if (!bal) return null;
	const dollars = bal.current ?? bal.available;
	if (dollars == null || !Number.isFinite(dollars)) return null;
	const cents = Math.round(dollars * 100);
	return type === 'credit' ? -Math.abs(cents) : cents;
}

function mapType(primary: string | undefined): ProviderAccount['type'] {
	switch ((primary ?? '').toUpperCase()) {
		case 'DEPOSITS':
		case 'DEPOSITORY':
		case 'MORTGAGE':
		case 'LOAN':
			return 'bank';
		case 'CREDIT_CARD':
		case 'CREDIT':
			return 'credit';
		case 'CASH':
			return 'cash';
		case 'INVESTMENT':
		case 'BROKERAGE':
			return 'investment';
		default:
			return 'other';
	}
}

/**
 * POST to a Plaid data endpoint using one linked item's access token.
 * Requires the user's saved `plaid_client_id`.
 */
async function plaidPost<T>(cfg: PlaidConfig, accessToken: string, path: string, extra: Record<string, unknown> = {}): Promise<T> {
	if (!cfg.clientId) throw new ProviderHttpError('Plaid is not configured — add your client id in Settings → Bank sync.');
	if (!accessToken) throw new ProviderHttpError('This Plaid connection is missing an access token. Link the account again.');

	// The access token authenticates the item; client_id + secret identify the
	// app (Plaid accepts these in the body or the PLAID-CLIENT-ID/SECRET
	// headers — the body is the documented path).
	const body = {
		client_id: cfg.clientId,
		secret: cfg.clientSecret,
		access_token: accessToken,
		...extra
	};
	return fetchJson<T>(`${plaidBase(cfg.env)}${path}`, NAME, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`
		},
		body: JSON.stringify(body)
	});
}

function ctxOrThrow(ctx?: ProviderContext): ProviderContext {
	if (!ctx) throw new ProviderHttpError('Missing provider context.');
	return ctx;
}

/**
 * Exchange a one-time Plaid Link public token for the long-lived access
 * token that every later sync uses.
 *
 * Module-private on purpose. Callers must use `linkNewPlaidItem`, which runs
 * the duplicate-item guard before and after this exchange. Calling this
 * directly would store a second Item for a login that is already linked.
 */
async function exchangePublicToken(userId: number, publicToken: string): Promise<string> {
	const cfg = getPlaidConfig(userId);
	if (!cfg.clientId || !cfg.clientSecret) {
		throw new ProviderHttpError(
			'Plaid is not configured yet — add your Plaid client id and secret below.'
		);
	}
	const res = await fetchJson<{ access_token?: string }>(`${plaidBase(cfg.env)}/item/public_token/exchange`, NAME, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: cfg.clientId,
			secret: cfg.clientSecret,
			public_token: publicToken
		}),
		authErrorMessage:
			'Plaid rejected the token exchange. Check your Plaid client id and secret below, then try connecting again.'
	});
	const accessToken = String(res.access_token ?? '').trim();
	if (!accessToken) throw new ProviderHttpError('Plaid did not return an access token. Try connecting again.');
	return accessToken;
}

interface PlaidItemMeta {
	item?: { item_id?: string; institution_id?: string | null; error?: { error_code?: string } | null };
	institution?: { name?: string } | null;
}

/** item_id + display name for one access token. Name falls back to a generic label. */
export async function fetchItemIdentity(
	cfg: PlaidConfig,
	accessToken: string
): Promise<{
	itemId: string;
	institutionId: string | null;
	institutionName: string | null;
	errorCode: string | null;
}> {
	const res = await plaidPost<PlaidItemMeta>(cfg, accessToken, '/item/get');
	const itemId = String(res.item?.item_id ?? '').trim() || `unknown:${tokenHint(accessToken).slice(0, 12)}`;
	let institutionName: string | null = null;
	const institutionId = String(res.item?.institution_id ?? '').trim() || null;
	if (institutionId && cfg.clientId && cfg.clientSecret) {
		try {
			const inst = await fetchJson<{ institution?: { name?: string } }>(
				`${plaidBase(cfg.env)}/institutions/get_by_id`,
				NAME,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						client_id: cfg.clientId,
						secret: cfg.clientSecret,
						institution_id: institutionId,
						country_codes: ['US']
					})
				}
			);
			institutionName = inst.institution?.name?.trim() || null;
		} catch {
			institutionName = null;
		}
	}
	return { itemId, institutionId, institutionName, errorCode: res.item?.error?.error_code ?? null };
}

/** Ask Plaid to drop one item. A missing item is success — the local token is going either way. */
export async function listAccountExternalIdsForToken(userId: number, accessToken: string): Promise<string[]> {
	const cfg = getPlaidConfig(userId);
	const res = await plaidPost<{ accounts: PlaidAccount[] }>(cfg, accessToken, '/accounts/get');
	return (res.accounts ?? [])
		.map((a) => a.account_id ?? a.id ?? '')
		.filter(Boolean);
}

export async function removePlaidItem(userId: number, accessToken: string): Promise<void> {
	const cfg = getPlaidConfig(userId);
	try {
		await plaidPost(cfg, accessToken, '/item/remove');
	} catch (error) {
		const code = plaidErrorCode(error);
		if (code === 'ITEM_NOT_FOUND' || code === 'INVALID_ACCESS_TOKEN') return;
		throw error;
	}
}

/** Sandbox-only: force ITEM_LOGIN_REQUIRED on an item. Used by the acceptance test. */
export async function sandboxResetLogin(userId: number, accessToken: string): Promise<void> {
	const cfg = getPlaidConfig(userId);
	if (cfg.env === 'production') throw new ProviderHttpError('Login reset is only available in the Plaid sandbox.');
	await plaidPost(cfg, accessToken, '/sandbox/item/reset_login');
}

export interface PlaidConnectMetadata {
	institutionId: string | null;
	institutionName: string | null;
	accounts: { name: string | null; mask: string | null; type?: string | null; subtype?: string | null }[];
}

/** Parse the hidden JSON field the Link onSuccess handler posts with the public token. */
export function parsePlaidConnectMetadata(raw: unknown): PlaidConnectMetadata {
	const empty: PlaidConnectMetadata = { institutionId: null, institutionName: null, accounts: [] };
	if (raw == null) return empty;
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (!trimmed) return empty;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return empty;
		}
	}
	if (!parsed || typeof parsed !== 'object') return empty;
	const obj = parsed as Record<string, unknown>;
	const institution =
		obj.institution && typeof obj.institution === 'object'
			? (obj.institution as Record<string, unknown>)
			: obj;
	const institutionId = String(institution.institution_id ?? obj.institution_id ?? '').trim() || null;
	const institutionName = String(institution.name ?? obj.institution_name ?? '').trim() || null;
	const accountsRaw = Array.isArray(obj.accounts) ? obj.accounts : [];
	const accounts = accountsRaw.map((entry) => {
		const a = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
		return {
			name: String(a.name ?? '').trim() || null,
			mask: String(a.mask ?? '').trim() || null,
			type: String(a.type ?? '').trim() || null,
			subtype: String(a.subtype ?? '').trim() || null
		};
	});
	return { institutionId, institutionName, accounts };
}

function alreadyLinkedResult(dup: PlaidDuplicateMatch, exchanged = false): PlaidAlreadyLinked {
	return {
		alreadyLinked: true,
		exchanged,
		item: {
			id: dup.id,
			label: dup.institutionName?.trim() || 'A linked institution',
			needsReconnect: dup.needsReconnect
		}
	};
}

/**
 * The only way to turn a Link public token into a stored Plaid Item.
 * Pre-exchange: when Link sent an institution id, refuse a match before
 * `/item/public_token/exchange` (the public token stays unused).
 * Post-exchange: always read `/item/get` and `/accounts/get` and refuse a
 * match, then `/item/remove` the new access token before anything is stored.
 * `plaid_allow_duplicate=1` skips both checks (a second login at the same
 * institution). `exchangePublicToken` is not exported.
 */
export async function linkNewPlaidItem(
	userId: number,
	input: {
		publicToken: string;
		metadata?: unknown;
		allowDuplicate?: boolean;
		existingTokens?: string[];
	}
): Promise<{ access_tokens: string } | PlaidAlreadyLinked> {
	const allowDuplicate = input.allowDuplicate === true;
	const meta = parsePlaidConnectMetadata(input.metadata);
	if (!allowDuplicate && meta.institutionId) {
		const dup = findDuplicatePlaidItem(userId, {
			institutionId: meta.institutionId,
			accounts: meta.accounts
		});
		if (dup) return alreadyLinkedResult(dup);
	}
	const added = await exchangePublicToken(userId, input.publicToken);
	// Safety net for a missing or forged institution id: never store the new
	// item when /item/get + /accounts/get match a login that is already linked.
	if (!allowDuplicate) {
		const dup = await detectDuplicateAfterExchange(userId, added);
		if (dup) {
			await removePlaidItem(userId, added);
			return alreadyLinkedResult(dup, true);
		}
	}
	const merged = await mergeAccessToken(userId, input.existingTokens ?? [], added);
	return { access_tokens: JSON.stringify(merged) };
}

async function detectDuplicateAfterExchange(userId: number, accessToken: string): Promise<PlaidDuplicateMatch | null> {
	const cfg = getPlaidConfig(userId);
	const identity = await fetchItemIdentity(cfg, accessToken);
	if (!identity.institutionId) return null;
	const res = await plaidPost<{ accounts: PlaidAccount[] }>(cfg, accessToken, '/accounts/get');
	return findDuplicatePlaidItem(userId, {
		institutionId: identity.institutionId,
		accounts: (res.accounts ?? []).map((a) => ({
			name: a.name ?? null,
			mask: a.mask ?? null
		}))
	});
}

export function noteItemOutcome(
	userId: number,
	connectionId: number,
	accessToken: string,
	itemId: string,
	error: unknown | null
): ReconnectErrorCode | null {
	if (!error) {
		clearItemErrorByToken(userId, accessToken);
		upsertPlaidItem(userId, connectionId, { accessToken, itemId });
		return null;
	}
	const code = error instanceof PlaidItemError ? error.code : plaidErrorCode(error);
	recordItemFailure(userId, connectionId, accessToken, itemId, code);
	return isReconnectCode(code) ? code : null;
}

export const plaidProvider: BankProvider = {
	id: 'plaid',
	label: 'Plaid',
	description:
		'Sync from any Plaid-supported bank or credit union. Connect through Plaid Link: pick your bank and log in, and Galene stores the access it needs for future syncs. Link as many banks as you like — each one is added to the same connection and synced together.',
	// The public token arrives from the Link widget, not a visible input; the
	// connect form carries it in a hidden field.
	credentialFields: [{ key: 'public_token', label: 'Plaid public token', placeholder: '', secret: true }],
	isConfigured(userId?: number) {
		// The client id alone keeps existing connections syncing; the secret
		// (and sandbox instance name) are only needed to create new ones.
		return userId != null && plaidConfigured(userId);
	},
	// Plaid allows 15 req/min per item for /accounts/get and 30 req/min for
	// /transactions/get; a sync makes a handful of calls per linked bank, so
	// 15 minutes is far under either limit even with several banks.
	minSyncIntervalMinutes: 15,
	// Each Link session links one bank; pull its accounts in right away so the
	// user sees the newly linked bank without a second "Sync now" click.
	autoSyncOnConnect: true,
	async connect(c, ctx) {
		const publicToken = String(c.public_token ?? '').trim();
		if (publicToken) {
			// New bank from Plaid Link. Exchange only happens inside
			// linkNewPlaidItem, which always runs the duplicate guard.
			if (!ctx) throw new ProviderHttpError('Missing provider context.');
			return linkNewPlaidItem(ctx.userId, {
				publicToken,
				metadata: c.plaid_metadata,
				allowDuplicate: String(c.plaid_allow_duplicate ?? '').trim() === '1',
				existingTokens: accessTokens(ctx.existing ?? {})
			});
		}
		// The submitted form only carries a (possibly empty) public token; the
		// stored tokens live in ctx.existing. syncNow passes the stored
		// credentials as `c` with no `existing`, so fall back to that.
		const tokens = accessTokens(ctx?.existing ?? c);
		if (tokens.length === 0) throw new Error('Connect with Plaid Link to get started.');
		// Established connection: format check only, no network call — the
		// /accounts/get request during the sync is the real validation, and
		// Plaid's per-item rate limits make every extra call worth avoiding.
		return { access_tokens: JSON.stringify(tokens) };
	},
	async listAccounts(ctx) {
		const context = ctxOrThrow(ctx);
		return (await syncPlaidItems(context)).accounts;
	},
	async fetchTransactions(since, ctx) {
		const context = ctxOrThrow(ctx);
		// Default to the last 90 days when there is no cursor yet.
		const start = since ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
		return (await syncPlaidItems(context, start)).transactions;
	}
};

interface ItemSyncBundle {
	accounts: ProviderAccount[];
	transactions: ProviderTransaction[];
	/** True when at least one item failed and the caller should surface a soft error. */
	partialFailure: boolean;
	reconnectNeeded: boolean;
	/** Provider account ids from items that finished this run without error. */
	syncedAccountExternalIds: string[];
}

const itemSyncCache = new WeakMap<ProviderContext, Promise<ItemSyncBundle>>();

/**
 * Sync every linked item on its own. A failure is recorded on that item and
 * the loop continues, so one ITEM_LOGIN_REQUIRED bank cannot block the rest.
 * listAccounts and fetchTransactions share one pass per context object.
 */
async function syncPlaidItems(ctx: ProviderContext, since?: string): Promise<ItemSyncBundle> {
	const cached = itemSyncCache.get(ctx);
	if (cached) return cached;
	const pending = runItemSync(ctx, since);
	itemSyncCache.set(ctx, pending);
	return pending;
}

async function runItemSync(ctx: ProviderContext, since?: string): Promise<ItemSyncBundle> {
	const cfg = getPlaidConfig(ctx.userId);
	const allTokens = accessTokens(ctx.credentials);
	const only = ctx.onlyAccessTokens?.map((t) => t.trim()).filter(Boolean);
	const tokens = only?.length ? allTokens.filter((t) => only.includes(t)) : allTokens;
	if (allTokens.length === 0) {
		throw new ProviderHttpError('No Plaid accounts are linked yet. Use "Link another account" to add one.');
	}
	if (tokens.length === 0) {
		throw new ProviderHttpError('That linked institution was not found.');
	}
	const connectionId = ctx.connectionId;
	const start = since ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
	const end = new Date().toISOString().slice(0, 10);
	const accounts: ProviderAccount[] = [];
	const transactions: ProviderTransaction[] = [];
	const syncedAccountExternalIds: string[] = [];
	let partialFailure = false;
	let reconnectNeeded = false;

	for (const token of tokens) {
		let itemId = `unknown:${tokenHint(token).slice(0, 12)}`;
		try {
			if (connectionId != null) {
				try {
					const identity = await fetchItemIdentity(cfg, token);
					itemId = identity.itemId;
					upsertPlaidItem(ctx.userId, connectionId, {
						accessToken: token,
						itemId,
						institutionName: identity.institutionName,
						institutionId: identity.institutionId
					});
					if (isReconnectCode(identity.errorCode)) {
						recordItemFailure(ctx.userId, connectionId, token, itemId, identity.errorCode);
						partialFailure = true;
						reconnectNeeded = true;
						continue;
					}
				} catch (error) {
					const code = plaidErrorCode(error);
					if (isReconnectCode(code)) {
						recordItemFailure(ctx.userId, connectionId, token, itemId, code);
						partialFailure = true;
						reconnectNeeded = true;
						continue;
					}
					// A failed institution lookup must not skip /accounts/get.
				}
			}
			const res = await plaidPost<{ accounts: PlaidAccount[] }>(cfg, token, '/accounts/get');
			const itemAccountIds: string[] = [];
			for (const a of res.accounts) {
				const type = mapType(typeof a.type === 'string' ? a.type : a.type?.primary);
				const externalId = a.account_id ?? a.id ?? '';
				itemAccountIds.push(externalId);
				const mask = String(a.mask ?? '').trim() || null;
				const subtype =
					(typeof a.type === 'object' ? a.type?.subclass : null) ||
					String(a.subtype ?? '').trim() ||
					null;
				accounts.push({
					external_id: externalId,
					name: a.name,
					type,
					balance_cents: plaidBalanceCents(a, type),
					mask,
					subtype: subtype ? String(subtype).trim() || null : null
				});
			}
			transactions.push(...(await fetchItemTransactions(cfg, token, start, end)));
			syncedAccountExternalIds.push(...itemAccountIds.filter(Boolean));
			if (connectionId != null) {
				noteItemOutcome(ctx.userId, connectionId, token, itemId, null);
				setItemAccountExternalIds(ctx.userId, token, itemAccountIds);
			}
		} catch (error) {
			partialFailure = true;
			const code = plaidErrorCode(error);
			if (isReconnectCode(code)) reconnectNeeded = true;
			if (connectionId != null) {
				noteItemOutcome(ctx.userId, connectionId, token, itemId, new PlaidItemError(itemFailureMessage(code), code, itemId));
			} else if (tokens.length === 1) {
				throw error;
			}
		}
	}

	if (partialFailure && accounts.length === 0 && transactions.length === 0 && tokens.length > 0) {
		// Every item failed. Still throw so the connection is marked in error,
		// but the per-item rows already say which ones need a sign-in.
		throw new ProviderHttpError(
			reconnectNeeded
				? 'A linked institution needs you to sign in again.'
				: 'Plaid could not sync any linked institution. Try again in a moment.'
		);
	}
	return { accounts, transactions, partialFailure, reconnectNeeded, syncedAccountExternalIds };
}

/** Whether the last sync of this context had a per-item failure. */
export async function plaidSyncHadPartialFailure(ctx: ProviderContext): Promise<boolean> {
	const cached = itemSyncCache.get(ctx);
	if (!cached) return false;
	return (await cached).partialFailure;
}

/** Provider account ids that synced successfully in this context's Plaid pass. */
export async function plaidSyncedAccountExternalIds(ctx: ProviderContext): Promise<string[]> {
	const cached = itemSyncCache.get(ctx);
	if (!cached) return [];
	return (await cached).syncedAccountExternalIds;
}

/**
 * Pull one item's (bank's) transactions, following Plaid's pagination.
 *
 * Plaid's `amount` sign is the opposite of Galene's for every account type:
 * Plaid reports a positive amount when money leaves the account (a debit-card
 * purchase, a credit-card charge, a card payment, a bill) and a negative one
 * when money arrives (a direct deposit, a refund, a card payment's credit).
 * Galene stores positive = inflow, so every amount is flipped here. (Plaid
 * docs, /transactions/get: "Positive values when money moves out of the
 * account; negative values when money moves in.")
 */
/**
 * Keep one access token per Plaid item. A repeat Link of the same item
 * replaces that token instead of appending a second one.
 */
async function mergeAccessToken(userId: number, tokens: string[], added: string): Promise<string[]> {
	if (tokens.includes(added)) return tokens;
	let addedItemId = '';
	try {
		addedItemId = (await fetchItemIdentity(getPlaidConfig(userId), added)).itemId;
	} catch {
		return [...tokens, added];
	}
	const kept: string[] = [];
	let replaced = false;
	for (const token of tokens) {
		if (token === added) {
			replaced = true;
			kept.push(added);
			continue;
		}
		let same = false;
		try {
			same = (await fetchItemIdentity(getPlaidConfig(userId), token)).itemId === addedItemId;
		} catch {
			same = false;
		}
		if (same) {
			if (!replaced) kept.push(added);
			replaced = true;
		} else {
			kept.push(token);
		}
	}
	if (!replaced) kept.push(added);
	return kept;
}

async function fetchItemTransactions(cfg: PlaidConfig, accessToken: string, start: string, end: string): Promise<ProviderTransaction[]> {
	const out: PlaidTx[] = [];
	let offset = 0;
	let cursor: string | undefined;
	// Follow pagination until Plaid reports the set is complete (bounded).
	// The 2020-09-14 API pages with options.offset + total_transactions; the
	// older 2020-09-06 API used cursor + is_complete — support both.
	for (let i = 0; i < 50; i++) {
		const res = await plaidPost<PlaidTxResponse>(cfg, accessToken, '/transactions/get', {
			start_date: start,
			end_date: end,
			options: { count: 100, offset },
			...(cursor ? { cursor } : {})
		});
		out.push(...res.transactions);
		if (typeof res.total_transactions === 'number') {
			if (out.length >= res.total_transactions || res.transactions.length === 0) break;
			offset += res.transactions.length;
			continue;
		}
		if (res.is_complete) break;
		cursor = res.next_cursor ?? undefined;
		if (!cursor) break;
	}
	return out.map((t) => ({
		external_id: t.transaction_id ?? t.transactions_id ?? t.id ?? '',
		account_external_id: t.account_id ?? t.account?.id ?? '',
		date: t.date,
		amount_cents: -Math.round(Number(t.amount) * 100),
		merchant: plaidMerchant(t),
		pending: t.pending === true,
		pending_transaction_id: t.pending_transaction_id || null
	}));
}
