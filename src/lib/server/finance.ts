import { db } from './db';
import { parseAmountToCents } from '$lib/utils';
import type {
	Account,
	AccountType,
	Budget,
	CashflowViewFilters,
	CategorizationRule,
	Category,
	CategoryType,
	ForecastBehavior,
	RepeatUnit,
	RuleCondition,
	Scheduled,
	Tag,
	Transaction,
	TransactionSplit
} from '$lib/types';


/** Map a DB category row (type + is_transfer) to the public CategoryType. */
function categoryTypeFromRow(type: string, isTransfer: number): CategoryType {
	return isTransfer ? 'transfer' : type === 'income' ? 'income' : 'expense';
}

/** Persist a public CategoryType as (type CHECK value, is_transfer flag). */
function categoryDbFields(type: CategoryType): { type: 'expense' | 'income'; is_transfer: number } {
	if (type === 'transfer') return { type: 'expense', is_transfer: 1 };
	return { type, is_transfer: 0 };
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export function getAccounts(userId: number): Account[] {
	return db()
		.query(
			`SELECT id, name, type, color, provider, opening_balance_cents, opening_as_of,
			        provider_balance_cents, provider_balance_as_of
			 FROM accounts WHERE user_id = ? ORDER BY name`
		)
		.all(userId) as Account[];
}

/**
 * Account / total balance rule (issue #44):
 *   balance = COALESCE(opening_balance_cents, 0) + SUM(txns on/after opening_as_of)
 * When opening_as_of is NULL, all transactions are included (legacy SUM-only behavior
 * when opening is also NULL). Opening is the balance *before* transactions dated
 * on or after the as-of date.
 */
export const ACCOUNT_BALANCE_EXPR = `COALESCE(a.opening_balance_cents, 0) + COALESCE(SUM(
	CASE
		WHEN a.opening_as_of IS NULL OR t.date >= a.opening_as_of THEN t.amount_cents
		ELSE 0
	END
), 0)`;

/** Per-account balances for a user (id → cents). */
export function getAccountBalances(userId: number): Map<number, number> {
	const rows = db()
		.query(
			`SELECT a.id AS id, ${ACCOUNT_BALANCE_EXPR} AS balance_cents
			 FROM accounts a
			 LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
			 WHERE a.user_id = ?
			 GROUP BY a.id`
		)
		.all(userId) as { id: number; balance_cents: number }[];
	return new Map(rows.map((r) => [r.id, Math.round(r.balance_cents)]));
}

/**
 * Per-account transaction anchors for opening-balance suggestions (issue #47).
 * When the default as-of is the earliest txn date, SUM(on/after as-of) equals
 * the full account txn sum.
 */
export function getAccountTxnAnchors(
	userId: number
): Map<number, { earliestDate: string | null; sumAllCents: number }> {
	const rows = db()
		.query(
			`SELECT account_id AS id,
			        MIN(date) AS earliest_date,
			        COALESCE(SUM(amount_cents), 0) AS sum_cents
			 FROM transactions
			 WHERE user_id = ?
			 GROUP BY account_id`
		)
		.all(userId) as { id: number; earliest_date: string | null; sum_cents: number }[];
	return new Map(
		rows.map((r) => [
			r.id,
			{ earliestDate: r.earliest_date, sumAllCents: Math.round(r.sum_cents) }
		])
	);
}

/** Sum of all account balances (openings + relevant transactions). */
export function getTotalBalanceCents(userId: number): number {
	const row = db()
		.query(
			`SELECT COALESCE(SUM(bal), 0) AS s FROM (
				SELECT ${ACCOUNT_BALANCE_EXPR} AS bal
				FROM accounts a
				LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
				WHERE a.user_id = ?
				GROUP BY a.id
			)`
		)
		.get(userId) as { s: number };
	return Math.round(row.s);
}

/**
 * Sensible transfer defaults for a brand-new user (idempotent).
 * Call from signup / createUser — not from getCategories — so deleting these
 * categories is not silently undone on the next page load (issue #41).
 */
export function ensureDefaultTransferCategories(userId: number) {
	for (const name of ['Credit card payment', 'Transfer']) {
		const existing = db()
			.query(
				`SELECT id FROM categories
				 WHERE user_id = ? AND lower(name) = lower(?) AND is_transfer = 1`
			)
			.get(userId, name) as { id: number } | undefined;
		if (existing) continue;
		try {
			db()
				.query(
					'INSERT INTO categories (user_id, name, type, parent_id, color, is_transfer) VALUES (?, ?, ?, NULL, NULL, 1)'
				)
				.run(userId, name, 'expense');
		} catch {
			// UNIQUE (user_id, name, type) — an expense/income row with the same name already exists.
		}
	}
}

export function getCategories(userId: number): Category[] {
	const rows = db()
		.query('SELECT id, name, type, parent_id, color, is_transfer FROM categories WHERE user_id = ? ORDER BY name')
		.all(userId) as {
			id: number;
			name: string;
			type: string;
			parent_id: number | null;
			color: string | null;
			is_transfer: number;
		}[];
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		type: categoryTypeFromRow(r.type, r.is_transfer),
		parent_id: r.parent_id,
		color: r.color
	}));
}

export function getTags(userId: number): Tag[] {
	return db().query('SELECT id, name FROM tags WHERE user_id = ? ORDER BY name').all(userId) as Tag[];
}

// ---------------------------------------------------------------------------
// Accounts / categories / tags CRUD
// ---------------------------------------------------------------------------

