import { apiUser, json, unauthorized } from '$lib/server/api';
import { ACCOUNT_BALANCE_EXPR } from '$lib/server/finance';
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
	const rows = db()
		.query(
			`SELECT a.id, a.name, a.type, a.color, a.provider,
			        a.opening_balance_cents, a.opening_as_of,
			        a.provider_balance_cents, a.provider_balance_as_of,
			        ${ACCOUNT_BALANCE_EXPR} AS balance_cents
			 FROM accounts a
			 LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
			 WHERE a.user_id = ?
			 GROUP BY a.id
			 ORDER BY a.name`
		)
		.all(user.id) as AccountWithBalance[];
	return json(200, {
		accounts: rows.map((r) => ({
			...r,
			balance_cents: Math.round(r.balance_cents)
		}))
	});
}
