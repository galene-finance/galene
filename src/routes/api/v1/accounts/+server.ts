import { apiUser, json, unauthorized } from '$lib/server/api';
import { ACCOUNT_BALANCE_EXPR, accountBalanceAsOfExpr } from '$lib/server/finance';
import { db } from '$lib/server/db';
import type { AccountType } from '$lib/types';

interface AccountWithBalance {
	id: number;
	name: string;
	type: AccountType;
	color: string | null;
	provider: string | null;
	/** Signed opening balance in cents; null until set (issue #44). */
	opening_balance_cents: number | null;
	/** YYYY-MM-DD as-of for opening; null until set. */
	opening_as_of: string | null;
	/**
	 * Ledger balance: COALESCE(opening_balance_cents, 0) + SUM(txns on/after
	 * opening_as_of). Opening is the balance *before* those transactions.
	 */
	balance_cents: number;
	/** Last provider/bank balance in signed cents; null until sync (issue #45). */
	provider_balance_cents: number | null;
	/** UTC DB datetime for provider balance; null when unset. */
	provider_balance_as_of: string | null;
}

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	const scope = event.locals.viewer?.scope ?? null;
	const accountClause =
		scope && scope.accountIds.length > 0 ? ` AND a.id IN (${scope.accountIds.map(() => '?').join(',')})` : '';
	// A viewer sees the ledger through the grant end date, matching the pack.
	// Provider columns stay null so bank identifiers never leave the owner session.
	const providerCols = scope
		? 'NULL AS provider, NULL AS provider_balance_cents, NULL AS provider_balance_as_of'
		: 'a.provider, a.provider_balance_cents, a.provider_balance_as_of';
	const balanceExpr = scope ? accountBalanceAsOfExpr() : ACCOUNT_BALANCE_EXPR;
	const params: (number | string)[] = scope ? [scope.dateTo, user.id, ...scope.accountIds] : [user.id];
	const rows = db()
		.query(
			`SELECT a.id, a.name, a.type, a.color,
			        a.opening_balance_cents, a.opening_as_of,
			        ${providerCols},
			        ${balanceExpr} AS balance_cents
			 FROM accounts a
			 LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
			 WHERE a.user_id = ?${accountClause}
			 GROUP BY a.id
			 ORDER BY a.name`
		)
		.all(...params) as AccountWithBalance[];
	return json(200, {
		accounts: rows.map((r) => ({
			...r,
			balance_cents: Math.round(r.balance_cents)
		}))
	});
}