export function saveAccount(
	userId: number,
	id: number | null,
	data: {
		name: string;
		type: AccountType;
		color: string | null;
		/** Signed cents; null clears / leaves unset. */
		opening_balance_cents?: number | null;
		/** YYYY-MM-DD; null clears. Both opening fields should be set or both null. */
		opening_as_of?: string | null;
	}
) {
	const openingCents =
		data.opening_balance_cents === undefined ? undefined : data.opening_balance_cents;
	const openingAsOf = data.opening_as_of === undefined ? undefined : data.opening_as_of;
	if (id) {
		if (openingCents !== undefined && openingAsOf !== undefined) {
			db()
				.query(
					`UPDATE accounts SET name = ?, type = ?, color = ?,
					 opening_balance_cents = ?, opening_as_of = ?
					 WHERE id = ? AND user_id = ?`
				)
				.run(data.name, data.type, data.color ?? null, openingCents, openingAsOf, id, userId);
		} else {
			db()
				.query('UPDATE accounts SET name = ?, type = ?, color = ? WHERE id = ? AND user_id = ?')
				.run(data.name, data.type, data.color ?? null, id, userId);
		}
	} else {
		db()
			.query(
				`INSERT INTO accounts (user_id, name, type, color, opening_balance_cents, opening_as_of)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(
				userId,
				data.name,
				data.type,
				data.color ?? null,
				openingCents ?? null,
				openingAsOf ?? null
			);
	}
}

/**
 * Delete an account after reassigning its transactions (and scheduled) to another account.
 * `reassignTo` is required — transactions.account_id is NOT NULL (no "none").
 */
export function deleteAccount(userId: number, id: number, reassignTo: number) {
	const owned = db()
		.query('SELECT id FROM accounts WHERE id = ? AND user_id = ?')
		.get(id, userId) as { id: number } | undefined;
	if (!owned) throw new Error('Account not found.');

	if (!Number.isFinite(reassignTo) || reassignTo === id) {
		throw new Error('Choose another account to move transactions to.');
	}
	const target = db()
		.query('SELECT id FROM accounts WHERE id = ? AND user_id = ?')
		.get(reassignTo, userId) as { id: number } | undefined;
	if (!target) throw new Error('Replacement account not found.');

	const d = db();
	d.run('BEGIN');
	try {
		d.query(
			`UPDATE transactions SET account_id = ?, updated_at = datetime('now')
			 WHERE user_id = ? AND account_id = ?`
		).run(reassignTo, userId, id);

		d.query(
			`UPDATE scheduled SET account_id = ?
			 WHERE user_id = ? AND account_id = ?`
		).run(reassignTo, userId, id);

		const result = d.query('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, userId);
		if (result.changes === 0) throw new Error('Account could not be deleted.');

		// Drop removed id from cashflow view filters so stale picks don't linger.
		const raw = d
			.query('SELECT value FROM settings WHERE user_id = ? AND key = ?')
			.get(userId, 'cashflow_filters') as { value: string } | undefined;
		if (raw?.value) {
			try {
				const parsed = JSON.parse(raw.value) as { accountIds?: unknown; categoryIds?: unknown };
				const accountIds = Array.isArray(parsed.accountIds)
					? (parsed.accountIds as unknown[])
							.map((n) => Number(n))
							.filter((n) => Number.isFinite(n) && n !== id)
					: [];
				const next = JSON.stringify({
					accountIds,
					categoryIds: Array.isArray(parsed.categoryIds) ? parsed.categoryIds : []
				});
				d.query('UPDATE settings SET value = ? WHERE user_id = ? AND key = ?').run(
					next,
					userId,
					'cashflow_filters'
				);
			} catch {
				// Ignore malformed preference JSON.
			}
		}

		d.run('COMMIT');
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

export function saveCategory(
	userId: number,
	id: number | null,
	data: { name: string; type: CategoryType; parent_id: number | null; color: string | null }
) {
	const fields = categoryDbFields(data.type);
	if (id) {
		db()
			.query(
				'UPDATE categories SET name = ?, type = ?, parent_id = ?, color = ?, is_transfer = ? WHERE id = ? AND user_id = ?'
			)
			.run(data.name, fields.type, data.parent_id, data.color ?? null, fields.is_transfer, id, userId);
	} else {
		db()
			.query(
				'INSERT INTO categories (user_id, name, type, parent_id, color, is_transfer) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(userId, data.name, fields.type, data.parent_id, data.color ?? null, fields.is_transfer);
	}
}

/** Collect subcategory ids under `id` (depth-first), same user only. */
function categoryDescendantIds(userId: number, id: number): number[] {
	const rows = db()
		.query('SELECT id, parent_id FROM categories WHERE user_id = ?')
		.all(userId) as { id: number; parent_id: number | null }[];
	const children = new Map<number, number[]>();
	for (const r of rows) {
		if (r.parent_id == null) continue;
		const list = children.get(r.parent_id) ?? [];
		list.push(r.id);
		children.set(r.parent_id, list);
	}
	const out: number[] = [];
	const stack = [...(children.get(id) ?? [])];
	while (stack.length) {
		const n = stack.pop()!;
		out.push(n);
		stack.push(...(children.get(n) ?? []));
	}
	return out;
}

/**
 * Delete a category after reassigning its (and its descendants') transactions.
 * `reassignTo` is another category id, or null for uncategorized (None).
 * Subcategories are removed with the parent (schema ON DELETE CASCADE).
 */
export function deleteCategory(userId: number, id: number, reassignTo: number | null = null) {
	const owned = db()
		.query('SELECT id FROM categories WHERE id = ? AND user_id = ?')
		.get(id, userId) as { id: number } | undefined;
	if (!owned) throw new Error('Category not found.');

	const descendants = categoryDescendantIds(userId, id);
	const removing = new Set([id, ...descendants]);
	if (reassignTo != null) {
		if (removing.has(reassignTo)) {
			throw new Error('Choose a different category — not this one or a subcategory.');
		}
		const target = db()
			.query('SELECT id FROM categories WHERE id = ? AND user_id = ?')
			.get(reassignTo, userId) as { id: number } | undefined;
		if (!target) throw new Error('Replacement category not found.');
	}

	const ids = [id, ...descendants];
	const placeholders = ids.map(() => '?').join(',');
	const d = db();
	d.run('BEGIN');
	try {
		d.query(
			`UPDATE transactions SET category_id = ?, updated_at = datetime('now')
			 WHERE user_id = ? AND category_id IN (${placeholders})`
		).run(reassignTo, userId, ...ids);

		if (reassignTo != null) {
			d.query(
				`UPDATE transaction_splits SET category_id = ?
				 WHERE category_id IN (${placeholders})
				   AND transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)`
			).run(reassignTo, ...ids, userId);
		} else {
			// Splits require a category; drop rows that pointed at the removed ones.
			d.query(
				`DELETE FROM transaction_splits
				 WHERE category_id IN (${placeholders})
				   AND transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)`
			).run(...ids, userId);
		}

		d.query(
			`UPDATE scheduled SET category_id = ?
			 WHERE user_id = ? AND category_id IN (${placeholders})`
		).run(reassignTo, userId, ...ids);

		// Children cascade via parent_id; budgets/rules for removed ids cascade too.
		const result = d.query('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId);
		if (result.changes === 0) throw new Error('Category could not be deleted.');

		// Drop removed ids from cashflow view filters so stale picks don't linger.
		const raw = d
			.query('SELECT value FROM settings WHERE user_id = ? AND key = ?')
			.get(userId, 'cashflow_filters') as { value: string } | undefined;
		if (raw?.value) {
			try {
				const parsed = JSON.parse(raw.value) as { accountIds?: unknown; categoryIds?: unknown };
				const catIds = Array.isArray(parsed.categoryIds)
					? (parsed.categoryIds as unknown[])
							.map((n) => Number(n))
							.filter((n) => Number.isFinite(n) && !removing.has(n))
					: [];
				const next = JSON.stringify({
					accountIds: Array.isArray(parsed.accountIds) ? parsed.accountIds : [],
					categoryIds: catIds
				});
				d.query('UPDATE settings SET value = ? WHERE user_id = ? AND key = ?').run(
					next,
					userId,
					'cashflow_filters'
				);
			} catch {
				// Ignore malformed preference JSON.
			}
		}

		d.run('COMMIT');
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

export function saveTag(userId: number, id: number | null, name: string) {
	if (id) {
		db().query('UPDATE tags SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
	} else {
		db().query('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(userId, name);
	}
}

/**
 * Delete a tag after detaching it from transactions and scheduled (many-to-many).
 * Junction rows also CASCADE, but we detach explicitly so delete never depends on FK alone.
 */
export function deleteTag(userId: number, id: number) {
	const owned = db()
		.query('SELECT id FROM tags WHERE id = ? AND user_id = ?')
		.get(id, userId) as { id: number } | undefined;
	if (!owned) throw new Error('Tag not found.');

	const d = db();
	d.run('BEGIN');
	try {
		d.query(
			`DELETE FROM transaction_tags
			 WHERE tag_id = ?
			   AND transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)`
		).run(id, userId);
		d.query(
			`DELETE FROM scheduled_tags
			 WHERE tag_id = ?
			   AND scheduled_id IN (SELECT id FROM scheduled WHERE user_id = ?)`
		).run(id, userId);

		const result = d.query('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, userId);
		if (result.changes === 0) throw new Error('Tag could not be deleted.');

		d.run('COMMIT');
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

/** Create a tag if it does not exist (case-insensitive match). Returns the id. */
export function getOrCreateTag(userId: number, name: string): number {
	const trimmed = name.trim();
	const existing = db()
		.query('SELECT id FROM tags WHERE user_id = ? AND lower(name) = lower(?)')
		.get(userId, trimmed) as { id: number } | undefined;
	if (existing) return existing.id;
	const result = db().query('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(userId, trimmed);
	return Number(result.lastInsertRowid);
}

/** Create a category if it does not exist (unique on name+type). Returns the id. */
export function getOrCreateCategory(userId: number, name: string, type: CategoryType): number {
	const trimmed = name.trim();
	const fields = categoryDbFields(type);
	// Match by public type: transfer rows are stored as type=expense + is_transfer=1.
	const existing = db()
		.query(
			`SELECT id FROM categories
			 WHERE user_id = ? AND lower(name) = lower(?) AND type = ? AND is_transfer = ?`
		)
		.get(userId, trimmed, fields.type, fields.is_transfer) as { id: number } | undefined;
	if (existing) return existing.id;
	const result = db()
		.query(
			'INSERT INTO categories (user_id, name, type, parent_id, is_transfer) VALUES (?, ?, ?, NULL, ?)'
		)
		.run(userId, trimmed, fields.type, fields.is_transfer);
	return Number(result.lastInsertRowid);
}

/** Create an account if it does not exist (case-insensitive name match). Returns the id. */
export function getOrCreateAccount(userId: number, name: string, type: AccountType = 'bank'): number {
	const trimmed = name.trim();
	const existing = db()
		.query('SELECT id FROM accounts WHERE user_id = ? AND lower(name) = lower(?)')
		.get(userId, trimmed) as { id: number } | undefined;
	if (existing) return existing.id;
	const result = db().query('INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)').run(userId, trimmed, type);
	return Number(result.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionFilters {
	accountIds: number[];
	categoryIds: number[];
	tagIds: number[];
	amountOp: '' | 'eq' | 'between' | 'gt' | 'lt';
	amountFrom: number | null; // cents, absolute value
	amountTo: number | null; // cents, absolute value
	dateFrom: string | null;
	dateTo: string | null;
	q: string;
	page: number;
	pageSize: number;
}

export interface TransactionQueryResult {
	items: Transaction[];
	total: number;
	pages: number;
}

export function getTransactions(userId: number, f: TransactionFilters): TransactionQueryResult {
	const where: string[] = ['t.user_id = ?'];
	const params: (number | string)[] = [userId];

	if (f.accountIds.length > 0) {
		where.push(`t.account_id IN (${f.accountIds.map(() => '?').join(',')})`);
		params.push(...f.accountIds);
	}
	if (f.categoryIds.length > 0) {
		where.push(`t.category_id IN (${f.categoryIds.map(() => '?').join(',')})`);
		params.push(...f.categoryIds);
	}
	if (f.tagIds.length > 0) {
		where.push(
			`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id IN (${f.tagIds
				.map(() => '?')
				.join(',')}))`
		);
		params.push(...f.tagIds);
	}
	if (f.q.trim() !== '') {
		// lower() so ASCII search is case-insensitive (SQLite LIKE can be case-sensitive
		// depending on build / PRAGMA case_sensitive_like).
		const q = `%${f.q.trim().toLowerCase()}%`;
		where.push('(lower(t.merchant) LIKE ? OR lower(t.notes) LIKE ?)');
		params.push(q, q);
	}
	if (f.dateFrom) {
		where.push('t.date >= ?');
		params.push(f.dateFrom);
	}
	if (f.dateTo) {
		where.push('t.date <= ?');
		params.push(f.dateTo);
	}
	switch (f.amountOp) {
		case 'eq':
			where.push('ABS(t.amount_cents) = ?');
			params.push(f.amountFrom ?? 0);
			break;
		case 'gt':
			where.push('ABS(t.amount_cents) > ?');
			params.push(f.amountFrom ?? 0);
			break;
		case 'lt':
			where.push('ABS(t.amount_cents) < ?');
			params.push(f.amountFrom ?? 0);
			break;
		case 'between':
			where.push('ABS(t.amount_cents) BETWEEN ? AND ?');
			params.push(f.amountFrom ?? 0, f.amountTo ?? 0);
			break;
	}

	const whereSql = where.join(' AND ');
	const countRow = db()
		.query(`SELECT COUNT(*) AS c FROM transactions t WHERE ${whereSql}`)
		.get(...params) as { c: number };
	const total = countRow.c;

	const rows = db()
		.query(
			`SELECT t.id, t.account_id, t.category_id, t.date, t.amount_cents, t.merchant, t.notes, t.color,
			        a.name AS account_name, c.name AS category_name, c.color AS category_color,
			        CASE WHEN c.id IS NULL THEN NULL WHEN c.is_transfer = 1 THEN 'transfer' ELSE c.type END AS category_type
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE ${whereSql}
			 ORDER BY t.date DESC, t.id DESC
			 LIMIT ? OFFSET ?`
		)
		.all(...params, f.pageSize, (f.page - 1) * f.pageSize) as (Transaction & {
		account_name: string;
		category_name: string | null;
		category_color: string | null;
		category_type: CategoryType | null;
	})[];

	const items = attachSplits(userId, attachTags(userId, rows));
	return { items, total, pages: Math.max(1, Math.ceil(total / f.pageSize)) };
}

function attachTags(userId: number, rows: Transaction[]): Transaction[] {
	if (rows.length === 0) return rows;
	const ids = rows.map((r) => r.id);
	const tagRows = db()
		.query(
			`SELECT tt.transaction_id, tg.id, tg.name
			 FROM transaction_tags tt
			 JOIN tags tg ON tg.id = tt.tag_id
			 WHERE tt.transaction_id IN (${ids.map(() => '?').join(',')}) AND tg.user_id = ?
			 ORDER BY tg.name`
		)
		.all(...ids, userId) as { transaction_id: number; id: number; name: string }[];
	const byTx = new Map<number, { name: string; id: number }[]>();
	for (const row of tagRows) {
		const list = byTx.get(row.transaction_id) ?? [];
		list.push({ name: row.name, id: row.id });
		byTx.set(row.transaction_id, list);
	}
	for (const row of rows) {
		const list = byTx.get(row.id) ?? [];
		row.tags = list.map((t) => t.name);
		row.tag_ids = list.map((t) => t.id);
	}
	return rows;
}

export interface TransactionInput {
	id?: number;
	type: 'expense' | 'income';
	amountCents: number;
	date: string;
	account: number;
	category: number | null;
	merchant: string | null;
	notes: string | null;
	color: string | null;
	tags: number[];
}

/**
 * Parses a transaction form (the Add/Edit dialog layout) into a TransactionInput.
 * Shared by the transactions page and the calendar page.
 */
export function transactionInputFromForm(userId: number, form: FormData): { input?: TransactionInput; error?: string } {
	const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
	const type = form.get('type') === 'income' ? 'income' : 'expense';
	const amount = parseAmountToCents(String(form.get('amount') ?? ''));
	const date = String(form.get('date') ?? '');
	const merchant = String(form.get('merchant') ?? '').trim() || null;
	const notes = String(form.get('notes') ?? '').trim() || null;
	const color = String(form.get('color') ?? '').trim() || null;

	if (amount === null || amount === 0) return { error: 'Enter a valid, non-zero amount.' };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Enter a valid date.' };

	const accountNew = String(form.get('account_new') ?? '').trim();
	const accountExisting = String(form.get('account_id') ?? '').trim();
	let accountId: number;
	if (accountNew) {
		accountId = getOrCreateAccount(userId, accountNew);
	} else if (accountExisting) {
		const account = getAccounts(userId).find((a) => a.id === parseInt(accountExisting, 10));
		if (!account) return { error: 'Select a valid account.' };
		accountId = account.id;
	} else {
		return { error: 'Select an account.' };
	}

	const categoryNew = String(form.get('category_new') ?? '').trim();
	const categoryExisting = String(form.get('category_id') ?? '').trim();
	let categoryId: number | null = null;
	if (categoryNew) {
		categoryId = getOrCreateCategory(userId, categoryNew, type);
	} else if (categoryExisting) {
		const category = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
		if (category) categoryId = category.id;
	}

	const tagIds = form
		.getAll('tags')
		.map((t) => parseInt(String(t), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	const tagNew = String(form.get('tag_new') ?? '').trim();
	if (tagNew) tagIds.push(getOrCreateTag(userId, tagNew));

	return {
		input: {
			id: id ?? undefined,
			type,
			amountCents: amount,
			date,
			account: accountId,
			category: categoryId,
			merchant,
			notes,
			color,
			tags: tagIds
		}
	};
}

export function saveTransaction(userId: number, input: TransactionInput) {
	const amountCents = input.type === 'expense' ? -Math.abs(input.amountCents) : Math.abs(input.amountCents);
	if (input.id) {
		db()
			.query(
				`UPDATE transactions
				 SET account_id = ?, category_id = ?, date = ?, amount_cents = ?, merchant = ?, notes = ?, color = ?,
				     updated_at = datetime('now')
				 WHERE id = ? AND user_id = ?`
			)
			.run(
				input.account,
				input.category,
				input.date,
				amountCents,
				input.merchant,
				input.notes,
				input.color ?? null,
				input.id,
				userId
			);
		setTransactionTags(userId, input.id, input.tags);
	} else {
		const result = db()
			.query(
				`INSERT INTO transactions (user_id, account_id, category_id, date, amount_cents, merchant, notes, color)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(userId, input.account, input.category, input.date, amountCents, input.merchant, input.notes, input.color ?? null);
		const newId = Number(result.lastInsertRowid);
		setTransactionTags(userId, newId, input.tags);
		input.id = newId;
	}
	// Auto-categorization: only fills in a missing category, never overrides an explicit one.
	if (input.category == null && input.id) applyCategorizationRules(userId, input.id);
}

