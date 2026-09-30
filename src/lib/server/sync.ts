import { Database } from 'bun:sqlite';
import { db } from './db';
import { getProvider } from './providers';
import { applyCategorizationRules } from './finance';
import { notifySyncFailed, notifySyncRecovered } from './notifications';
import type { Connection, LinkedAccount, SyncSummary } from '$lib/types';

interface ConnectionRow {
	id: number;
	user_id: number;
	provider: string;
	credentials: string;
	status: 'connected' | 'error';
	last_synced_at: string | null;
	last_error: string | null;
	sync_interval_minutes: number | null;
	next_sync_at: string | null;
}

function rowToConnection(row: ConnectionRow): Connection {
	return {
		id: row.id,
		provider: row.provider,
		status: row.status,
		last_synced_at: row.last_synced_at,
		last_error: row.last_error,
		sync_interval_minutes: row.sync_interval_minutes,
		next_sync_at: row.next_sync_at
	};
}

export function listConnections(userId: number): Connection[] {
	const rows = db()
		.query(
			'SELECT id, provider, status, last_synced_at, last_error, sync_interval_minutes, next_sync_at FROM connections WHERE user_id = ? ORDER BY provider'
		)
		.all(userId) as ConnectionRow[];
	return rows.map(rowToConnection);
}

