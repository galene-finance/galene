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
 * after the original, so the incremental window reaches back this far and
 * the orphan sweep below can pair the two copies.
 */
const REPOST_WINDOW_DAYS = 7;

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
		// The window reaches a few days *before* the newest date: providers
		// re-post changed transactions under a new external id with a date up
		// to a few days later, and we need both copies in one response to
		// merge them instead of importing a duplicate.
		const maxRow = db()
			.query('SELECT MAX(date) AS m FROM transactions WHERE user_id = ? AND provider = ?')
			.get(userId, providerId) as { m: string | null };
		const since = maxRow?.m ? shiftDate(maxRow.m, -REPOST_WINDOW_DAYS) : undefined;

		const providerTransactions = await provider.fetchTransactions(since, ctx);
		// The ids the provider reports right now. An imported row whose id is
		// no longer among them was re-posted under a new id (or removed); the
		// sweep below folds it into its replacement instead of leaving a
		// duplicate behind.
		const liveIds = new Set(providerTransactions.map((t) => t.external_id));
		let created = 0;
		let updated = 0;
		for (const pt of providerTransactions) {
			const accountId = accountMap.get(pt.account_external_id);
			if (accountId == null) continue;
			const existing = db()
				.query('SELECT id FROM transactions WHERE user_id = ? AND provider = ? AND external_id = ?')
				.get(userId, providerId, pt.external_id) as { id: number } | undefined;
			if (existing) {
				db()
					.query(
						`UPDATE transactions
						 SET account_id = ?, date = ?, amount_cents = ?, merchant = ?, notes = ?, updated_at = datetime('now')
						 WHERE id = ? AND user_id = ?`
					)
					.run(accountId, pt.date, pt.amount_cents, pt.merchant ?? null, pt.notes ?? null, existing.id, userId);
				updated++;
			} else {
				const result = db()
					.query(
						`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, notes, provider, external_id)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run(userId, accountId, pt.date, pt.amount_cents, pt.merchant ?? null, pt.notes ?? null, providerId, pt.external_id);
				created++;
				// Imported transactions start uncategorized; let the user's rules fill them in.
				applyCategorizationRules(userId, Number(result.lastInsertRowid));
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
	category_id: number | null;
	color: string | null;
	notes: string | null;
	external_id: string;
}

interface ReplacementRow {
	id: number;
	category_id: number | null;
	color: string | null;
	notes: string | null;
	external_id: string;
	split_count: number;
}

/**
 * Merge imported rows the provider no longer reports into their live
 * replacements.
 *
 * When a provider updates a transaction it usually re-issues it under a new
 * external id (a pending charge clearing is the classic case: the posted
 * copy gets a fresh id and the old one stops appearing in the response). The
 * upsert in syncNow has already imported the new copy, so the old row is now
 * a stale duplicate. For every such row inside the fetch window, if exactly
 * one live row matches on account, amount and a date within a few days after
 * it, the stale row's user-owned data (category, color, notes, tags, splits)
 * is folded into the live row and the duplicate is deleted. Rows with no
 * single clear match are left for the user to resolve.
 *
 * Returns the number of rows merged away.
 */
export function mergeRepostedTransactions(userId: number, providerId: string, since: string, liveIds: Set<string>): number {
	const orphans = db()
		.query(
			`SELECT id, account_id, date, amount_cents, category_id, color, notes, external_id
			 FROM transactions
			 WHERE user_id = ? AND provider = ? AND date >= ?
			   AND external_id IS NOT NULL AND external_id != ''`
		)
		.all(userId, providerId, since) as OrphanRow[];
	let merged = 0;
	for (const orphan of orphans) {
		if (liveIds.has(orphan.external_id)) continue; // still reported — not stale
		const candidates = db()
			.query(
				`SELECT id, category_id, color, notes, external_id,
					(SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
				 FROM transactions t
				 WHERE t.user_id = ? AND t.provider = ? AND t.account_id = ?
				   AND t.amount_cents = ? AND t.date >= ? AND t.date <= ?
				   AND t.external_id IS NOT NULL AND t.external_id != ''`
			)
			.all(
				userId,
				providerId,
				orphan.account_id,
				orphan.amount_cents,
				orphan.date,
				shiftDate(orphan.date, REPOST_WINDOW_DAYS)
			) as ReplacementRow[];
		const live = candidates.filter((c) => liveIds.has(c.external_id));
		if (live.length !== 1) continue; // 0 or ambiguous — leave for the user
		const target = live[0];
		const orphanSplits = (
			db().query('SELECT COUNT(*) AS c FROM transaction_splits WHERE transaction_id = ?').get(orphan.id) as { c: number }
		).c;
		if (orphanSplits > 0 && target.split_count > 0) continue; // two split layouts can't be combined
		db().run('BEGIN');
		try {
			// User-owned fields move over only where the live row has none of
			// its own; the live row's existing values (and its just-refreshed
			// provider data) win.
			db()
				.query(
					`UPDATE transactions
					 SET category_id = COALESCE(category_id, ?),
					     color = COALESCE(color, ?),
					     notes = COALESCE(notes, ?),
					     updated_at = datetime('now')
					 WHERE id = ? AND user_id = ?`
				)
				.run(orphan.category_id, orphan.color, orphan.notes, target.id, userId);
			// Tags: the orphan's are copied across; the originals are dropped
			// with the row.
			db()
				.query(
					`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
					 SELECT ?, tag_id FROM transaction_tags WHERE transaction_id = ?`
				)
				.run(target.id, orphan.id);
			// Splits: re-point the orphan's to the live row when it has none.
			if (orphanSplits > 0 && target.split_count === 0) {
				db().query('UPDATE transaction_splits SET transaction_id = ? WHERE transaction_id = ?').run(target.id, orphan.id);
			}
			db().query('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(orphan.id, userId);
			db().run('COMMIT');
			merged++;
			// The merchant may have changed on the re-post (e.g. a corrected
			// name); let the user's rules categorize the survivor if it has
			// no category yet.
			if (orphan.category_id == null && target.category_id == null) applyCategorizationRules(userId, target.id);
		} catch (error) {
			db().run('ROLLBACK');
			throw error;
		}
	}
	return merged;
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
