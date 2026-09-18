/**
 * Migration harness (#20): fixture DB with categorized txns/splits/budgets/rules
 * must survive migrate without FK wipe from DROP TABLE categories.
 */
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { migrate, migrationCount } from './db';

function seedPreCategoryUniqueness(db: Database) {
	// Build schema as of just before the #17 category-uniqueness migration:
	// run all migrations, then rewind user_version and restore UNIQUE(user_id,name,type)
	// by rebuilding categories with the old constraint while FKs are off.
	migrate(db);
	const target = migrationCount();
	// Rewind to re-run the last migration (#17) after we plant twins + links.
	db.run(`PRAGMA user_version = ${target - 1}`);

	db.exec('PRAGMA foreign_keys = OFF');
	db.exec(`
DROP TABLE IF EXISTS categories;
CREATE TABLE categories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
	parent_id INTEGER,
	color TEXT,
	is_transfer INTEGER NOT NULL DEFAULT 0,
	UNIQUE (user_id, name, type)
);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
`);
	db.exec('PRAGMA foreign_keys = ON');

	db.query(
		`INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Fixture', 'fixture@test.com', 'x')`
	).run();
	db.query(`INSERT INTO accounts (id, user_id, name, type) VALUES (1, 1, 'Checking', 'bank')`).run();

	// Twin pair: Coffee expense + Coffee income (the #17 merge case).
	db.query(
		`INSERT INTO categories (id, user_id, name, type, parent_id, color, is_transfer)
		 VALUES (10, 1, 'Coffee', 'expense', NULL, NULL, 0)`
	).run();
	db.query(
		`INSERT INTO categories (id, user_id, name, type, parent_id, color, is_transfer)
		 VALUES (11, 1, 'Coffee', 'income', NULL, NULL, 0)`
	).run();
	db.query(
		`INSERT INTO categories (id, user_id, name, type, parent_id, color, is_transfer)
		 VALUES (12, 1, 'Transfer', 'expense', NULL, NULL, 1)`
	).run();

	db.query(
		`INSERT INTO transactions (id, user_id, account_id, category_id, date, amount_cents, merchant)
		 VALUES (100, 1, 1, 10, '2026-01-02', -500, 'Cafe')`
	).run();
	db.query(
		`INSERT INTO transactions (id, user_id, account_id, category_id, date, amount_cents, merchant)
		 VALUES (101, 1, 1, 11, '2026-01-03', 100, 'Refund')`
	).run();
	db.query(
		`INSERT INTO transactions (id, user_id, account_id, category_id, date, amount_cents, merchant)
		 VALUES (102, 1, 1, 10, '2026-01-04', -900, 'Split parent')`
	).run();
	db.query(
		`INSERT INTO transaction_splits (transaction_id, category_id, amount_cents)
		 VALUES (102, 10, 400), (102, 10, 500)`
	).run();
	db.query(
		`INSERT INTO budgets (user_id, category_id, period, limit_cents) VALUES (1, 10, 'month', 40000)`
	).run();
	db.query(
		`INSERT INTO categorization_rules (user_id, name, conditions, category_id, priority, enabled)
		 VALUES (1, 'Cafe rule', '[]', 10, 0, 1)`
	).run();
	db.query(
		`INSERT INTO scheduled (user_id, name, account_id, category_id, amount_cents, start_date, forecast_behavior)
		 VALUES (1, 'Coffee club', 1, 10, 500, '2026-01-01', 'bill')`
	).run();
}

describe('migrate category rebuild (#20)', () => {
	test('preserves category links across #17 uniqueness migration', () => {
		const db = new Database(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		seedPreCategoryUniqueness(db);

		const beforeTx = (
			db.query('SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NOT NULL').get() as {
				n: number;
			}
		).n;
		const beforeSplits = (db.query('SELECT COUNT(*) AS n FROM transaction_splits').get() as { n: number })
			.n;
		const beforeBudgets = (db.query('SELECT COUNT(*) AS n FROM budgets').get() as { n: number }).n;
		const beforeRules = (
			db.query('SELECT COUNT(*) AS n FROM categorization_rules').get() as { n: number }
		).n;

		expect(beforeTx).toBe(3);
		expect(beforeSplits).toBe(2);
		expect(beforeBudgets).toBe(1);
		expect(beforeRules).toBe(1);

		migrate(db);

		expect(
			(db.query('PRAGMA user_version').get() as { user_version: number }).user_version
		).toBe(migrationCount());

		const afterTx = (
			db.query('SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NOT NULL').get() as {
				n: number;
			}
		).n;
		const afterNull = (
			db.query('SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL').get() as {
				n: number;
			}
		).n;
		const afterSplits = (db.query('SELECT COUNT(*) AS n FROM transaction_splits').get() as { n: number })
			.n;
		const afterBudgets = (db.query('SELECT COUNT(*) AS n FROM budgets').get() as { n: number }).n;
		const afterRules = (
			db.query('SELECT COUNT(*) AS n FROM categorization_rules').get() as { n: number }
		).n;
		const coffeeRows = (
			db
				.query(
					`SELECT COUNT(*) AS n FROM categories WHERE user_id = 1 AND lower(name) = 'coffee' AND is_transfer = 0`
				)
				.get() as { n: number }
		).n;

		expect(afterTx).toBe(beforeTx);
		expect(afterNull).toBe(0);
		expect(afterSplits).toBe(beforeSplits);
		expect(afterBudgets).toBe(beforeBudgets);
		expect(afterRules).toBe(beforeRules);
		expect(coffeeRows).toBe(1);

		db.close();
	});
});
