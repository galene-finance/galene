import { db } from './db';
import {
	getOrCreateAccount,
	getOrCreateCategory,
	getOrCreateTag,
	saveBudget,
	saveRule,
	saveScheduled,
	saveTransaction
} from './finance';
import { generateDemoRows, type DemoRow } from './providers/mock';
import type { CategoryType, RepeatUnit } from '$lib/types';

/**
 * Category for each demo-transaction category key. Transfers use type
 * "transfer" so they are excluded from cashflow income/expense. Per-direction
 * names keep the two sides distinguishable; "Credit card payment" / "Transfer"
 * are also seeded as sensible defaults (not forced onto existing user data).
 */
const CATS: Record<string, { name: string; type: CategoryType }> = {
	salary: { name: 'Salary', type: 'income' },
	rent: { name: 'Rent', type: 'expense' },
	'transfer-out': { name: 'Transfer out', type: 'transfer' },
	'transfer-in': { name: 'Transfer in', type: 'transfer' },
	'cc-payment': { name: 'Credit card payment', type: 'transfer' },
	'transfer': { name: 'Transfer', type: 'transfer' },
	sub1: { name: 'Subscriptions', type: 'expense' },
	sub2: { name: 'Subscriptions', type: 'expense' },
	utilities: { name: 'Utilities', type: 'expense' },
	groceries: { name: 'Groceries', type: 'expense' },
	coffee: { name: 'Coffee', type: 'expense' },
	dining: { name: 'Dining', type: 'expense' },
	gas: { name: 'Gas', type: 'expense' }
};

/** Tags assigned per category key. */
const TAGS: Record<string, string[]> = {
	rent: ['Essentials'],
	utilities: ['Essentials'],
	groceries: ['Essentials'],
	sub1: ['Recurring'],
	sub2: ['Recurring'],
	dining: ['Fun'],
	coffee: ['Fun']
};

const ACCOUNT_NAMES: Record<DemoRow['account'], string> = {
	checking: 'Checking',
	credit: 'Credit Card',
	savings: 'Savings'
};

/**
 * Populate a (usually new) account with demo data: three accounts, a set of
 * categories and tags, ~3 months of transactions, budgets, scheduled
 * expectations, and a few categorization rules. Everything is created under
 * the given user, so it never touches another account's data. Idempotent for
 * the reference data (getOrCreate*); running it twice is harmless.
 *
 * Runs in its own transaction by default. Pass `{ inTransaction: true }` when
 * the caller already has a transaction open — SQLite rejects a nested BEGIN,
 * so the seed then joins the caller's transaction, which commits or rolls it
 * back.
 */
