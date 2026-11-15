import { BALANCE_ADJUSTMENT_KIND, BALANCE_ADJUSTMENT_NAME } from '../balanceAdjustment';
import {
	buildReconcileView,
	type MissingLine,
	type ReconcileRow
} from '../reconcileMath';
import { db, seedBalanceAdjustmentCategories } from './db';
import { holdProviderTransactions } from './syncHeld';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECONCILED_LOCK = 'This transaction is reconciled. Unlock it before editing or deleting.';

export interface ReconcileAccount {
	id: number;
	name: string;
	type: string;
	provider: string | null;
	opening_balance_cents: number | null;
	opening_as_of: string | null;
	provider_balance_cents: number | null;
	provider_balance_as_of: string | null;
}

export interface ReconcileLoad {
	account: ReconcileAccount;
	rows: ReconcileRow[];
	missing: MissingLine[];
	dismissedPairs: string[];
	lastStatementDate: string | null;
}

export interface FinishPlan {
	bankBalanceCents: number;
	statementDate: string;
	adjustment: { amountCents: number; date: string; note: string } | null;
	addUnimportedIds: number[];
	deleteIds: number[];
}

interface Scope {
	accountIds: number[];
}

function ownsAccount(userId: number, accountId: number, scope: Scope | null): ReconcileAccount | null {
	if (scope && scope.accountIds.length > 0 && !scope.accountIds.includes(accountId)) return null;
	const row = db()
		.query(
			`SELECT id, name, type, provider, opening_balance_cents, opening_as_of,
			        provider_balance_cents, provider_balance_as_of
			 FROM accounts WHERE id = ? AND user_id = ?`
		)
		.get(accountId, userId) as ReconcileAccount | null;
	return row ?? null;
}

/**
 * Accounts whose latest statement locked rows that a later sync demoted
 * (cleared again, no longer reconciled) on or before that statement date.
 */
export function accountsNeedingReconcile(userId: number): Record<string, true> {
	const rows = db()
		.query(
			`SELECT DISTINCT t.account_id AS account_id
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
			 JOIN reconcile_sessions s ON s.account_id = t.account_id AND s.user_id = t.user_id
			 WHERE t.user_id = ?
			   AND t.cleared = 1
			   AND t.reconciled_at IS NULL
			   AND t.date <= s.statement_date
			   AND (a.opening_as_of IS NULL OR t.date >= a.opening_as_of)
			   AND s.id = (
			     SELECT MAX(id) FROM reconcile_sessions
			     WHERE user_id = t.user_id AND account_id = t.account_id
			   )`
		)
		.all(userId) as { account_id: number }[];
	const out: Record<string, true> = {};
	for (const row of rows) out[String(row.account_id)] = true;
	return out;
}

export function lastReconciledByAccount(userId: number): Record<string, string> {
	const rows = db()
		.query(
			`SELECT account_id, statement_date
			 FROM reconcile_sessions
			 WHERE user_id = ? AND id IN (
			   SELECT MAX(id) FROM reconcile_sessions WHERE user_id = ? GROUP BY account_id
			 )`
		)
		.all(userId, userId) as { account_id: number; statement_date: string }[];
	const out: Record<string, string> = {};
	for (const row of rows) out[String(row.account_id)] = row.statement_date;
	return out;
}

export function loadReconcile(userId: number, accountId: number, scope: Scope | null): ReconcileLoad | null {
	const account = ownsAccount(userId, accountId, scope);
	if (!account) return null;
	const raw = db()
		.query(
			`SELECT t.id, t.date, t.amount_cents, t.merchant, t.cleared, t.reconciled_at, t.pending,
			        t.provider, c.name AS category_name
			 FROM transactions t
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.account_id = ?
			 ORDER BY t.date DESC, t.id DESC`
		)
		.all(userId, accountId) as {
		id: number;
		date: string;
		amount_cents: number;
		merchant: string | null;
		cleared: number;
		reconciled_at: string | null;
		pending: number;
		provider: string | null;
		category_name: string | null;
	}[];
	const rows: ReconcileRow[] = raw.map((row) => ({
		id: row.id,
		date: row.date,
		amountCents: row.amount_cents,
		merchant: row.merchant,
		categoryName: row.category_name,
		cleared: row.cleared === 1,
		reconciledAt: row.reconciled_at,
		pending: row.pending === 1,
		synced: !!row.provider && row.provider.trim() !== ''
	}));
	const missing: MissingLine[] = account.provider
		? (db()
				.query(
					`SELECT id, date, amount_cents, merchant
					 FROM sync_unimported
					 WHERE user_id = ? AND account_id = ? AND pending = 0
					 ORDER BY date DESC, id DESC`
				)
				.all(userId, accountId) as {
				id: number;
				date: string;
				amount_cents: number;
				merchant: string | null;
			}[]).map((row) => ({
				id: row.id,
				date: row.date,
				amountCents: row.amount_cents,
				merchant: row.merchant
			}))
		: [];
	const dismissed = db()
		.query(
			`SELECT transaction_id, match_transaction_id
			 FROM reconcile_duplicate_dismissals
			 WHERE user_id = ? AND account_id = ?`
		)
		.all(userId, accountId) as { transaction_id: number; match_transaction_id: number }[];
	const last = db()
		.query(
			`SELECT statement_date FROM reconcile_sessions
			 WHERE user_id = ? AND account_id = ?
			 ORDER BY finished_at DESC, id DESC LIMIT 1`
		)
		.get(userId, accountId) as { statement_date: string } | null;
	return {
		account,
		rows,
		missing,
		dismissedPairs: dismissed.map((row) => `${row.transaction_id}:${row.match_transaction_id}`),
		lastStatementDate: last?.statement_date ?? null
	};
}

