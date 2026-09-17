import type { BankProvider, ProviderAccount, ProviderContext, ProviderTransaction } from '$lib/types';
import { getSetting, setSetting } from '$lib/server/finance';
import { fetchJson, ProviderHttpError } from './http';

const NAME = 'Plaid';

// Plaid's field names differ across API versions (`transaction_id` in the
// current API vs `transactions_id`/`id` in older ones; `account_id` vs `id`;
// `type` as `{primary,subclass}` vs a flat string), so the parsers accept all.
interface PlaidAccount {
	id?: string;
	account_id?: string;
	name: string;
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
	account?: { id?: string };
	account_id?: string;
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

/**
 * Create a short-lived, one-time-use Link token for a user. The current Plaid
 * Link SDK (link-initialize.js) is token-based: the client secret never reaches
 * the browser, everything the widget needs is baked into the token.
 */
export async function createLinkToken(userId: number): Promise<string> {
	const cfg = getPlaidConfig(userId);
	if (!cfg.clientId || !cfg.clientSecret) {
		throw new ProviderHttpError(
			'Plaid is not configured yet — add your Plaid client id and secret below.'
		);
	}
	// The current Link SDK always returns a one-time public token (via the
	// onSuccess metadata); the old `request_public_token` field is no longer
	// recognized by the production API and is rejected as an unknown field.
	const body: Record<string, unknown> = {
		client_id: cfg.clientId,
		secret: cfg.clientSecret,
		client_name: 'Galene',
		user: { client_user_id: `galene-${userId}` },
		products: ['transactions'],
		country_codes: ['US'],
		language: 'en'
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
			// New bank from Plaid Link: the exchange is the validation — Plaid
			// rejects unknown or already-used public tokens.
			if (!ctx) throw new ProviderHttpError('Missing provider context.');
			const added = await exchangePublicToken(ctx.userId, publicToken);
			// Append to the tokens already stored for this connection so the
			// user can link multiple banks; dedupe if the same bank is re-linked.
			const tokens = accessTokens(ctx.existing ?? {});
			return { access_tokens: JSON.stringify(tokens.includes(added) ? tokens : [...tokens, added]) };
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
		const cfg = getPlaidConfig(context.userId);
		const tokens = accessTokens(context.credentials);
		if (tokens.length === 0) {
			throw new ProviderHttpError('No Plaid accounts are linked yet. Use "Link another account" to add one.');
		}
		// One /accounts/get call per linked bank (item); each is well under
		// Plaid's 15 req/min per-item limit.
		const accounts: ProviderAccount[] = [];
		for (const token of tokens) {
			const res = await plaidPost<{ accounts: PlaidAccount[] }>(cfg, token, '/accounts/get');
			for (const a of res.accounts) {
				const type = mapType(typeof a.type === 'string' ? a.type : a.type?.primary);
				accounts.push({
					external_id: a.account_id ?? a.id ?? '',
					name: a.name,
					type,
					balance_cents: plaidBalanceCents(a, type)
				});
			}
		}
		return accounts;
	},
	async fetchTransactions(since, ctx) {
		const context = ctxOrThrow(ctx);
		const cfg = getPlaidConfig(context.userId);
		const tokens = accessTokens(context.credentials);
		// Default to the last 90 days when there is no cursor yet.
		const start = since ?? new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
		// The current API requires both a start and an end date.
		const end = new Date().toISOString().slice(0, 10);
		const out: ProviderTransaction[] = [];
		for (const token of tokens) {
			out.push(...(await fetchItemTransactions(cfg, token, start, end)));
		}
		return out;
	}
};

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
		merchant: t.name ?? null
	}));
}
