/**
 * Empty transaction filter (#68). Temp database only.
 * account_id is NOT NULL, so this does not insert a null account.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'galene-empty-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';

const { migrate } = await import('./db');
const { getTransactions } = await import('./finance');

const database = new Database(process.env.GALENE_DB_PATH);
database.exec('PRAGMA foreign_keys = ON;');
migrate(database);

function filters(emptyFields: Array<'account' | 'category' | 'merchant' | 'tag'>) {
	return {
		accountIds: [] as number[],
		categoryIds: [] as number[],
		tagIds: [] as number[],
		emptyFields,
		amountOp: '' as const,
		amountFrom: null,
		amountTo: null,
		dateFrom: null,
		dateTo: null,
		q: '',
		page: 1,
		pageSize: 50
	};
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('empty transaction filter', () => {
	test('merchant, category, tag, and OR', () => {
		database.query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Dev', 'dev@test', 'x', 1)`).run();
		const userId = Number((database.query('SELECT id FROM users').get() as { id: number }).id);
		database.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Card', 'credit')`).run(userId);
		const accountId = Number((database.query('SELECT id FROM accounts').get() as { id: number }).id);
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Food', 'expense')`).run(userId);
		const food = Number((database.query(`SELECT id FROM categories`).get() as { id: number }).id);
		database.query(`INSERT INTO categories (user_id, name, type, is_transfer) VALUES (?, 'Transfer', 'expense', 1)`).run(userId);
		const transfer = Number((database.query(`SELECT id FROM categories WHERE name = 'Transfer'`).get() as { id: number }).id);
		database.query(`INSERT INTO tags (user_id, name) VALUES (?, 'Trip')`).run(userId);
		const tagId = Number((database.query('SELECT id FROM tags').get() as { id: number }).id);

		function add(merchant: string | null, categoryId: number | null) {
			database
				.query(
					`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant, category_id)
					 VALUES (?, ?, '2026-09-01', -100, ?, ?)`
				)
				.run(userId, accountId, merchant, categoryId);
			return Number((database.query('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
		}

		const blank = add('   ', food);
		const named = add('Kroger', food);
		const uncategorized = add('Cafe', null);
		const splitParent = add('Split Cafe', null);
		database.query(`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, -100)`).run(splitParent, food);
		add('Move', transfer);
		const tagged = add('Tagged', food);
		database.query(`INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`).run(tagged, tagId);

		const merchants = (emptyFields: Array<'account' | 'category' | 'merchant' | 'tag'>) =>
			getTransactions(userId, filters(emptyFields)).items.map((row) => row.id);

		expect(merchants(['merchant'])).toEqual([blank]);
		expect(merchants(['category'])).toEqual([uncategorized]);
		expect(merchants(['tag'])).not.toContain(tagged);
		expect(merchants(['tag'])).toContain(named);
		const either = merchants(['category', 'merchant']);
		expect(either).toContain(blank);
		expect(either).toContain(uncategorized);
		expect(either).not.toContain(named);
		expect(either).not.toContain(splitParent);
	});
});