/** UTC "YYYY-MM-DD HH:MM:SS" — the format stored for time columns (sortable as text). */
export function dbTime(d: Date): string {
	return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** 'YYYY-MM-DD' shifted by a (possibly negative) number of days, UTC. */
function shiftDate(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Providers re-issue a transaction under a new external id when it changes —
 * most visibly when a pending charge clears (the posted copy gets a fresh id
 * and the old one disappears from the response), but also on plain
 * corrections to name or amount. The re-issued copy can be dated a few days
 * after the original, so the orphan↔live date match window reaches back this
 * far and the orphan sweep below can pair the two copies.
 */
const REPOST_WINDOW_DAYS = 7;

/**
 * Fetch lookback for building liveIds. Must be at least REPOST_WINDOW_DAYS so
 * a settled replacement still in the feed can claim an auth orphan whose
 * calendar date has aged just outside the rolling match window. Going twice
 * the match window means absence from liveIds is meaningful for every orphan
 * date we might merge — we do not treat "not in this response" as gone for
 * rows older than the fetch (that would false-orphan still-valid history).
 */
const REPOST_FETCH_LOOKBACK_DAYS = REPOST_WINDOW_DAYS * 2;

/**
 * When several live same-merchant rows sit in the match window, an orphan is
 * folded only into a clear winner. Amount band (auth→adjust grocery pattern):
 * abs(delta) must be ≤ max(ORPHAN_AMOUNT_ABS_CENTS, pct of |orphan|).
 * Rank: closest amount, then same calendar day, then closest created_at.
 * A sole same-merchant or exact-amount match still folds without the band
 * (#45). When several qualify, merchant-only rows need the band and must beat
 * the runner-up on amount, calendar day, or created_at (#125).
 */
const ORPHAN_AMOUNT_PCT = 15;
const ORPHAN_AMOUNT_ABS_CENTS = 2500;

function getConnection(userId: number, provider: string): ConnectionRow | null {
	const row = db()
		.query('SELECT * FROM connections WHERE user_id = ? AND provider = ?')
		.get(userId, provider) as ConnectionRow | undefined;
	return row ?? null;
}

/**
 * Save a provider connection (upsert). The provider validates the credentials
 * and throws with a user-facing message when they are bad. If it returns a
 * replacement credential set (e.g. SimpleFIN's setup token exchanged for an
 * access URL), that is what gets stored.
 */
export async function connect(userId: number, providerId: string, credentials: Record<string, string>): Promise<void> {
	const provider = getProvider(providerId);
	if (!provider) throw new Error('Unknown provider.');
	// Hand the provider the credentials it already stores (if any) so it can
	// merge new ones in instead of clobbering them — Plaid keeps one access
	// token per linked bank in a list and appends to it on each Link.
	const row = getConnection(userId, providerId);
	const existing = row ? (JSON.parse(row.credentials) as Record<string, string>) : {};
	const result = await provider.connect(credentials, { userId, credentials, existing });
	const stored = result && typeof result === 'object' ? result : credentials;
	db()
		.query(
			`INSERT INTO connections (user_id, provider, credentials, status) VALUES (?, ?, ?, 'connected')
			 ON CONFLICT (user_id, provider) DO UPDATE SET
			     credentials = excluded.credentials,
			     status = 'connected',
			     last_error = NULL`
		)
		.run(userId, providerId, JSON.stringify(stored));
}

/**
 * Set a connection's auto-sync cadence (minutes, or null for manual only).
 * Scheduling the next run happens here so a new cadence takes effect at the
 * next scheduler tick rather than immediately.
 */
export function setSyncInterval(userId: number, providerId: string, minutes: number | null): void {
	const conn = getConnection(userId, providerId);
	if (!conn) throw new Error('Connect to the provider first.');
	const next =
		minutes == null ? null : dbTime(new Date(Date.now() + minutes * 60000));
	db()
		.query('UPDATE connections SET sync_interval_minutes = ?, next_sync_at = ? WHERE id = ? AND user_id = ?')
		.run(minutes, next, conn.id, userId);
}

/**
 * Remove the connection. Imported accounts and transactions stay in the app
 * (they become regular data); deleting a linked account removes its transactions.
 */
export function disconnect(userId: number, providerId: string) {
	db().query('DELETE FROM connections WHERE user_id = ? AND provider = ?').run(userId, providerId);
}

/**
 * Pull the provider's accounts and transactions into Galene. Accounts are
 * matched by (provider, external_id); transactions are deduped the same way,
 * so re-syncing adds new items and updates changed ones without duplicating.
 */
export async function syncNow(userId: number, providerId: string): Promise<SyncSummary | { error: string }> {
	const conn = getConnection(userId, providerId);
	if (!conn) return { error: 'Connect to the provider first.' };
	const provider = getProvider(providerId)!;
	const providerLabel = provider.label;
	const credentials = JSON.parse(conn.credentials) as Record<string, string>;
	const ctx = { userId, credentials };
	const wasInError = conn.status === 'error';
	try {
		await provider.connect(credentials, ctx);

		const providerAccounts = await provider.listAccounts(ctx);
		const accountMap = new Map<string, number>();
		// Stamp used when the provider omits balance-as-of but reports a balance.
		const fetchedAt = dbTime(new Date());
		for (const pa of providerAccounts) {
			const existing = db()
				.query('SELECT id, name_locked FROM accounts WHERE user_id = ? AND provider = ? AND external_id = ?')
				.get(userId, providerId, pa.external_id) as { id: number; name_locked: number } | undefined;
			// Persist last provider balance when present (issue #45). Leave prior
			// values alone if this response has no balance — never invent one.
			const hasBalance = pa.balance_cents != null && Number.isFinite(pa.balance_cents);
			const providerBalanceCents = hasBalance ? Math.round(pa.balance_cents!) : null;
			const providerBalanceAsOf = hasBalance
				? (pa.balance_as_of && String(pa.balance_as_of).trim()) || fetchedAt
				: null;
			if (existing) {
				// The provider is the source of truth for the account's type and its
				// own name (source_name). A user-chosen display name (name_locked)
				// is preserved; otherwise the display name tracks the provider.
				if (existing.name_locked) {
					if (hasBalance) {
						db()
							.query(
								`UPDATE accounts SET source_name = ?, type = ?,
								 provider_balance_cents = ?, provider_balance_as_of = ?
								 WHERE id = ? AND user_id = ?`
							)
							.run(pa.name, pa.type, providerBalanceCents, providerBalanceAsOf, existing.id, userId);
					} else {
						db()
							.query('UPDATE accounts SET source_name = ?, type = ? WHERE id = ? AND user_id = ?')
							.run(pa.name, pa.type, existing.id, userId);
					}
				} else if (hasBalance) {
					db()
						.query(
							`UPDATE accounts SET source_name = ?, type = ?, name = ?,
							 provider_balance_cents = ?, provider_balance_as_of = ?
							 WHERE id = ? AND user_id = ?`
						)
						.run(
							pa.name,
							pa.type,
							pa.name,
							providerBalanceCents,
							providerBalanceAsOf,
							existing.id,
							userId
						);
				} else {
					db()
						.query('UPDATE accounts SET source_name = ?, type = ?, name = ? WHERE id = ? AND user_id = ?')
						.run(pa.name, pa.type, pa.name, existing.id, userId);
				}
				accountMap.set(pa.external_id, existing.id);
			} else {
				const result = db()
					.query(
						`INSERT INTO accounts (user_id, name, type, provider, external_id, source_name, name_locked,
						 provider_balance_cents, provider_balance_as_of)
						 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
					)
					.run(
						userId,
						pa.name,
						pa.type,
						providerId,
						pa.external_id,
						pa.name,
						providerBalanceCents,
						providerBalanceAsOf
					);
				accountMap.set(pa.external_id, Number(result.lastInsertRowid));
			}
		}

		// Incremental sync: only ask the provider for transactions dated on or
		// after the newest one we already imported (undefined = full fetch).
		// The window reaches REPOST_FETCH_LOOKBACK_DAYS before the newest date
		// so liveIds covers every orphan date we might merge (providers re-post
		// under a new id up to REPOST_WINDOW_DAYS later; absence from liveIds
		// then means the old id is truly gone, not merely outside the fetch).
		const maxRow = db()
			.query('SELECT MAX(date) AS m FROM transactions WHERE user_id = ? AND provider = ?')
			.get(userId, providerId) as { m: string | null };
		const since = maxRow?.m ? shiftDate(maxRow.m, -REPOST_FETCH_LOOKBACK_DAYS) : undefined;

		const providerTransactions = await provider.fetchTransactions(since, ctx);
		// The ids the provider reports right now. An imported row whose id is
		// no longer among them was re-posted under a new id (or removed); the
		// sweep below folds it into its replacement instead of leaving a
		// duplicate behind.
		const liveIds = new Set(providerTransactions.map((t) => t.external_id));
		const postedPendingIds = pendingIdsReplacedInResponse(providerTransactions);
		let created = 0;
		let updated = 0;
		const seenAt = dbTime(new Date());
		for (const pt of providerTransactions) {
			if (isPendingAlreadyPosted(pt, postedPendingIds)) continue;
			const accountId = accountMap.get(pt.account_external_id);
			if (accountId == null) continue;
			const pendingFlag = pt.pending === true ? 1 : 0;
			const pendingTxnId = pt.pending_transaction_id ?? null;
			const pendingLastSeen = pendingFlag ? seenAt : null;
			const existing = db()
				.query('SELECT id FROM transactions WHERE user_id = ? AND provider = ? AND external_id = ?')
				.get(userId, providerId, pt.external_id) as { id: number } | undefined;
			if (existing) {
				db()
					.query(
						`UPDATE transactions
						 SET account_id = ?, date = ?, amount_cents = ?, merchant = ?, notes = ?,
						     pending = ?, pending_transaction_id = ?,
						     pending_last_seen_at = CASE WHEN ? = 1 THEN ? ELSE pending_last_seen_at END,
						     updated_at = datetime('now')
						 WHERE id = ? AND user_id = ?`
					)
					.run(
						accountId,
						pt.date,
						pt.amount_cents,
						pt.merchant ?? null,
						pt.notes ?? null,
						pendingFlag,
						pendingTxnId,
						pendingFlag,
						pendingLastSeen,
						existing.id,
						userId
					);
				updated++;
			} else {
				const result = db()
					.query(
						`INSERT INTO transactions (
							user_id, account_id, date, amount_cents, merchant, notes, provider, external_id,
							pending, pending_transaction_id, pending_last_seen_at
						 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run(
						userId,
						accountId,
						pt.date,
						pt.amount_cents,
						pt.merchant ?? null,
						pt.notes ?? null,
						providerId,
						pt.external_id,
						pendingFlag,
						pendingTxnId,
						pendingLastSeen
					);
				created++;
				// Imported transactions start uncategorized; let the user's rules fill them in.
				applyCategorizationRules(userId, Number(result.lastInsertRowid));
			}
			if (!pt.pending && pt.pending_transaction_id) {
				foldPendingIntoPosted(userId, providerId, accountId, pt.pending_transaction_id, pt.external_id);
			}
		}

		// The upsert above imported every copy the provider reports now; fold
		// the stale copies it no longer reports into their replacements.
		const merged = since ? mergeRepostedTransactions(userId, providerId, since, liveIds) : 0;

		const lastSyncedAt = dbTime(new Date());
		db()
			.query("UPDATE connections SET status = 'connected', last_synced_at = ?, last_error = NULL WHERE id = ? AND user_id = ?")
			.run(lastSyncedAt, conn.id, userId);
		if (wasInError) notifySyncRecovered(userId, providerLabel, conn.id);
		return { accounts: accountMap.size, created, updated, merged, lastSyncedAt };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Sync failed.';
		db()
			.query("UPDATE connections SET status = 'error', last_error = ? WHERE id = ? AND user_id = ?")
			.run(message, conn.id, userId);
		notifySyncFailed(userId, providerLabel, conn.id, message);
		return { error: message };
	}
}

interface OrphanRow {
	id: number;
	account_id: number;
	date: string;
	amount_cents: number;
	merchant: string | null;
	category_id: number | null;
	color: string | null;
	notes: string | null;
	external_id: string;
	created_at: string;
}

interface ReplacementRow {
	id: number;
	category_id: number | null;
	color: string | null;
	notes: string | null;
	external_id: string;
	split_count: number;
	amount_cents: number;
	merchant: string | null;
	date: string;
	created_at: string;
}

interface OrphanCandidateScore {
	row: ReplacementRow;
	amountDelta: number;
	sameDay: boolean;
	createdDeltaMs: number;
}

export function pendingIdsReplacedInResponse(
	transactions: { pending?: boolean; pending_transaction_id?: string | null }[]
): Set<string> {
	return new Set(
		transactions
			.map((t) => (t.pending ? null : t.pending_transaction_id))
			.filter((id): id is string => !!id)
	);
}

export function isPendingAlreadyPosted(
	pt: { pending?: boolean; external_id: string },
	postedPendingIds: Set<string>
): boolean {
	return pt.pending === true && !!pt.external_id && postedPendingIds.has(pt.external_id);
}

/**
 * The posted row keeps its amount, date, and external id. User fields on the
 * pending row move only where the posted row has none. Then the pending row
 * is deleted. No-op when that id is not stored on this account.
 */
export function foldPendingIntoPosted(
	userId: number,
	providerId: string,
	accountId: number,
	pendingExternalId: string,
	postedExternalId: string,
	database = db()
) {
	if (!pendingExternalId || pendingExternalId === postedExternalId) return;
	const pending = database
		.query(
			`SELECT id, category_id, color, notes,
				(SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
			 FROM transactions t
			 WHERE user_id = ? AND provider = ? AND account_id = ? AND external_id = ?`
		)
		.get(userId, providerId, accountId, pendingExternalId) as
		| { id: number; category_id: number | null; color: string | null; notes: string | null; split_count: number }
		| undefined;
	const posted = database
		.query(
			`SELECT id, category_id,
				(SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
			 FROM transactions t
			 WHERE user_id = ? AND provider = ? AND account_id = ? AND external_id = ?`
		)
		.get(userId, providerId, accountId, postedExternalId) as
		| { id: number; category_id: number | null; split_count: number }
		| undefined;
	if (!pending || !posted || pending.id === posted.id) return;
	if (pending.split_count > 0 && posted.split_count > 0) return;
	database.run('BEGIN');
	try {
		database
			.query(
				`UPDATE transactions
				 SET category_id = COALESCE(category_id, ?),
				     color = COALESCE(color, ?),
				     notes = COALESCE(notes, ?),
				     pending = 0,
				     pending_transaction_id = COALESCE(pending_transaction_id, ?),
				     updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(pending.category_id, pending.color, pending.notes, pendingExternalId, posted.id, userId);
		database
			.query(
				`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
				 SELECT ?, tag_id FROM transaction_tags WHERE transaction_id = ?`
			)
			.run(posted.id, pending.id);
		if (pending.split_count > 0 && posted.split_count === 0) {
			database.query('UPDATE transaction_splits SET transaction_id = ? WHERE transaction_id = ?').run(posted.id, pending.id);
		}
		database.query('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(pending.id, userId);
		database.run('COMMIT');
	} catch (error) {
		database.run('ROLLBACK');
		throw error;
	}
}

/** Compare payee text the way a pending→posted pair should: case and surrounding space do not matter. */
function merchantKey(merchant: string | null): string {
	return (merchant ?? '').trim().toLowerCase();
}

/** Absolute cent gap allowed for a same-merchant auth→adjust fold. */
function orphanAmountBandCents(orphanAmountCents: number): number {
	const pctBand = Math.floor((Math.abs(orphanAmountCents) * ORPHAN_AMOUNT_PCT) / 100);
	return Math.max(ORPHAN_AMOUNT_ABS_CENTS, pctBand);
}

function orphanCreatedDeltaMs(orphanCreatedAt: string, liveCreatedAt: string): number {
	const a = Date.parse(orphanCreatedAt.includes('T') ? orphanCreatedAt : orphanCreatedAt.replace(' ', 'T') + 'Z');
	const b = Date.parse(liveCreatedAt.includes('T') ? liveCreatedAt : liveCreatedAt.replace(' ', 'T') + 'Z');
	if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
	return Math.abs(a - b);
}

/**
 * Pick the live row an orphan should fold into, or null when there is no
 * single clear winner. A sole same-merchant or exact-amount match still folds
 * (#45). When several qualify, same-merchant rows must sit inside the
 * ORPHAN_AMOUNT_* band and beat the runner-up on amount, calendar day, or
 * created_at (#125).
 */
export function pickRepostTarget(
	orphan: { date: string; amount_cents: number; merchant: string | null; created_at?: string },
	live: ReplacementRow[]
): ReplacementRow | null {
	if (live.length === 0) return null;
	const merchant = merchantKey(orphan.merchant);
	const broad = live.filter((row) => {
		const sameMerchant = merchant !== '' && merchantKey(row.merchant) === merchant;
		return row.amount_cents === orphan.amount_cents || sameMerchant;
	});
	if (broad.length === 0) return null;
	if (broad.length === 1) return broad[0]!;

	const band = orphanAmountBandCents(orphan.amount_cents);
	const orphanCreated = orphan.created_at ?? '';
	const scored: OrphanCandidateScore[] = [];
	for (const row of broad) {
		const amountDelta = Math.abs(row.amount_cents - orphan.amount_cents);
		const exactAmount = amountDelta === 0;
		if (!exactAmount && amountDelta > band) continue;
		scored.push({
			row,
			amountDelta,
			sameDay: row.date === orphan.date,
			createdDeltaMs: orphanCreatedDeltaMs(orphanCreated, row.created_at)
		});
	}
	if (scored.length === 0) return null;
	if (scored.length === 1) return scored[0]!.row;
	scored.sort((a, b) => {
		if (a.amountDelta !== b.amountDelta) return a.amountDelta - b.amountDelta;
		if (a.sameDay !== b.sameDay) return a.sameDay ? -1 : 1;
		if (a.createdDeltaMs !== b.createdDeltaMs) return a.createdDeltaMs - b.createdDeltaMs;
		return a.row.id - b.row.id;
	});
	const best = scored[0]!;
	const second = scored[1]!;
	const clearByAmount = best.amountDelta < second.amountDelta;
	const clearByDay = best.amountDelta === second.amountDelta && best.sameDay && !second.sameDay;
	const clearByCreated =
		best.amountDelta === second.amountDelta &&
		best.sameDay === second.sameDay &&
		best.createdDeltaMs < second.createdDeltaMs;
	if (clearByAmount || clearByDay || clearByCreated) return best.row;
	return null;
}

/**
 * Merge imported rows the provider no longer reports into their live
 * replacements.
 *
 * When a provider updates a transaction it usually re-issues it under a new
 * external id (a pending charge clearing is the classic case: the posted
 * copy gets a fresh id and the old one stops appearing in the response). The
 * upsert in syncNow has already imported the new copy, so the old row is now
 * a stale duplicate. For every such row inside the fetch window whose
 * external_id is absent from the live set, if a single clear live match
 * exists, the stale row's user-owned data (category, color, notes, tags,
 * splits) is folded into the live row and the duplicate is deleted. A match
 * is the same account, a date within REPOST_WINDOW_DAYS after the stale row,
 * and either the same amount or the same merchant within the ORPHAN_AMOUNT_*
 * band (grocery auth→adjust). When several live same-merchant rows qualify,
 * pickRepostTarget keeps only a clear winner. The live row keeps the posted
 * amount. Truly ambiguous rows are queued for in-app review (#127).
 *
 * Returns the number of rows merged away.
 */
export function mergeRepostedTransactions(
	userId: number,
	providerId: string,
	since: string,
	liveIds: Set<string>,
	database = db()
): number {
	const orphans = database
		.query(
			`SELECT id, account_id, date, amount_cents, merchant, category_id, color, notes, external_id, created_at
			 FROM transactions
			 WHERE user_id = ? AND provider = ? AND date >= ?
			   AND external_id IS NOT NULL AND external_id != ''`
		)
		.all(userId, providerId, since) as OrphanRow[];
	let merged = 0;
	for (const orphan of orphans) {
		if (liveIds.has(orphan.external_id)) continue; // still reported — not stale
		const candidates = database
			.query(
				`SELECT id, category_id, color, notes, external_id, amount_cents, merchant, date, created_at,
					(SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
				 FROM transactions t
				 WHERE t.user_id = ? AND t.provider = ? AND t.account_id = ?
				   AND t.id != ?
				   AND t.date >= ? AND t.date <= ?
				   AND t.external_id IS NOT NULL AND t.external_id != ''`
			)
			.all(
				userId,
				providerId,
				orphan.account_id,
				orphan.id,
				orphan.date,
				shiftDate(orphan.date, REPOST_WINDOW_DAYS)
			) as ReplacementRow[];
		const live = candidates.filter((c) => liveIds.has(c.external_id));
		const target = pickRepostTarget(orphan, live);
		if (!target) {
			// 0 or ambiguous — queue for user review instead of silent leave (#127).
			enqueueSyncReview(userId, providerId, orphan.id, live.map((c) => c.id), database);
			continue;
		}
		if (foldOrphanIntoTarget(userId, orphan, target, database)) {
			merged++;
			// The merchant may have changed on the re-post (e.g. a corrected
			// name); let the user's rules categorize the survivor if it has
			// no category yet.
			if (orphan.category_id == null && target.category_id == null) applyCategorizationRules(userId, target.id);
		}
	}
	return merged;
}

/**
 * Fold an orphan row's user-owned fields into a live target, then delete the
 * orphan. Shared by the automatic orphan sweep and the review-queue "fold
 * into" action. Returns false when both sides already have splits.
 */
export function foldOrphanIntoTarget(
	userId: number,
	orphan: { id: number; category_id: number | null; color: string | null; notes: string | null },
	target: { id: number; category_id: number | null; split_count: number },
	database: Database = db()
): boolean {
	const orphanSplits = (
		database.query('SELECT COUNT(*) AS c FROM transaction_splits WHERE transaction_id = ?').get(orphan.id) as {
			c: number;
		}
	).c;
	if (orphanSplits > 0 && target.split_count > 0) return false;
	database.run('BEGIN');
	try {
		database
			.query(
				`UPDATE transactions
				 SET category_id = COALESCE(category_id, ?),
				     color = COALESCE(color, ?),
				     notes = COALESCE(notes, ?),
				     pending = 0,
				     updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(orphan.category_id, orphan.color, orphan.notes, target.id, userId);
		database
			.query(
				`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
				 SELECT ?, tag_id FROM transaction_tags WHERE transaction_id = ?`
			)
			.run(target.id, orphan.id);
		if (orphanSplits > 0 && target.split_count === 0) {
			database
				.query('UPDATE transaction_splits SET transaction_id = ? WHERE transaction_id = ?')
				.run(target.id, orphan.id);
		}
		database.query('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(orphan.id, userId);
		database.run('COMMIT');
		return true;
	} catch (error) {
		database.run('ROLLBACK');
		throw error;
	}
}

/** Queue an orphan for user review when auto-fold has no clear winner. */
export function enqueueSyncReview(
	userId: number,
	providerId: string,
	orphanTransactionId: number,
	candidateIds: number[],
	database: Database = db()
): void {
	const existing = database
		.query(
			`SELECT id, status FROM sync_review_items
			 WHERE user_id = ? AND orphan_transaction_id = ?`
		)
		.get(userId, orphanTransactionId) as { id: number; status: string } | undefined;
	// keep both / dismiss / folded: do not reopen.
	if (existing && existing.status !== 'open') return;
	const payload = JSON.stringify(candidateIds);
	if (existing) {
		database
			.query(
				`UPDATE sync_review_items
				 SET provider = ?, candidate_transaction_ids = ?, reason = 'ambiguous_orphan'
				 WHERE id = ?`
			)
			.run(providerId, payload, existing.id);
		return;
	}
	database
		.query(
			`INSERT INTO sync_review_items
			 (user_id, orphan_transaction_id, provider, status, candidate_transaction_ids, reason)
			 VALUES (?, ?, ?, 'open', ?, 'ambiguous_orphan')`
		)
		.run(userId, orphanTransactionId, providerId, payload);
}

export function countOpenSyncReviews(userId: number, database: Database = db()): number {
	const row = database
		.query(`SELECT COUNT(*) AS c FROM sync_review_items WHERE user_id = ? AND status = 'open'`)
		.get(userId) as { c: number };
	return row.c;
}

interface ReviewTxnRow {
	id: number;
	date: string;
	amount_cents: number;
	merchant: string | null;
	external_id: string | null;
	category_id: number | null;
	color: string | null;
	notes: string | null;
	split_count: number;
}

function loadReviewTxn(database: Database, userId: number, id: number): ReviewTxnRow | null {
	return (
		(database
			.query(
				`SELECT id, date, amount_cents, merchant, external_id, category_id, color, notes,
					(SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
				 FROM transactions t
				 WHERE id = ? AND user_id = ?`
			)
			.get(id, userId) as ReviewTxnRow | undefined) ?? null
	);
}

export function listOpenSyncReviews(userId: number, database: Database = db()) {
	const rows = database
		.query(
			`SELECT id, orphan_transaction_id, provider, status, candidate_transaction_ids, reason, created_at, resolved_at
			 FROM sync_review_items
			 WHERE user_id = ? AND status = 'open'
			 ORDER BY created_at DESC, id DESC`
		)
		.all(userId) as {
		id: number;
		orphan_transaction_id: number;
		provider: string;
		status: string;
		candidate_transaction_ids: string;
		reason: string;
		created_at: string;
		resolved_at: string | null;
	}[];
	const items = [];
	for (const row of rows) {
		const orphan = loadReviewTxn(database, userId, row.orphan_transaction_id);
		if (!orphan) {
			database.query('DELETE FROM sync_review_items WHERE id = ?').run(row.id);
			continue;
		}
		let candidateIds: number[] = [];
		try {
			const parsed = JSON.parse(row.candidate_transaction_ids) as unknown;
			if (Array.isArray(parsed)) candidateIds = parsed.filter((n): n is number => typeof n === 'number');
		} catch {
			candidateIds = [];
		}
		const candidates = candidateIds
			.map((cid) => loadReviewTxn(database, userId, cid))
			.filter((t): t is ReviewTxnRow => !!t)
			.map((t) => ({
				id: t.id,
				date: t.date,
				amount_cents: t.amount_cents,
				merchant: t.merchant,
				external_id: t.external_id
			}));
		items.push({
			id: row.id,
			orphan_transaction_id: row.orphan_transaction_id,
			provider: row.provider,
			status: row.status as 'open',
			reason: row.reason,
			created_at: row.created_at,
			resolved_at: row.resolved_at,
			orphan: {
				id: orphan.id,
				date: orphan.date,
				amount_cents: orphan.amount_cents,
				merchant: orphan.merchant,
				external_id: orphan.external_id
			},
			candidates
		});
	}
	return items;
}

/**
 * Resolve a review item: keep both, dismiss, or fold the orphan into a live id.
 */
export function resolveSyncReview(
	userId: number,
	reviewId: number,
	action: 'keep' | 'dismiss' | 'fold',
	foldIntoId?: number,
	database: Database = db()
): { ok: true } | { error: string } {
	const row = database
		.query(
			`SELECT id, orphan_transaction_id, status, candidate_transaction_ids
			 FROM sync_review_items WHERE id = ? AND user_id = ?`
		)
		.get(reviewId, userId) as
		| {
				id: number;
				orphan_transaction_id: number;
				status: string;
				candidate_transaction_ids: string;
		  }
		| undefined;
	if (!row) return { error: 'Review item not found.' };
	if (row.status !== 'open') return { error: 'That review item is already resolved.' };
	const now = dbTime(new Date());
	if (action === 'keep') {
		database
			.query(`UPDATE sync_review_items SET status = 'kept', resolved_at = ? WHERE id = ? AND user_id = ?`)
			.run(now, reviewId, userId);
		return { ok: true };
	}
	if (action === 'dismiss') {
		database
			.query(
				`UPDATE sync_review_items SET status = 'dismissed', resolved_at = ? WHERE id = ? AND user_id = ?`
			)
			.run(now, reviewId, userId);
		return { ok: true };
	}
	if (action !== 'fold' || foldIntoId == null || !Number.isFinite(foldIntoId)) {
		return { error: 'Pick a transaction to fold into.' };
	}
	const orphan = loadReviewTxn(database, userId, row.orphan_transaction_id);
	const target = loadReviewTxn(database, userId, foldIntoId);
	if (!orphan || !target) return { error: 'One of those transactions is gone.' };
	if (orphan.id === target.id) return { error: 'Cannot fold a transaction into itself.' };
	if (!foldOrphanIntoTarget(userId, orphan, target, database)) {
		return { error: 'Both transactions are split; fold them manually or keep both.' };
	}
	database
		.query(`UPDATE sync_review_items SET status = 'folded', resolved_at = ? WHERE id = ? AND user_id = ?`)
		.run(now, reviewId, userId);
	return { ok: true };
}

/** Provider accounts linked to this user's Galene accounts, with imported transaction counts. */
export function getLinkedAccounts(userId: number, providerId: string): LinkedAccount[] {
	return db()
		.query(
			`SELECT a.id, a.name, a.type, a.external_id, a.source_name, a.name_locked, COUNT(t.id) AS tx_count
			 FROM accounts a
			 LEFT JOIN transactions t ON t.account_id = a.id
			 WHERE a.user_id = ? AND a.provider = ?
			 GROUP BY a.id
			 ORDER BY a.name`
		)
		.all(userId, providerId) as LinkedAccount[];
}

interface AccountRow {
	id: number;
	name: string;
	type: string;
	provider: string | null;
	external_id: string | null;
	source_name: string | null;
	name_locked: number;
}

/**
 * Point a provider account at a different Galene account.
 *
 * `target.kind === 'new'` renames the account in place to the given name (which
 * the user may have left as the provider's) and locks it so future syncs keep
 * it. `target.kind === 'existing'` reassigns the source to an existing account:
 * the source's transactions move over and the old account is dropped if empty.
 * Returns the resulting account name.
 */
export function mapAccount(
	userId: number,
	providerId: string,
	externalId: string,
	target: { kind: 'new'; name: string } | { kind: 'existing'; accountId: number }
): { name: string } {
	const current = db()
		.query('SELECT * FROM accounts WHERE user_id = ? AND provider = ? AND external_id = ?')
		.get(userId, providerId, externalId) as AccountRow | undefined;
	if (!current) throw new Error('That source account is not linked. Sync the provider first.');

	if (target.kind === 'new') {
		const name = target.name.trim();
		if (!name) throw new Error('Enter a name for the account.');
		db()
			.query('UPDATE accounts SET name = ?, source_name = ?, name_locked = 1 WHERE id = ? AND user_id = ?')
			.run(name, current.source_name ?? current.name, current.id, userId);
		return { name };
	}

	const t = db()
		.query('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
		.get(target.accountId, userId) as AccountRow | undefined;
	if (!t) throw new Error('Account not found.');
	if (t.id === current.id) return { name: current.name };
	// The target must not already represent a different source account.
	if (t.provider != null && (t.provider !== providerId || t.external_id !== externalId)) {
		throw new Error('That account is already mapped to a different source account.');
	}

	// Free the (provider, external_id) slot on the old account, then claim it on
	// the target. The source's transactions follow it over.
	db()
		.query('UPDATE accounts SET provider = NULL, external_id = NULL, source_name = NULL, name_locked = 0 WHERE id = ?')
		.run(current.id);
	db()
		.query('UPDATE accounts SET provider = ?, external_id = ?, source_name = ?, name_locked = 1, type = ? WHERE id = ?')
		.run(providerId, externalId, current.source_name ?? current.name, current.type, t.id);
	db().query('UPDATE transactions SET account_id = ? WHERE account_id = ? AND user_id = ?').run(t.id, current.id, userId);
	const remaining = db()
		.query('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?')
		.get(current.id) as { c: number };
	if (remaining.c === 0) db().query('DELETE FROM accounts WHERE id = ?').run(current.id);
	return { name: t.name };
}
