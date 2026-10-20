/**
 * Migration harness (#20): fixture DB with categorized txns/splits/budgets/rules
 * must survive migrate without FK wipe from DROP TABLE categories.
 */
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { categoryUniquenessMigrationIndex, migrate, migrationCount, migrationIndexBefore } from './db';

function seedPreCategoryUniqueness(db: Database) {
	// Build schema as of just before the #17 category-uniqueness migration:
	// run all migrations, then rewind user_version and restore UNIQUE(user_id,name,type)
	// by rebuilding categories with the old constraint while FKs are off.
	migrate(db);
	// Rewind to re-run the #17 category uniqueness migration after we plant twins + links.
	db.run(`PRAGMA user_version = ${categoryUniquenessMigrationIndex()}`);

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

describe('migrate OIDC identity pinning (ADO-55)', () => {
	test('adds oidc_identities to an existing database without touching users', () => {
		const db = new Database(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		migrate(db);
		db.exec('DROP TABLE oidc_identities');
		db.run(`PRAGMA user_version = ${migrationIndexBefore('oidc_identities')}`);
		db.query(`INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Fixture', 'fixture@test.com', 'x')`).run();
		db.query(`INSERT INTO accounts (id, user_id, name, type) VALUES (1, 1, 'Checking', 'bank')`).run();

		migrate(db);

		expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrationCount());
		expect(db.query('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
		expect(db.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
		expect(db.query('SELECT COUNT(*) AS n FROM oidc_identities').get()).toEqual({ n: 0 });
		db.query(`INSERT INTO oidc_identities (user_id, issuer, sub) VALUES (1, 'https://idp.example.com', 's')`).run();
		expect(() =>
			db.query(`INSERT INTO oidc_identities (user_id, issuer, sub) VALUES (1, 'https://idp.example.com', 't')`).run()
		).toThrow();
		// Deleting the user cascades the link.
		db.query('DELETE FROM users WHERE id = 1').run();
		expect(db.query('SELECT COUNT(*) AS n FROM oidc_identities').get()).toEqual({ n: 0 });
		// Replay is idempotent.
		db.exec('DROP TABLE IF EXISTS plaid_items');
		db.run(`PRAGMA user_version = ${migrationIndexBefore('oidc_identities')}`);
		expect(() => migrate(db)).not.toThrow();
		db.close();
	});
});

describe('migrate Plaid item health (ADO-58)', () => {
	test('adds plaid_items without dropping connections or accounts', () => {
		const db = new Database(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		migrate(db);
		db.exec('DROP TABLE plaid_items');
		db.run(`PRAGMA user_version = ${migrationIndexBefore('plaid_items')}`);
		db.query(`INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Fixture', 'fixture@test.com', 'x')`).run();
		db.query(
			`INSERT INTO connections (id, user_id, provider, credentials) VALUES (7, 1, 'plaid', '{"access_tokens":"[]"}')`
		).run();
		db.query(`INSERT INTO accounts (id, user_id, name, type, provider, external_id) VALUES (3, 1, 'Checking', 'bank', 'plaid', 'acc')`).run();

		migrate(db);

		expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrationCount());
		expect(db.query('SELECT id FROM connections').get()).toEqual({ id: 7 });
		expect(db.query('SELECT id, external_id FROM accounts').get()).toEqual({ id: 3, external_id: 'acc' });
		db.query(
			`INSERT INTO plaid_items (user_id, connection_id, item_id, token_hint, needs_reconnect)
			 VALUES (1, 7, 'item-1', 'hint', 1)`
		).run();
		expect(db.query('SELECT needs_reconnect AS n FROM plaid_items').get()).toEqual({ n: 1 });
		// Deleting the connection cascades item rows; the account stays.
		db.query('DELETE FROM connections WHERE id = 7').run();
		expect(db.query('SELECT COUNT(*) AS n FROM plaid_items').get()).toEqual({ n: 0 });
		expect(db.query('SELECT COUNT(*) AS n FROM accounts').get()).toEqual({ n: 1 });
		db.run(`PRAGMA user_version = ${migrationIndexBefore('plaid_items')}`);
		expect(() => migrate(db)).not.toThrow();
		db.close();
	});

	test('adds account_external_ids on an existing plaid_items table', () => {
		const db = new Database(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		migrate(db);
		// Rewind to just before account_external_ids (the following migration is
		// institution_id) and recreate plaid_items without that column.
		db.run(`PRAGMA user_version = ${migrationCount() - 2}`);
		db.exec('DROP TABLE plaid_items');
		db.exec(`
CREATE TABLE plaid_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
	item_id TEXT NOT NULL,
	token_hint TEXT NOT NULL,
	institution_name TEXT,
	error_code TEXT,
	error_at TEXT,
	needs_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (needs_reconnect IN (0, 1)),
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (user_id, token_hint)
);`);
		migrate(db);
		const cols = db.query('PRAGMA table_info(plaid_items)').all() as { name: string }[];
		expect(cols.some((c) => c.name === 'account_external_ids')).toBe(true);
		expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrationCount());
		db.close();
	});

	test('adds institution_id and account mask/subtype without dropping rows', () => {
		const db = new Database(':memory:');
		db.exec('PRAGMA foreign_keys = ON');
		migrate(db);
		db.run(`PRAGMA user_version = ${migrationCount() - 1}`);
		db.exec('DROP TABLE plaid_items');
		db.exec(`
CREATE TABLE plaid_items (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
	item_id TEXT NOT NULL,
	token_hint TEXT NOT NULL,
	institution_name TEXT,
	error_code TEXT,
	error_at TEXT,
	needs_reconnect INTEGER NOT NULL DEFAULT 0 CHECK (needs_reconnect IN (0, 1)),
	account_external_ids TEXT,
	updated_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE (user_id, token_hint)
);`);
		db.query(`INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Fixture', 'fixture@test.com', 'x')`).run();
		db.query(
			`INSERT INTO connections (id, user_id, provider, credentials) VALUES (7, 1, 'plaid', '{"access_tokens":"[]"}')`
		).run();
		db.query(`INSERT INTO accounts (id, user_id, name, type) VALUES (3, 1, 'Checking', 'bank')`).run();
		db.query(
			`INSERT INTO plaid_items (id, user_id, connection_id, item_id, token_hint, institution_name)
			 VALUES (4, 1, 7, 'item-1', 'hint', 'Example Bank')`
		).run();

		migrate(db);

		const itemCols = db.query('PRAGMA table_info(plaid_items)').all() as { name: string }[];
		expect(itemCols.some((c) => c.name === 'institution_id')).toBe(true);
		const accountCols = db.query('PRAGMA table_info(accounts)').all() as { name: string }[];
		expect(accountCols.some((c) => c.name === 'mask')).toBe(true);
		expect(accountCols.some((c) => c.name === 'subtype')).toBe(true);
		expect(db.query('SELECT id, institution_name FROM plaid_items').get()).toEqual({
			id: 4,
			institution_name: 'Example Bank'
		});
		expect(db.query('SELECT id FROM accounts').get()).toEqual({ id: 3 });
		expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(migrationCount());
		// Replay is idempotent.
		db.run(`PRAGMA user_version = ${migrationCount() - 1}`);
		expect(() => migrate(db)).not.toThrow();
		db.close();
	});

});
