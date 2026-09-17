import type { BankProvider, ProviderAccount, ProviderContext, ProviderTransaction } from '$lib/types';
import { fetchJson, fetchText, ProviderHttpError } from './http';

const NAME = 'SimpleFIN';

/**
 * SimpleFIN protocol client (https://www.simplefin.org/protocol.html).
 *
 * The user generates a one-time **setup token** (a base64-encoded claim URL)
 * in their SimpleFIN or bank settings. We POST to the decoded URL exactly
 * once and receive a persistent **access URL** whose Basic-auth userinfo is
 * the long-lived credential; that URL replaces the setup token in the stored
 * credentials and is used for every later sync.
 *
 * One GET /accounts response carries the accounts and their recent
 * transactions, so a sync makes a single request (the SimpleFIN Bridge
 * allows 24 requests/day per access, so we keep each sync to one).
 */

interface SimpleFinTx {
	id: string;
	/** Unix seconds; 0 while the transaction is pending. */
	posted: number;
	/** Signed decimal string; positive = deposit. */
	amount: string;
	description?: string;
	payee?: string;
	memo?: string;
}

interface SimpleFinAccount {
	id: string;
	name: string;
	/** The protocol has no account type; negative balances are credit cards, loans, mortgages. */
	balance?: string | null;
	/** Unix seconds when balance became accurate (protocol `balance-date`). */
	'balance-date'?: number | null;
	transactions?: SimpleFinTx[];
}

interface SimpleFinError {
	code: string;
	msg: string;
}

interface AccountSet {
	errlist?: SimpleFinError[];
	errors?: string[];
	accounts?: SimpleFinAccount[];
}

/** The protocol's security checklist requires HTTPS-only requests. */
function claimUrlFromToken(token: string): string {
	const decoded = Buffer.from(token, 'base64').toString('utf8').trim();
	let url: URL;
	try {
		url = new URL(decoded);
	} catch {
		throw new ProviderHttpError(
			'That does not look like a SimpleFIN setup token. Paste the one-time token from your SimpleFIN (or bank) settings.'
		);
	}
	if (url.protocol !== 'https:') {
		throw new ProviderHttpError('SimpleFIN setup tokens must decode to an https URL; refusing to use this one.');
	}
	return url.toString();
}

/**
 * Format-check an access URL (https + Basic-auth userinfo). No network call —
 * the real validity check is the /accounts request made during a sync.
 */
function validateAccessUrl(
	accessUrl: string,
	message = 'This SimpleFIN access URL is malformed. Reconnect with a new setup token.'
): string {
	let parsed: URL;
	try {
		parsed = new URL(accessUrl);
	} catch {
		throw new ProviderHttpError(message);
	}
	if (parsed.protocol !== 'https:' || !parsed.username || !parsed.password) {
		throw new ProviderHttpError(message);
	}
	return accessUrl;
}

/**
 * Claim a setup token for its persistent access URL. A claim works exactly
 * once; a second or invalid claim answers 403 ("token may be compromised").
 */
async function claim(setupToken: string): Promise<string> {
	const claimUrl = claimUrlFromToken(setupToken);
	const accessUrl = (
		await fetchText(claimUrl, NAME, {
			method: 'POST',
			authErrorMessage:
				'This SimpleFIN setup token is invalid or has already been used. Generate a new one in your SimpleFIN settings and try again.'
		})
	).trim();
	return validateAccessUrl(accessUrl, 'SimpleFIN did not return a usable access URL. Try again with a fresh setup token.');
}

function accessFromCtx(ctx: ProviderContext): { url: string; username: string; password: string } {
	const accessUrl = String(ctx.credentials.access_url ?? '').trim();
	if (!accessUrl) {
		throw new ProviderHttpError('This SimpleFIN connection is missing its access URL. Reconnect with a new setup token.');
	}
	const valid = validateAccessUrl(accessUrl);
	const parsed = new URL(valid);
	return { url: valid.replace(/\/+$/, ''), username: parsed.username, password: parsed.password };
}