export function seedDemoData(userId: number, opts?: { inTransaction?: boolean }): void {
	const d = db();
	const ownTx = !opts?.inTransaction;
	if (ownTx) d.run('BEGIN');
	try {
		const accounts: Record<DemoRow['account'], number> = {
			checking: getOrCreateAccount(userId, ACCOUNT_NAMES.checking, 'bank'),
			credit: getOrCreateAccount(userId, ACCOUNT_NAMES.credit, 'credit'),
			savings: getOrCreateAccount(userId, ACCOUNT_NAMES.savings, 'bank')
		};

		const categoryIds: Record<string, number> = {};
		for (const [key, cat] of Object.entries(CATS)) {
			if (categoryIds[key] == null) categoryIds[key] = getOrCreateCategory(userId, cat.name, cat.type);
		}

		const tagIds: Record<string, number> = {};
		for (const names of Object.values(TAGS)) {
			for (const name of names) {
				if (tagIds[name] == null) tagIds[name] = getOrCreateTag(userId, name);
			}
		}

		const rows = generateDemoRows();
		for (const r of rows) {
			const cat = CATS[r.cat];
			const tagList = TAGS[r.cat] ?? [];
			saveTransaction(userId, {
				type: r.amount_cents < 0 ? 'expense' : 'income',
				amountCents: Math.abs(r.amount_cents),
				date: r.date,
				account: accounts[r.account],
				category: categoryIds[r.cat],
				merchant: r.merchant,
				notes: null,
				color: null,
				tags: tagList.map((t) => tagIds[t])
			});
		}

		const budgets: [string, number][] = [
			['groceries', 60000],
			['dining', 30000],
			['gas', 15000]
		];
		for (const [catKey, limit] of budgets) {
			saveBudget(userId, null, { categoryId: categoryIds[catKey], period: 'month', limitCents: limit });
		}

		const scheduled: [string, number, DemoRow['account'], string, number, RepeatUnit][] = [
			['Payroll', 420000, 'checking', 'salary', 1, 'month'],
			['Rent', 180000, 'checking', 'rent', 1, 'month'],
			['StreamFlix', 1599, 'credit', 'sub1', 5, 'month'],
			['CloudBox', 1199, 'credit', 'sub2', 12, 'month'],
			['City Power & Light', 12000, 'checking', 'utilities', 15, 'month']
		];
		for (const [name, amount, account, catKey, day, unit] of scheduled) {
			const ref = new Date();
			const start = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(
				Math.min(day, 28)
			).padStart(2, '0')}`;
			saveScheduled(userId, {
				name,
				amountCents: amount,
				startDate: start,
				account: accounts[account],
				category: categoryIds[catKey],
				notes: null,
				color: null,
				repeats: true,
				repeatInterval: 1,
				repeatUnit: unit,
				untilDate: null,
				forecastBehavior: 'bill',
				tags: []
			});
		}

		const rules: [string, 'contains' | 'equals', string, string][] = [
			['FreshMart', 'equals', 'FreshMart', 'groceries'],
			['Corner Market', 'equals', 'Corner Market', 'groceries'],
			['GreenGrocer', 'equals', 'GreenGrocer', 'groceries'],
			['Coffee shop', 'equals', 'Daily Grind', 'coffee']
		];
		for (const [name, op, value, catKey] of rules) {
			saveRule(userId, null, {
				name,
				conditions: [{ field: 'merchant', op, value }],
				categoryId: categoryIds[catKey]
			});
		}

		seedReconcileSample(userId, accounts);

		if (ownTx) d.run('COMMIT');
	} catch (error) {
		if (ownTx) d.run('ROLLBACK');
		throw error;
	}
}

function isoDaysAgo(days: number): string {
	const now = new Date();
	const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - days * 86400000;
	return new Date(t).toISOString().slice(0, 10);
}

/**
 * Give the demo accounts a reconcile story: Checking has a gap (an uncleared
 * check, a duplicate, and a bank line that was not imported), Savings differs
 * by an opening-sized amount, Credit matches, and Cash has no bank balance.
 */
function seedReconcileSample(
	userId: number,
	accounts: Record<DemoRow['account'], number> & { cash?: number }
): void {
	const d = db();
	const cashId = getOrCreateAccount(userId, 'Cash', 'cash');
	saveTransaction(userId, {
		type: 'expense',
		amountCents: 1500,
		date: isoDaysAgo(2),
		account: cashId,
		category: null,
		merchant: 'Petty cash',
		notes: null,
		color: null,
		tags: []
	});

	const cutoff = isoDaysAgo(40);
	const markAccount = (accountId: number, prefix: string, reconcileBefore: string | null) => {
		const txns = d
			.query(
				`SELECT id, date FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY date, id`
			)
			.all(userId, accountId) as { id: number; date: string }[];
		for (const txn of txns) {
			const lock = reconcileBefore && txn.date < reconcileBefore ? 1 : 0;
			d.query(
				`UPDATE transactions
				 SET provider = 'demo', external_id = ?, cleared = 1,
				     reconciled_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
				 WHERE id = ? AND user_id = ?`
			).run(`${prefix}-${txn.id}`, lock, txn.id, userId);
		}
	};

	markAccount(accounts.checking, 'demo-checking', cutoff);
	markAccount(accounts.credit, 'demo-credit', cutoff);
	markAccount(accounts.savings, 'demo-savings', null);

	const sample = d
		.query(
			`SELECT date, amount_cents, merchant FROM transactions
			 WHERE user_id = ? AND account_id = ? AND date >= ? AND amount_cents < 0 AND merchant IS NOT NULL
			 ORDER BY date DESC LIMIT 1`
		)
		.get(userId, accounts.checking, cutoff) as { date: string; amount_cents: number; merchant: string } | null;

	saveTransaction(userId, {
		type: 'expense',
		amountCents: 12000,
		date: isoDaysAgo(3),
		account: accounts.checking,
		category: null,
		merchant: 'Check 1042',
		notes: 'Not at the bank yet',
		color: null,
		tags: []
	});
	if (sample) {
		saveTransaction(userId, {
			type: 'expense',
			amountCents: Math.abs(sample.amount_cents),
			date: sample.date,
			account: accounts.checking,
			category: null,
			merchant: sample.merchant,
			notes: 'Added by hand',
			color: null,
			tags: []
		});
	}

	const cleared = d
		.query(
			`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions
			 WHERE user_id = ? AND account_id = ? AND cleared = 1`
		)
		.get(userId, accounts.checking) as { s: number };
	d.query(
		`UPDATE accounts
		 SET provider = 'demo', external_id = 'demo-checking',
		     provider_balance_cents = ?, provider_balance_as_of = datetime('now')
		 WHERE id = ? AND user_id = ?`
	).run(cleared.s + 3738, accounts.checking, userId);
	d.query(
		`INSERT INTO sync_unimported (
		   user_id, account_id, provider, external_id, date, amount_cents, merchant, notes, pending, seen_at
		 ) VALUES (?, ?, 'demo', 'demo-missing-hardware', ?, 3738, 'Corner Hardware', 'Refund', 0, datetime('now'))`
	).run(userId, accounts.checking, isoDaysAgo(5));
	d.query(
		`INSERT INTO reconcile_sessions (user_id, account_id, statement_date, bank_balance_cents, finished_at)
		 VALUES (?, ?, ?, ?, datetime('now'))`
	).run(userId, accounts.checking, cutoff, cleared.s);

	const balanceOf = (accountId: number) =>
		(d
			.query(
				`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE user_id = ? AND account_id = ?`
			)
			.get(userId, accountId) as { s: number }).s;

	const creditBalance = balanceOf(accounts.credit);
	d.query(
		`UPDATE accounts
		 SET provider = 'demo', external_id = 'demo-credit',
		     provider_balance_cents = ?, provider_balance_as_of = datetime('now')
		 WHERE id = ? AND user_id = ?`
	).run(creditBalance, accounts.credit, userId);
	d.query(
		`INSERT INTO reconcile_sessions (user_id, account_id, statement_date, bank_balance_cents, finished_at)
		 VALUES (?, ?, ?, ?, datetime('now'))`
	).run(userId, accounts.credit, isoDaysAgo(1), creditBalance);

	const savingsBalance = balanceOf(accounts.savings);
	const earliest = d
		.query(`SELECT MIN(date) AS d FROM transactions WHERE user_id = ? AND account_id = ?`)
		.get(userId, accounts.savings) as { d: string | null };
	d.query(
		`UPDATE accounts
		 SET provider = 'demo', external_id = 'demo-savings',
		     opening_balance_cents = 0, opening_as_of = ?,
		     provider_balance_cents = ?, provider_balance_as_of = datetime('now')
		 WHERE id = ? AND user_id = ?`
	).run(earliest.d, savingsBalance + 25000, accounts.savings, userId);
}
