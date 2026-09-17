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

		if (ownTx) d.run('COMMIT');
	} catch (error) {
		if (ownTx) d.run('ROLLBACK');
		throw error;
	}
}