function setTransactionTags(userId: number, transactionId: number, tagIds: number[]) {
	const valid = db()
		.query('SELECT id FROM tags WHERE user_id = ? AND id IN (' + (tagIds.length ? tagIds.map(() => '?').join(',') : 'NULL') + ')')
		.all(userId, ...tagIds) as { id: number }[];
	db().query('DELETE FROM transaction_tags WHERE transaction_id = ?').run(transactionId);
	for (const tag of valid) {
		db().query('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(transactionId, tag.id);
	}
}

export function deleteTransaction(userId: number, id: number) {
	db().query('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId);
}

export function bulkDeleteTransactions(userId: number, ids: number[]) {
	if (ids.length === 0) return;
	db()
		.query(`DELETE FROM transactions WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
		.run(userId, ...ids);
}

export function bulkSetCategory(userId: number, ids: number[], categoryId: number | null) {
	if (ids.length === 0) return;
	db()
		.query(`UPDATE transactions SET category_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
		.run(categoryId, userId, ...ids);
	// An explicit category choice makes the transaction single-category again.
	db()
		.query(`DELETE FROM transaction_splits WHERE transaction_id IN (${ids.map(() => '?').join(',')})`)
		.run(...ids);
}

/** All transactions in [from, to) with tags and splits attached. */
export function getTransactionsInPeriod(userId: number, from: string, to: string): Transaction[] {
	const rows = db()
		.query(
			`SELECT t.id, t.account_id, t.category_id, t.date, t.amount_cents, t.merchant, t.notes, t.color,
			        a.name AS account_name, c.name AS category_name, c.color AS category_color,
			        CASE WHEN c.id IS NULL THEN NULL WHEN c.is_transfer = 1 THEN 'transfer' ELSE c.type END AS category_type
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date < ?
			 ORDER BY t.date, t.id`
		)
		.all(userId, from, to) as (Transaction & {
		account_name: string;
		category_name: string | null;
		category_color: string | null;
		category_type: CategoryType | null;
	})[];
	return attachSplits(userId, attachTags(userId, rows));
}

// ---------------------------------------------------------------------------
// Home summary
// ---------------------------------------------------------------------------

export interface HomeSummary {
	balanceCents: number;
	monthIncomeCents: number;
	monthExpenseCents: number;
	monthLabel: string;
	recent: Transaction[];
	topCategories: { name: string; color: string | null; cents: number }[];
}

export function getHomeSummary(userId: number): HomeSummary {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;
	const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
	const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

	// Total balance includes opening anchors (issue #44), not raw SUM(transactions).
	const balanceCents = getTotalBalanceCents(userId);

	const incomeRow = db()
		.query(
			`SELECT COALESCE(SUM(t.amount_cents), 0) AS s
			 FROM transactions t
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.amount_cents > 0
			   AND COALESCE(c.is_transfer, 0) = 0`
		)
		.get(userId, monthStart, nextMonth) as { s: number };

	const expenseRow = db()
		.query(
			`SELECT COALESCE(SUM(-t.amount_cents), 0) AS s
			 FROM transactions t
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.amount_cents < 0
			   AND COALESCE(c.is_transfer, 0) = 0`
		)
		.get(userId, monthStart, nextMonth) as { s: number };

	const recent = db()
		.query(
			`SELECT t.id, t.account_id, t.category_id, t.date, t.amount_cents, t.merchant, t.notes, t.color,
			        a.name AS account_name, c.name AS category_name, c.color AS category_color,
			        CASE WHEN c.id IS NULL THEN NULL WHEN c.is_transfer = 1 THEN 'transfer' ELSE c.type END AS category_type
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ?
			 ORDER BY t.date DESC, t.id DESC
			 LIMIT 10`
		)
		.all(userId) as (Transaction & { account_name: string; category_name: string | null; category_color: string | null })[];

	const topCategories = db()
		.query(
			`SELECT COALESCE(c.name, 'Uncategorized') AS name, c.color AS color, SUM(-amt) AS cents
			 FROM (
				  -- Split allocations are stored as positive; negate so -amt is a positive
				  -- expense contribution, matching the unsplit branch below.
				  SELECT s.category_id AS cat_id, -s.amount_cents AS amt
				  FROM transaction_splits s
				  JOIN transactions t ON t.id = s.transaction_id
				  WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.amount_cents < 0
				  UNION ALL
				  SELECT t.category_id, t.amount_cents
				  FROM transactions t
				  WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.amount_cents < 0
				    AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
			 )
			 LEFT JOIN categories c ON c.id = cat_id
			 WHERE COALESCE(c.is_transfer, 0) = 0
			 GROUP BY c.id
			 ORDER BY cents DESC
			 LIMIT 5`
		)
		.all(userId, monthStart, nextMonth, userId, monthStart, nextMonth) as {
		name: string;
		color: string | null;
		cents: number;
	}[];

	return {
		balanceCents,
		monthIncomeCents: incomeRow.s,
		monthExpenseCents: expenseRow.s,
		monthLabel: monthLabelFromISO(monthStart),
		recent: attachTags(userId, recent),
		topCategories
	};
}

function monthLabelFromISO(iso: string): string {
	const [y, m] = iso.split('-').map(Number);
	return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSetting(userId: number, key: string): string | null {
	const row = db().query('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function setSetting(userId: number, key: string, value: string) {
	db()
		.query(
			`INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
			 ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`
		)
		.run(userId, key, value);
}

// ---------------------------------------------------------------------------
// Date helpers (UTC-based to avoid DST drift)
// ---------------------------------------------------------------------------

function parseISO(iso: string): { y: number; m: number; d: number } {
	const [y, m, d] = iso.split('-').map(Number);
	return { y, m, d };
}

function toISO(y: number, m: number, d: number): string {
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLeapYear(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function addInterval(iso: string, interval: number, unit: RepeatUnit): string {
	const { y, m, d } = parseISO(iso);
	switch (unit) {
		case 'day':
		case 'week': {
			const dt = new Date(Date.UTC(y, m - 1, d + interval * (unit === 'week' ? 7 : 1)));
			return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
		}
		case 'month': {
			const total = m - 1 + interval;
			const ny = y + Math.floor(total / 12);
			const nm = (total % 12) + 1;
			return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
		}
		case 'year': {
			const ny = y + interval;
			const nd = m === 2 && d === 29 && !isLeapYear(ny) ? 28 : d;
			return toISO(ny, m, nd);
		}
	}
}

/** All occurrence dates of a scheduled expectation within [from, to] (inclusive). */
export function getOccurrences(s: Scheduled, from: string, to: string): string[] {
	const out: string[] = [];
	if (s.start_date > to) return out;
	if (!s.repeat_interval || !s.repeat_unit || s.repeat_interval < 1) {
		if (s.start_date >= from && s.start_date <= to) out.push(s.start_date);
		return out;
	}
	let cur = s.start_date;
	for (let i = 0; i < 2000; i++) {
		if (cur > to) break;
		if (cur >= from) out.push(cur);
		if (s.until_date && cur > s.until_date) break;
		cur = addInterval(cur, s.repeat_interval, s.repeat_unit);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function getBudgets(userId: number): (Budget & { category_name: string; category_color: string | null })[] {
	return db()
		.query(
			`SELECT b.id, b.category_id, b.period, b.limit_cents,
			        c.name AS category_name, c.color AS category_color
			 FROM budgets b
			 JOIN categories c ON c.id = b.category_id
			 WHERE b.user_id = ?
			 ORDER BY c.name, CASE b.period WHEN 'week' THEN 0 WHEN 'month' THEN 1 ELSE 2 END`
		)
		.all(userId) as (Budget & { category_name: string; category_color: string | null })[];
}

export function saveBudget(
	userId: number,
	id: number | null,
	data: { categoryId: number; period: Budget['period']; limitCents: number }
) {
	if (id) {
		db()
			.query('UPDATE budgets SET category_id = ?, period = ?, limit_cents = ? WHERE id = ? AND user_id = ?')
			.run(data.categoryId, data.period, data.limitCents, id, userId);
	} else {
		db()
			.query(
				`INSERT INTO budgets (user_id, category_id, period, limit_cents) VALUES (?, ?, ?, ?)
				 ON CONFLICT (user_id, category_id, period) DO UPDATE SET limit_cents = excluded.limit_cents`
			)
			.run(userId, data.categoryId, data.period, data.limitCents);
	}
}

export function deleteBudget(userId: number, id: number) {
	db().query('DELETE FROM budgets WHERE id = ? AND user_id = ?').run(id, userId);
}

/** [from, to) bounds of the current week (Monday start), month, or year. */
export function currentPeriodBounds(period: Budget['period'], ref: Date = new Date()): { from: string; to: string } {
	const y = ref.getFullYear();
	const m = ref.getMonth() + 1;
	if (period === 'month') {
		return { from: toISO(y, m, 1), to: toISO(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) };
	}
	if (period === 'year') {
		return { from: toISO(y, 1, 1), to: toISO(y + 1, 1, 1) };
	}
	const fromD = new Date(Date.UTC(y, m - 1, 1 - ((ref.getDay() + 6) % 7)));
	const toD = new Date(fromD.getTime() + 7 * 86400000);
	return {
		from: toISO(fromD.getUTCFullYear(), fromD.getUTCMonth() + 1, fromD.getUTCDate()),
		to: toISO(toD.getUTCFullYear(), toD.getUTCMonth() + 1, toD.getUTCDate())
	};
}

/**
 * Signed total (cents) for one category in a period (negative for expenses).
 * Split transactions are counted by their allocations; unsplit by their own amount.
 * Split amounts are stored positive, so the transaction's sign is applied here.
 */
export function categoryAmountInPeriod(userId: number, categoryId: number, from: string, to: string): number {
	const splitRow = db()
		.query(
			`SELECT COALESCE(SUM(s.amount_cents * SIGN(t.amount_cents)), 0) AS s
			 FROM transaction_splits s
			 JOIN transactions t ON t.id = s.transaction_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND s.category_id = ?`
		)
		.get(userId, from, to, categoryId) as { s: number };
	const txRow = db()
		.query(
			`SELECT COALESCE(SUM(t.amount_cents), 0) AS s
			 FROM transactions t
			 WHERE t.user_id = ? AND t.date >= ? AND t.date < ? AND t.category_id = ?
			   AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`
		)
		.get(userId, from, to, categoryId) as { s: number };
	return splitRow.s + txRow.s;
}

// ---------------------------------------------------------------------------
// Scheduled expectations
// ---------------------------------------------------------------------------

export interface ScheduledInput {
	id?: number;
	name: string;
	amountCents: number;
	startDate: string;
	account: number | null;
	category: number | null;
	notes: string | null;
	color: string | null;
	repeats: boolean;
	repeatInterval: number | null;
	repeatUnit: RepeatUnit | null;
	untilDate: string | null;
	forecastBehavior: ForecastBehavior;
	tags: number[];
}

export function getScheduled(userId: number): Scheduled[] {
	const rows = db()
		.query(
			`SELECT s.id, s.name, s.account_id, s.category_id, s.amount_cents, s.start_date,
			        s.repeat_interval, s.repeat_unit, s.until_date, s.forecast_behavior, s.color, s.notes,
			        a.name AS account_name, c.name AS category_name
			 FROM scheduled s
			 LEFT JOIN accounts a ON a.id = s.account_id
			 LEFT JOIN categories c ON c.id = s.category_id
			 WHERE s.user_id = ?
			 ORDER BY s.start_date, s.id`
		)
		.all(userId) as Scheduled[];
	return attachScheduledTags(userId, rows);
}

function attachScheduledTags(userId: number, rows: Scheduled[]): Scheduled[] {
	if (rows.length === 0) return rows;
	const ids = rows.map((r) => r.id);
	const tagRows = db()
		.query(
			`SELECT st.scheduled_id, tg.id, tg.name
			 FROM scheduled_tags st
			 JOIN tags tg ON tg.id = st.tag_id
			 WHERE st.scheduled_id IN (${ids.map(() => '?').join(',')}) AND tg.user_id = ?
			 ORDER BY tg.name`
		)
		.all(...ids, userId) as { scheduled_id: number; id: number; name: string }[];
	const byId = new Map<number, { name: string; id: number }[]>();
	for (const row of tagRows) {
		const list = byId.get(row.scheduled_id) ?? [];
		list.push({ name: row.name, id: row.id });
		byId.set(row.scheduled_id, list);
	}
	for (const row of rows) {
		const list = byId.get(row.id) ?? [];
		row.tags = list.map((t) => t.name);
		row.tag_ids = list.map((t) => t.id);
	}
	return rows;
}

/**
 * Parses a scheduled-expectation form (the AddScheduledDialog layout) into a
 * ScheduledInput. Shared by the calendar page and the transactions page.
 */
export function scheduledInputFromForm(userId: number, form: FormData): { input?: ScheduledInput; error?: string } {
	const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { error: 'Enter a name for this expectation.' };
	const amount = parseAmountToCents(String(form.get('amount') ?? ''));
	if (amount === null || amount === 0) return { error: 'Enter a valid, non-zero amount.' };
	const startDate = String(form.get('start_date') ?? '');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { error: 'Enter a valid start date.' };

	const accountNew = String(form.get('account_new') ?? '').trim();
	const accountExisting = String(form.get('account_id') ?? '').trim();
	let account: number | null = null;
	if (accountNew) {
		account = getOrCreateAccount(userId, accountNew);
	} else if (accountExisting) {
		const acc = getAccounts(userId).find((a) => a.id === parseInt(accountExisting, 10));
		if (acc) account = acc.id;
	}

	const type = form.get('type') === 'income' ? 'income' : 'expense';
	const categoryNew = String(form.get('category_new') ?? '').trim();
	const categoryExisting = String(form.get('category_id') ?? '').trim();
	let category: number | null = null;
	if (categoryNew) {
		category = getOrCreateCategory(userId, categoryNew, type);
	} else if (categoryExisting) {
		const cat = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
		if (cat) category = cat.id;
	}

	const repeats = form.get('repeats') === '1';
	let repeatInterval: number | null = null;
	let repeatUnit: RepeatUnit | null = null;
	if (repeats) {
		const iv = parseInt(String(form.get('repeat_interval') ?? '1'), 10);
		const unit = String(form.get('repeat_unit') ?? 'month');
		if (!Number.isFinite(iv) || iv < 1) return { error: 'The repeat interval must be at least 1.' };
		if (!['day', 'week', 'month', 'year'].includes(unit)) return { error: 'Invalid repeat unit.' };
		repeatInterval = iv;
		repeatUnit = unit as RepeatUnit;
	}
	const untilDate = String(form.get('until_date') ?? '').trim() || null;
	if (untilDate && !/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) return { error: 'Enter a valid until date.' };

	const forecastBehavior = (form.get('forecast_behavior') === 'spread' ? 'spread' : 'bill') as ForecastBehavior;
	const color = String(form.get('color') ?? '').trim() || null;
	const notes = String(form.get('notes') ?? '').trim() || null;

	const tagIds = form
		.getAll('tags')
		.map((v) => parseInt(String(v), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	const tagNew = String(form.get('tag_new') ?? '').trim();
	if (tagNew) tagIds.push(getOrCreateTag(userId, tagNew));

	return {
		input: {
			id: id ?? undefined,
			name,
			amountCents: amount,
			startDate,
			account,
			category,
			notes,
			color,
			repeats,
			repeatInterval,
			repeatUnit,
			untilDate,
			forecastBehavior,
			tags: tagIds
		}
	};
}

export function saveScheduled(userId: number, input: ScheduledInput) {
	const repeatInterval = input.repeats && input.repeatUnit ? input.repeatInterval ?? 1 : null;
	const repeatUnit = input.repeats && input.repeatUnit ? input.repeatUnit : null;
	if (input.id) {
		db()
			.query(
				`UPDATE scheduled
				 SET name = ?, account_id = ?, category_id = ?, amount_cents = ?, start_date = ?,
				     repeat_interval = ?, repeat_unit = ?, until_date = ?, forecast_behavior = ?, color = ?, notes = ?
				 WHERE id = ? AND user_id = ?`
			)
			.run(
				input.name,
				input.account,
				input.category,
				input.amountCents,
				input.startDate,
				repeatInterval,
				repeatUnit,
				input.untilDate,
				input.forecastBehavior,
				input.color ?? null,
				input.notes ?? null,
				input.id,
				userId
			);
	} else {
		const result = db()
			.query(
				`INSERT INTO scheduled
				 (user_id, name, account_id, category_id, amount_cents, start_date,
				  repeat_interval, repeat_unit, until_date, forecast_behavior, color, notes)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				userId,
				input.name,
				input.account,
				input.category,
				input.amountCents,
				input.startDate,
				repeatInterval,
				repeatUnit,
				input.untilDate,
				input.forecastBehavior,
				input.color ?? null,
				input.notes ?? null
			);
		input.id = Number(result.lastInsertRowid);
	}
	setScheduledTags(userId, input.id!, input.tags);
}

function setScheduledTags(userId: number, scheduledId: number, tagIds: number[]) {
	const valid = db()
		.query('SELECT id FROM tags WHERE user_id = ? AND id IN (' + (tagIds.length ? tagIds.map(() => '?').join(',') : 'NULL') + ')')
		.all(userId, ...tagIds) as { id: number }[];
	db().query('DELETE FROM scheduled_tags WHERE scheduled_id = ?').run(scheduledId);
	for (const tag of valid) {
		db().query('INSERT OR IGNORE INTO scheduled_tags (scheduled_id, tag_id) VALUES (?, ?)').run(scheduledId, tag.id);
	}
}

export function deleteScheduled(userId: number, id: number) {
	db().query('DELETE FROM scheduled WHERE id = ? AND user_id = ?').run(id, userId);
}

// ---------------------------------------------------------------------------
// Categorization rules
// ---------------------------------------------------------------------------

export function getRules(userId: number): (CategorizationRule & { category_name: string | null })[] {
	const rows = db()
		.query(
			`SELECT r.id, r.name, r.conditions, r.category_id, r.priority, r.enabled, c.name AS category_name
			 FROM categorization_rules r
			 LEFT JOIN categories c ON c.id = r.category_id
			 WHERE r.user_id = ?
			 ORDER BY r.priority DESC, r.id`
		)
		.all(userId) as (CategorizationRule & { category_name: string | null; conditions: string })[];
	return rows.map((r) => ({
		...r,
		conditions: JSON.parse(r.conditions) as RuleCondition[],
		enabled: Number(r.enabled)
	}));
}

export function saveRule(
	userId: number,
	id: number | null,
	data: { name: string; conditions: RuleCondition[]; categoryId: number }
): number {
	if (id) {
		db()
			.query('UPDATE categorization_rules SET name = ?, conditions = ?, category_id = ? WHERE id = ? AND user_id = ?')
			.run(data.name, JSON.stringify(data.conditions), data.categoryId, id, userId);
		return id;
	}
	const result = db()
		.query(
			'INSERT INTO categorization_rules (user_id, name, conditions, category_id, priority, enabled) VALUES (?, ?, ?, ?, 0, 1)'
		)
		.run(userId, data.name, JSON.stringify(data.conditions), data.categoryId);
	return Number(result.lastInsertRowid);
}

export function deleteRule(userId: number, id: number) {
	db().query('DELETE FROM categorization_rules WHERE id = ? AND user_id = ?').run(id, userId);
}

export function setRuleEnabled(userId: number, id: number, enabled: boolean) {
	db().query('UPDATE categorization_rules SET enabled = ? WHERE id = ? AND user_id = ?').run(enabled ? 1 : 0, id, userId);
}

function ruleMatches(
	conditions: RuleCondition[],
	tx: { merchant: string | null; amount_cents: number; account_id: number }
): boolean {
	if (conditions.length === 0) return false;
	return conditions.every((c) => {
		if (c.field === 'merchant') {
			if (tx.merchant == null) return false;
			const lm = tx.merchant.toLowerCase();
			const lv = String(c.value ?? '').trim().toLowerCase();
			if (lv === '') return false;
			return c.op === 'equals' ? lm === lv : lm.includes(lv);
		}
		if (c.field === 'account') return String(tx.account_id) === String(c.value);
		const a = Math.abs(tx.amount_cents);
		const v = Number(c.value);
		if (!Number.isFinite(v)) return false;
		switch (c.op) {
			case 'equals':
				return a === v;
			case 'gt':
				return a > v;
			case 'lt':
				return a < v;
			case 'between':
				return a >= v && a <= Number(c.value2 ?? v);
			default:
				return false;
		}
	});
}

/** Fills a missing category on a transaction from the first matching enabled rule. */
export function applyCategorizationRules(userId: number, txId: number) {
	const tx = db()
		.query('SELECT account_id, amount_cents, merchant, category_id FROM transactions WHERE id = ? AND user_id = ?')
		.get(txId, userId) as
		| { account_id: number; amount_cents: number; merchant: string | null; category_id: number | null }
		| undefined;
	if (!tx || tx.category_id != null) return;
	for (const rule of getRules(userId).filter((r) => r.enabled === 1)) {
		if (ruleMatches(rule.conditions, tx)) {
			db()
				.query('UPDATE transactions SET category_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND category_id IS NULL')
				.run(rule.category_id, txId);
			return;
		}
	}
}

/**
 * Applies rules to existing transactions that have no category.
 * With `ruleId`, only that rule runs (regardless of its enabled state);
 * without, all enabled rules run in priority order, first match wins.
 * Transactions that already have a category are never touched.
 * Returns the number of transactions categorized.
 */
export function backfillCategorizationRules(userId: number, ruleId?: number): number {
	const rules = getRules(userId).filter((r) => (ruleId != null ? r.id === ruleId : r.enabled === 1));
	if (rules.length === 0) return 0;
	const txs = db()
		.query('SELECT id, account_id, amount_cents, merchant FROM transactions WHERE user_id = ? AND category_id IS NULL')
		.all(userId) as { id: number; account_id: number; amount_cents: number; merchant: string | null }[];
	let count = 0;
	for (const tx of txs) {
		for (const rule of rules) {
			if (ruleMatches(rule.conditions, tx)) {
				db()
					.query('UPDATE transactions SET category_id = ?, updated_at = datetime(\'now\') WHERE id = ? AND category_id IS NULL')
					.run(rule.category_id, tx.id);
				count++;
				break;
			}
		}
	}
	return count;
}

/** Number of the user's transactions that have no category. */
export function countUncategorized(userId: number): number {
	const row = db()
		.query('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND category_id IS NULL')
		.get(userId) as { c: number } | undefined;
	return Number(row?.c ?? 0);
}

// ---------------------------------------------------------------------------
// Split transactions
// ---------------------------------------------------------------------------

export function saveTransactionSplits(
	userId: number,
	txId: number,
	splits: { categoryId: number; amountCents: number }[]
) {
	const tx = db()
		.query('SELECT amount_cents FROM transactions WHERE id = ? AND user_id = ?')
		.get(txId, userId) as { amount_cents: number } | undefined;
	if (!tx) throw new Error('Transaction not found.');
	const total = Math.abs(tx.amount_cents);
	const sum = splits.reduce((s, x) => s + x.amountCents, 0);
	if (splits.length === 0 || sum !== total) {
		throw new Error('Splits must add up to the transaction amount.');
	}
	db().query('DELETE FROM transaction_splits WHERE transaction_id = ?').run(txId);
	for (const s of splits) {
		db()
			.query('INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)')
			.run(txId, s.categoryId, s.amountCents);
	}
	// The transaction's own category becomes the primary (first) split.
	db()
		.query('UPDATE transactions SET category_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
		.run(splits[0].categoryId, txId);
}

export function clearTransactionSplits(userId: number, txId: number) {
	db().query('DELETE FROM transaction_splits WHERE transaction_id = ?').run(txId);
}

function attachSplits(userId: number, rows: Transaction[]): Transaction[] {
	if (rows.length === 0) return rows;
	const ids = rows.map((r) => r.id);
	const splitRows = db()
		.query(
			`SELECT s.transaction_id, s.category_id, s.amount_cents, c.name AS category_name
			 FROM transaction_splits s
			 LEFT JOIN categories c ON c.id = s.category_id
			 WHERE s.transaction_id IN (${ids.map(() => '?').join(',')})
			 ORDER BY s.id`
		)
		.all(...ids) as { transaction_id: number; category_id: number; category_name: string | null; amount_cents: number }[];
	const byTx = new Map<number, TransactionSplit[]>();
	for (const row of splitRows) {
		const list = byTx.get(row.transaction_id) ?? [];
		list.push({ category_id: row.category_id, category_name: row.category_name, amount_cents: row.amount_cents });
		byTx.set(row.transaction_id, list);
	}
	for (const row of rows) {
		const list = byTx.get(row.id);
		if (list && list.length > 0) row.splits = list;
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export function bulkAddTags(userId: number, txIds: number[], tagIds: number[]) {
	if (txIds.length === 0 || tagIds.length === 0) return;
	const valid = db()
		.query('SELECT id FROM tags WHERE user_id = ? AND id IN (' + tagIds.map(() => '?').join(',') + ')')
		.all(userId, ...tagIds) as { id: number }[];
	for (const txId of txIds) {
		for (const tag of valid) {
			db().query('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)').run(txId, tag.id);
		}
	}
}

// ---------------------------------------------------------------------------
// Cashflow
// ---------------------------------------------------------------------------

/** Forecast and actual for one category in one month, as positive magnitudes. */
export interface CashflowCell {
	forecastCents: number;
	actualCents: number;
}

export interface CashflowSectionRow {
	categoryId: number | null;
	categoryName: string;
	categoryColor: string | null;
	cells: CashflowCell[];
	totalForecastCents: number;
	totalActualCents: number;
}

/** One section of the cashflow table (income or expense), one row per category. */
export interface CashflowSection {
	type: 'income' | 'expense';
	rows: CashflowSectionRow[];
	monthTotals: CashflowCell[];
	totalForecastCents: number;
	totalActualCents: number;
}

/**
 * Per-category signed totals (cents) for [from, to).
 * Split transactions count by their allocations; unsplit by their own amount.
 * One entry per category with activity (null = uncategorized).
 */
export function categoryTotalsInPeriod(
	userId: number,
	from: string,
	to: string,
	accountIds?: number[]
): { categoryId: number | null; signedCents: number }[] {
	const accountFilter =
		accountIds && accountIds.length > 0
			? ` AND t.account_id IN (${accountIds.map(() => '?').join(',')})`
			: '';
	const accountParams = accountIds && accountIds.length > 0 ? accountIds : [];
	const rows = db()
		.query(
			`SELECT cat_id, COALESCE(SUM(amt), 0) AS s
			 FROM (
				  -- Split allocations are stored positive; apply the transaction's sign.
				  SELECT s.category_id AS cat_id, s.amount_cents * SIGN(t.amount_cents) AS amt
				  FROM transaction_splits s
				  JOIN transactions t ON t.id = s.transaction_id
				  WHERE t.user_id = ? AND t.date >= ? AND t.date < ?${accountFilter}
				  UNION ALL
				  SELECT t.category_id, t.amount_cents
				  FROM transactions t
				  WHERE t.user_id = ? AND t.date >= ? AND t.date < ?
				    AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)${accountFilter}
			 )
			 GROUP BY cat_id`
		)
		.all(userId, from, to, ...accountParams, userId, from, to, ...accountParams) as {
			cat_id: number | null;
			s: number;
		}[];
	return rows.map((r) => ({ categoryId: r.cat_id, signedCents: r.s }));
}

/**
 * Per-category forecast (signed cents) for [from, to) from scheduled expectations.
 * 'bill' books the full amount on the occurrence date; 'spread' divides it evenly
 * across the days of its month (same monthly total, different daily distribution).
 * The sign follows the category's type; a missing category is treated as expense.
 */
export function forecastByCategory(
	userId: number,
	from: string,
	to: string,
	opts?: { accountIds?: number[]; includeTransferIds?: ReadonlySet<number> }
): Map<number | null, number> {
	const catById = new Map(getCategories(userId).map((c) => [c.id, c]));
	const lastDay = addInterval(to, -1, 'day');
	const out = new Map<number | null, number>();
	const accountIds = opts?.accountIds;
	const includeTransferIds = opts?.includeTransferIds;
	for (const s of getScheduled(userId)) {
		if (accountIds && accountIds.length > 0) {
			if (s.account_id == null || !accountIds.includes(s.account_id)) continue;
		}
		const cat = s.category_id != null ? catById.get(s.category_id) : undefined;
		// Transfers stay out of forecasts unless the cashflow gear explicitly includes them.
		if (cat?.type === 'transfer' && !(s.category_id != null && includeTransferIds?.has(s.category_id))) {
			continue;
		}
		const sign = cat?.type === 'income' ? 1 : -1;
		for (const date of getOccurrences(s, from, lastDay)) {
			out.set(s.category_id, (out.get(s.category_id) ?? 0) + sign * s.amount_cents);
		}
	}
	return out;
}

/**
 * Total spending (cents, positive) for [from, to): the sum of the magnitude of
 * each category's net total that is negative (net spending), split-aware.
 * Reuses categoryTotalsInPeriod so it matches the budget and cashflow pages
 * exactly. categoryId null = all categories.
 */
export function monthSpendingCents(userId: number, from: string, to: string, categoryId: number | null): number {
	const transferIds = new Set(getCategories(userId).filter((c) => c.type === 'transfer').map((c) => c.id));
	let spending = 0;
	for (const r of categoryTotalsInPeriod(userId, from, to)) {
		if (categoryId != null && r.categoryId !== categoryId) continue;
		if (r.categoryId != null && transferIds.has(r.categoryId)) continue;
		if (r.signedCents < 0) spending += -r.signedCents;
	}
	return spending;
}

/** All budgets (any period) for one category (null = all categories). */
export function budgetsForCategory(userId: number, categoryId: number | null): Budget[] {
	return db()
		.query(
			`SELECT id, category_id, period, limit_cents
			 FROM budgets
			 WHERE user_id = ?${categoryId != null ? ' AND category_id = ?' : ''}`
		)
		.all(...(categoryId != null ? [userId, categoryId] : [userId])) as Budget[];
}

/** Total limit (cents) of budgets with the given period, for one category (null = all categories). */
export function periodBudgetCents(userId: number, period: Budget['period'], categoryId: number | null): number {
	const row = db()
		.query(
			`SELECT COALESCE(SUM(limit_cents), 0) AS s
			 FROM budgets
			 WHERE user_id = ? AND period = ?${categoryId != null ? ' AND category_id = ?' : ''}`
		)
		.get(...(categoryId != null ? [userId, period, categoryId] : [userId, period])) as { s: number };
	return row.s;
}

/** Total limit (cents) of month-period budgets for one category (null = all categories). */
export function monthBudgetCents(userId: number, categoryId: number | null): number {
	return periodBudgetCents(userId, 'month', categoryId);
}

// ---------------------------------------------------------------------------
// Cashflow (month arithmetic + shared forecast/actual builder)
// ---------------------------------------------------------------------------

/** [first day, first day of next month) of a 'YYYY-MM' month. */
export function monthBounds(month: string): { from: string; to: string } {
	const [y, m] = month.split('-').map(Number);
	return {
		from: `${month}-01`,
		to: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
	};
}

/** Last day of the month, e.g. '2026-09-30' — the inclusive bound for occurrences. */
export function lastDayOfMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return `${month}-${String(days).padStart(2, '0')}`;
}

/** Shift a 'YYYY-MM' by delta months (may cross year boundaries). */
export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const total = y * 12 + (m - 1) + delta;
	const ny = Math.floor(total / 12);
	const nm = ((total % 12) + 12) % 12 + 1;
	return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Whole months from one 'YYYY-MM' to another (to - from). */
export function monthDiff(from: string, to: string): number {
	const [fy, fm] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	return (ty * 12 + tm) - (fy * 12 + fm);
}

export interface CashflowSummary {
	forecastIncomeCents: number;
	forecastExpenseCents: number;
	actualIncomeCents: number;
	actualExpenseCents: number;
}

/** Per-user cashflow page view filters (issue #37). Empty arrays = all. */
export type { CashflowViewFilters };

export const CASHFLOW_FILTERS_KEY = 'cashflow_filters';

export const DEFAULT_CASHFLOW_FILTERS: CashflowViewFilters = { accountIds: [], categoryIds: [] };

/** Normalize unknown JSON into known account/category ids for this user. */
export function sanitizeCashflowFilters(userId: number, raw: unknown): CashflowViewFilters {
	const accountSet = new Set(getAccounts(userId).map((a) => a.id));
	const categorySet = new Set(getCategories(userId).map((c) => c.id));
	const parseIds = (v: unknown, allowed: Set<number>): number[] => {
		if (!Array.isArray(v)) return [];
		const ids = new Set<number>();
		for (const item of v) {
			const n = typeof item === 'number' ? item : parseInt(String(item), 10);
			if (Number.isFinite(n) && allowed.has(n)) ids.add(n);
		}
		return [...ids].sort((a, b) => a - b);
	};
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		accountIds: parseIds(obj.accountIds, accountSet),
		categoryIds: parseIds(obj.categoryIds, categorySet)
	};
}

export function getCashflowFilters(userId: number): CashflowViewFilters {
	const raw = getSetting(userId, CASHFLOW_FILTERS_KEY);
	if (raw === null) return { ...DEFAULT_CASHFLOW_FILTERS };
	try {
		return sanitizeCashflowFilters(userId, JSON.parse(raw));
	} catch {
		return { ...DEFAULT_CASHFLOW_FILTERS };
	}
}

export function saveCashflowFilters(userId: number, raw: unknown): CashflowViewFilters {
	const sanitized = sanitizeCashflowFilters(userId, raw);
	setSetting(userId, CASHFLOW_FILTERS_KEY, JSON.stringify(sanitized));
	return sanitized;
}

/** True when the user has narrowed accounts or categories away from the defaults. */
export function cashflowFiltersActive(filters: CashflowViewFilters): boolean {
	return filters.accountIds.length > 0 || filters.categoryIds.length > 0;
}

/**
 * Per-category forecast vs. actual for a list of whole months ('YYYY-MM'),
 * in the order given. Shared by the cashflow page and the API.
 * Optional view filters (issue #37): account/category include lists.
 * Transfer categories stay excluded unless explicitly listed in categoryIds.
 */
export function cashflowForMonths(
	userId: number,
	monthList: string[],
	filters: CashflowViewFilters = DEFAULT_CASHFLOW_FILTERS
): { sections: { income: CashflowSection; expense: CashflowSection }; summary: CashflowSummary } {
	const catById = new Map(getCategories(userId).map((c) => [c.id, c]));
	const accountIds = filters.accountIds.length > 0 ? filters.accountIds : undefined;
	const categoryFilter = filters.categoryIds.length > 0 ? new Set(filters.categoryIds) : null;
	const includeTransferIds = new Set(
		[...catById.values()].filter((c) => c.type === 'transfer' && categoryFilter?.has(c.id)).map((c) => c.id)
	);

	// Per-month signed totals per category: actuals and forecast.
	const actualByMonth = monthList.map((month) => {
		const { from, to } = monthBounds(month);
		return new Map(categoryTotalsInPeriod(userId, from, to, accountIds).map((r) => [r.categoryId, r.signedCents]));
	});
	const forecastByMonth = monthList.map((month) => {
		const { from, to } = monthBounds(month);
		return forecastByCategory(userId, from, to, { accountIds, includeTransferIds });
	});

	function buildSection(type: 'income' | 'expense'): CashflowSection {
		const catIds = new Set<number | null>();
		for (const map of [...actualByMonth, ...forecastByMonth]) for (const id of map.keys()) catIds.add(id);

		const rows: CashflowSectionRow[] = [...catIds]
			.map((id) => {
				const cat = id != null ? catById.get(id) : undefined;
				// Transfer categories: excluded unless the gear explicitly selected them.
				if (cat?.type === 'transfer') {
					if (!categoryFilter || id == null || !categoryFilter.has(id)) return null;
				} else if (categoryFilter) {
					// Specific category list: drop uncategorized and non-selected.
					if (id == null || !categoryFilter.has(id)) return null;
				}
				// Uncategorized counts as expense, matching forecastByCategory's sign.
				const isIncome = id != null && cat?.type === 'income';
				if (type === 'income' ? !isIncome : isIncome) return null;
				// Raw signed values: income positive, expense negative.
				const cells = monthList.map((_, i) => ({
					forecastCents: Math.round(forecastByMonth[i].get(id) ?? 0),
					actualCents: Math.round(actualByMonth[i].get(id) ?? 0)
				}));
				return {
					categoryId: id,
					categoryName: cat?.name ?? 'Uncategorized',
					categoryColor: cat?.color ?? null,
					cells,
					totalForecastCents: cells.reduce((s, c) => s + c.forecastCents, 0),
					totalActualCents: cells.reduce((s, c) => s + c.actualCents, 0)
				};
			})
			.filter((r): r is CashflowSectionRow => r !== null)
			.filter((r) => r.totalForecastCents !== 0 || r.totalActualCents !== 0)
			.sort((a, b) => a.categoryName.localeCompare(b.categoryName));

		const monthTotals = monthList.map((_, i) => ({
			forecastCents: rows.reduce((s, r) => s + r.cells[i].forecastCents, 0),
			actualCents: rows.reduce((s, r) => s + r.cells[i].actualCents, 0)
		}));

		return {
			type,
			rows,
			monthTotals,
			totalForecastCents: monthTotals.reduce((s, c) => s + c.forecastCents, 0),
			totalActualCents: monthTotals.reduce((s, c) => s + c.actualCents, 0)
		};
	}

	const income = buildSection('income');
	const expense = buildSection('expense');

	return {
		sections: { income, expense },
		// Cards show positive magnitudes; the table cells stay signed (expense negative).
		summary: {
			forecastIncomeCents: income.totalForecastCents,
			forecastExpenseCents: -expense.totalForecastCents,
			actualIncomeCents: income.totalActualCents,
			actualExpenseCents: -expense.totalActualCents
		}
	};
}
