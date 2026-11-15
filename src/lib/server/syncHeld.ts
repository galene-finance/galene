import { Database } from 'bun:sqlite';
import type { ProviderTransaction } from '$lib/types';
import { db } from './db';

/**
 * Bank lines a sync saw and did not import (ADO-8).
 *
 * Sync imports every mapped, posted provider line. The one line it keeps out
 * on purpose is a line the user deleted: deleting a provider-backed transaction
 * copies it here, and the next sync refreshes this row instead of inserting it
 * again. Reconcile lists those rows as "Missing from Galene". Adding the line
 * back deletes this row. Pending lines that the same response already posts are
 * not held — the posted twin is the ledger row.
 */

const HOLD_COLUMNS = `user_id, account_id, provider, external_id, date, amount_cents, merchant, notes, pending, seen_at`;

export function holdProviderTransactions(userId: number, ids: number[], database: Database = db()): void {
	if (ids.length === 0) return;
	const placeholders = ids.map(() => '?').join(',');
	database
		.query(
			`INSERT INTO sync_unimported (${HOLD_COLUMNS})
			 SELECT user_id, account_id, provider, external_id, date, amount_cents, merchant, notes,
			        COALESCE(pending, 0), datetime('now')
			 FROM transactions
			 WHERE user_id = ? AND id IN (${placeholders})
			   AND provider IS NOT NULL AND trim(provider) != ''
			   AND external_id IS NOT NULL AND trim(external_id) != ''
			 ON CONFLICT(user_id, provider, external_id) DO UPDATE SET
			   account_id = excluded.account_id,
			   date = excluded.date,
			   amount_cents = excluded.amount_cents,
			   merchant = excluded.merchant,
			   notes = excluded.notes,
			   pending = excluded.pending,
			   seen_at = excluded.seen_at`
		)
		.run(userId, ...ids);
}

export function isHeldProviderLine(
	userId: number,
	provider: string,
	externalId: string,
	database: Database = db()
): boolean {
	const row = database
		.query(`SELECT 1 AS o FROM sync_unimported WHERE user_id = ? AND provider = ? AND external_id = ?`)
		.get(userId, provider, externalId) as { o: number } | null;
	return !!row;
}

export function touchHeldProviderLine(
	userId: number,
	provider: string,
	accountId: number,
	pt: ProviderTransaction,
	seenAt: string,
	database: Database = db()
): void {
	database
		.query(
			`UPDATE sync_unimported
			 SET account_id = ?, date = ?, amount_cents = ?, merchant = ?, notes = ?, pending = ?, seen_at = ?
			 WHERE user_id = ? AND provider = ? AND external_id = ?`
		)
		.run(
			accountId,
			pt.date,
			pt.amount_cents,
			pt.merchant ?? null,
			pt.notes ?? null,
			pt.pending === true ? 1 : 0,
			seenAt,
			userId,
			provider,
			pt.external_id
		);
}

export function releaseHeldProviderLine(
	userId: number,
	provider: string,
	externalId: string,
	database: Database = db()
): void {
	database
		.query(`DELETE FROM sync_unimported WHERE user_id = ? AND provider = ? AND external_id = ?`)
		.run(userId, provider, externalId);
}