function basicAuth(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * The account set is cached briefly per connection so listAccounts and
 * fetchTransactions share one HTTP request per sync run.
 */
const recentSets = new Map<string, { at: number; set: AccountSet }>();
const CACHE_MS = 10 * 60000;

async function accountSet(ctx: ProviderContext, params: string): Promise<AccountSet> {
	const key = `${ctx.userId}:simplefin`;
	const cached = recentSets.get(key);
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.set;

	const { url, username, password } = accessFromCtx(ctx);
	const set = await fetchJson<AccountSet>(`${url}/accounts${params}`, NAME, {
		headers: { Authorization: basicAuth(username, password) },
		authErrorMessage:
			'Your SimpleFIN access was revoked or has expired. Generate a new setup token and reconnect.'
	});
	// The protocol reports problems in errlist; auth codes mean the stored
	// access URL no longer works at all.
	const authError = (set.errlist ?? []).find(
		(e) => (e.code ?? '').startsWith('con.auth') || (e.code ?? '').startsWith('gen.auth')
	);
	if (authError) {
		throw new ProviderHttpError(
			authError.msg || 'Your SimpleFIN connection needs attention. Reconnect with a new setup token.'
		);
	}
	recentSets.set(key, { at: Date.now(), set });
	return set;
}

/** Signed cents from SimpleFIN's decimal balance string; null when missing/invalid. */
function balanceCents(a: SimpleFinAccount): number | null {
	if (a.balance == null || a.balance === '') return null;
	const n = Number(a.balance);
	if (!Number.isFinite(n)) return null;
	return Math.round(n * 100);
}

/** UTC DB datetime from protocol balance-date (unix seconds); null when absent. */
function balanceAsOf(a: SimpleFinAccount): string | null {
	const ts = a['balance-date'];
	if (ts == null || !Number.isFinite(ts) || ts <= 0) return null;
	return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function mapType(a: SimpleFinAccount): ProviderAccount['type'] {
	return Number(a.balance) < 0 ? 'credit' : 'bank';
}

/** YYYY-MM-DD from a posted timestamp; null while the transaction is pending. */
function txDate(t: SimpleFinTx): string | null {
	if (!t.posted) return null;
	return new Date(t.posted * 1000).toISOString().slice(0, 10);
}

/**
 * The SimpleFIN Bridge limits each request to a 90-day window and defaults
 * to ~30 days of history; servers without date support ignore the parameters
 * and return their own window. We filter to `since` client-side either way.
 */
function dateParams(since?: string): string {
	const now = Date.now();
	let start = since ? Date.parse(`${since}T00:00:00Z`) : now - 90 * 86400000;
	start = Math.max(start, now - 90 * 86400000);
	return `?version=2&start-date=${Math.floor(start / 1000)}&end-date=${Math.floor(now / 1000)}`;
}

function ctxOrThrow(ctx?: ProviderContext): ProviderContext {
	if (!ctx) throw new ProviderHttpError('Missing provider context.');
	return ctx;
}

export const simplefinProvider: BankProvider = {
	id: 'simplefin',
	label: 'SimpleFIN',
	description:
		'Sync through the SimpleFIN protocol (SimpleFIN, its bridge, or any bank that implements it). Paste the one-time setup token from your settings; Galene exchanges it once for a private access URL it keeps for future syncs.',
	credentialFields: [
		{ key: 'token', label: 'SimpleFIN setup token', placeholder: 'Paste the one-time setup token…', secret: true }
	],
	// The bridge allows 24 requests/day per access; one request per sync, so
	// 12 syncs/day (2h) leaves headroom for manual syncs and retries.
	minSyncIntervalMinutes: 120,
	async connect(c) {
		// Established connection: the stored access URL is the long-lived
		// credential. Format-check only, with no network call, so the
		// per-sync validation step doesn't spend the bridge's 24 req/day
		// budget — the /accounts request during the sync is the real check.
		const accessUrl = String(c.access_url ?? '').trim();
		if (accessUrl) return { access_url: validateAccessUrl(accessUrl) };
		const token = String(c.token ?? '').trim();
		if (!token) throw new Error('Enter your SimpleFIN setup token.');
		return { access_url: await claim(token) };
	},
	async listAccounts(ctx) {
		const set = await accountSet(ctxOrThrow(ctx), dateParams());
		const accounts = set.accounts ?? [];
		if (accounts.length === 0) {
			const msg = (set.errlist ?? [])[0]?.msg ?? (set.errors ?? [])[0];
			if (msg) throw new ProviderHttpError(msg);
		}
		return accounts.map((a) => ({
			external_id: a.id,
			name: a.name,
			type: mapType(a),
			balance_cents: balanceCents(a),
			balance_as_of: balanceAsOf(a)
		}));
	},
	async fetchTransactions(since, ctx) {
		const set = await accountSet(ctxOrThrow(ctx), dateParams(since));
		const out: ProviderTransaction[] = [];
		for (const a of set.accounts ?? []) {
			for (const t of a.transactions ?? []) {
				const date = txDate(t);
				if (!date) continue; // pending (no posted date) — arrives when it posts
				if (since && date < since) continue;
				out.push({
					external_id: t.id,
					account_external_id: a.id,
					date,
					amount_cents: Math.round(parseFloat(t.amount) * 100),
					merchant: t.payee ?? t.description ?? null,
					notes: t.memo ?? null
				});
			}
		}
		return out;
	}
};