function assertIdsOnAccount(userId: number, accountId: number, ids: number[]): void {
	if (ids.length === 0) return;
	const unique = [...new Set(ids)];
	const row = db()
		.query(
			`SELECT COUNT(*) AS n FROM transactions
			 WHERE user_id = ? AND account_id = ? AND id IN (${unique.map(() => '?').join(',')})`
		)
		.get(userId, accountId, ...unique) as { n: number };
	if (row.n !== unique.length) throw new Error('That transaction is not on this account.');
}

export function setCleared(userId: number, accountId: number, ids: number[], cleared: boolean): void {
	const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
	if (unique.length === 0) return;
	assertIdsOnAccount(userId, accountId, unique);
	const locked = db()
		.query(
			`SELECT COUNT(*) AS n FROM transactions
			 WHERE user_id = ? AND account_id = ? AND reconciled_at IS NOT NULL
			   AND id IN (${unique.map(() => '?').join(',')})`
		)
		.get(userId, accountId, ...unique) as { n: number };
	if (locked.n > 0) throw new Error(RECONCILED_LOCK);
	db()
		.query(
			`UPDATE transactions SET cleared = ?, updated_at = datetime('now')
			 WHERE user_id = ? AND account_id = ? AND reconciled_at IS NULL
			   AND id IN (${unique.map(() => '?').join(',')})`
		)
		.run(cleared ? 1 : 0, userId, accountId, ...unique);
}

export function tickAllThrough(userId: number, accountId: number, through: string): void {
	if (!ownsAccount(userId, accountId, null)) throw new Error('Account not found.');
	if (!DATE_RE.test(through)) throw new Error('Enter a statement date.');
	db()
		.query(
			`UPDATE transactions SET cleared = 1, updated_at = datetime('now')
			 WHERE user_id = ? AND account_id = ? AND date <= ? AND reconciled_at IS NULL`
		)
		.run(userId, accountId, through);
}

export function dismissDuplicate(
	userId: number,
	accountId: number,
	manualId: number,
	syncedId: number
): void {
	if (!ownsAccount(userId, accountId, null)) throw new Error('Account not found.');
	assertIdsOnAccount(userId, accountId, [manualId, syncedId]);
	db()
		.query(
			`INSERT INTO reconcile_duplicate_dismissals
			   (user_id, account_id, transaction_id, match_transaction_id, dismissed_at)
			 VALUES (?, ?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, transaction_id, match_transaction_id) DO NOTHING`
		)
		.run(userId, accountId, manualId, syncedId);
}

export function unlockTransaction(userId: number, id: number): void {
	const row = db()
		.query(`SELECT id FROM transactions WHERE id = ? AND user_id = ?`)
		.get(id, userId) as { id: number } | null;
	if (!row) throw new Error('Transaction not found.');
	db()
		.query(
			`UPDATE transactions SET reconciled_at = NULL, updated_at = datetime('now')
			 WHERE id = ? AND user_id = ?`
		)
		.run(id, userId);
}

function balanceAdjustmentCategoryId(userId: number): number {
	seedBalanceAdjustmentCategories(db());
	const row = db()
		.query(`SELECT id FROM categories WHERE user_id = ? AND system_kind = ?`)
		.get(userId, BALANCE_ADJUSTMENT_KIND) as { id: number } | null;
	if (!row) throw new Error(`Missing the ${BALANCE_ADJUSTMENT_NAME} category.`);
	return row.id;
}

/**
 * Apply every staged ledger change and lock cleared rows in one transaction.
 * Refuses unless the statement would land on $0.00 left to explain.
 */
export function finishReconcile(userId: number, accountId: number, plan: FinishPlan): { marked: number } {
	if (!DATE_RE.test(plan.statementDate)) throw new Error('Enter a statement date.');
	if (!Number.isInteger(plan.bankBalanceCents)) throw new Error('Enter the bank balance.');
	const adjustment = plan.adjustment;
	if (adjustment) {
		if (!Number.isInteger(adjustment.amountCents)) throw new Error('Enter an adjustment amount.');
		if (!DATE_RE.test(adjustment.date)) throw new Error('Enter an adjustment date.');
	}
	const addIds = [...new Set(plan.addUnimportedIds)].filter((id) => Number.isInteger(id) && id > 0);
	const deleteIds = [...new Set(plan.deleteIds)].filter((id) => Number.isInteger(id) && id > 0);

	const database = db();
	database.run('BEGIN');
	try {
		const loaded = loadReconcile(userId, accountId, null);
		if (!loaded) throw new Error('Account not found.');
		const view = buildReconcileView({
			openingCents: loaded.account.opening_balance_cents ?? 0,
			openingAsOf: loaded.account.opening_as_of,
			through: plan.statementDate,
			bankCents: plan.bankBalanceCents,
			rows: loaded.rows,
			missing: loaded.missing,
			dismissedPairs: loaded.dismissedPairs,
			lastStatementDate: loaded.lastStatementDate,
			showAll: true,
			stagedAddIds: addIds,
			stagedDeleteIds: deleteIds,
			stagedAdjustmentCents: adjustment?.amountCents ?? null,
			stagedAdjustmentDate: adjustment?.date ?? null
		});
		if (view.previewLeftCents !== 0) {
			throw new Error('Left to explain must be $0.00 before finishing. Nothing was changed.');
		}

		if (deleteIds.length > 0) {
			assertIdsOnAccount(userId, accountId, deleteIds);
			const locked = database
				.query(
					`SELECT COUNT(*) AS n FROM transactions
					 WHERE user_id = ? AND reconciled_at IS NOT NULL
					   AND id IN (${deleteIds.map(() => '?').join(',')})`
				)
				.get(userId, ...deleteIds) as { n: number };
			if (locked.n > 0) throw new Error(RECONCILED_LOCK);
			holdProviderTransactions(userId, deleteIds, database);
			database
				.query(
					`DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND reconciled_at IS NULL
					   AND id IN (${deleteIds.map(() => '?').join(',')})`
				)
				.run(userId, accountId, ...deleteIds);
		}

		for (const id of addIds) {
			const line = database
				.query(
					`SELECT id, date, amount_cents, merchant, notes, provider, external_id, pending
					 FROM sync_unimported WHERE id = ? AND user_id = ? AND account_id = ?`
				)
				.get(id, userId, accountId) as {
				id: number;
				date: string;
				amount_cents: number;
				merchant: string | null;
				notes: string | null;
				provider: string;
				external_id: string;
				pending: number;
			} | null;
			if (!line) throw new Error('That bank line is no longer available.');
			const existing = database
				.query(`SELECT id FROM transactions WHERE user_id = ? AND provider = ? AND external_id = ?`)
				.get(userId, line.provider, line.external_id) as { id: number } | null;
			if (!existing) {
				database
					.query(
						`INSERT INTO transactions (
						   user_id, account_id, date, amount_cents, merchant, notes, provider, external_id,
						   pending, cleared
						 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
					)
					.run(
						userId,
						accountId,
						line.date,
						line.amount_cents,
						line.merchant,
						line.notes,
						line.provider,
						line.external_id,
						line.pending
					);
			}
			database.query(`DELETE FROM sync_unimported WHERE id = ? AND user_id = ?`).run(line.id, userId);
		}

		if (adjustment && adjustment.amountCents !== 0) {
			const categoryId = balanceAdjustmentCategoryId(userId);
			const note = adjustment.note.trim().slice(0, 500) || `Reconcile ${plan.statementDate}`;
			database
				.query(
					`INSERT INTO transactions (
					   user_id, account_id, category_id, date, amount_cents, merchant, notes, cleared
					 ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
				)
				.run(userId, accountId, categoryId, adjustment.date, adjustment.amountCents, BALANCE_ADJUSTMENT_NAME, note);
		}

		const openingAsOf = loaded.account.opening_as_of;
		const marked = database
			.query(
				`UPDATE transactions SET reconciled_at = datetime('now'), updated_at = datetime('now')
				 WHERE user_id = ? AND account_id = ? AND cleared = 1 AND reconciled_at IS NULL
				   AND date <= ?
				   AND (? IS NULL OR date >= ?)`
			)
			.run(userId, accountId, plan.statementDate, openingAsOf, openingAsOf);
		database
			.query(
				`INSERT INTO reconcile_sessions (user_id, account_id, statement_date, bank_balance_cents, finished_at)
				 VALUES (?, ?, ?, ?, datetime('now'))`
			)
			.run(userId, accountId, plan.statementDate, plan.bankBalanceCents);
		database.run('COMMIT');
		return { marked: marked.changes };
	} catch (error) {
		database.run('ROLLBACK');
		throw error;
	}
}
