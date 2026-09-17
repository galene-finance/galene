import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashToken } from './tokenHash';

const DATA_DIR = process.env.GALENE_DATA_DIR ?? resolve(process.cwd(), 'data');
const DB_PATH = process.env.GALENE_DB_PATH ?? resolve(DATA_DIR, 'galene.db');

let _db: Database | undefined;

/**
 * Refuse to run if the database directory sits on the container's ephemeral
 * filesystem (the writable layer) instead of a mounted volume, so removing the
 * container can't silently delete the database. Skipped on non-Linux hosts
 * (no /proc/mounts) and overridable with GALENE_ALLOW_EPHEMERAL_DATA=1.
 */
export function assertDataDirOnVolume(): void {
	if (process.env.GALENE_ALLOW_EPHEMERAL_DATA === '1') return;
	let mounts: string;
	try {
		mounts = readFileSync('/proc/mounts', 'utf8');
	} catch {
		return; // non-Linux (dev on macOS/Windows): no /proc/mounts, nothing to check
	}
	const dataDir = resolve(dirname(DB_PATH));
	let best = '';
	for (const line of mounts.split('\n')) {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 2) continue;
		const mp = unescapeMountpoint(fields[1]);
		const contains = mp === '/' ? true : dataDir === mp || dataDir.startsWith(mp + '/');
		if (contains && mp.length > best.length) best = mp;
	}
	if (best === '/') {
		throw new Error(
			`Galene will not start: the data directory ${dataDir} is on the container's ephemeral filesystem, not a mounted volume. The database would be lost when the container is removed. Mount a volume at ${dataDir} (e.g. \`docker run -v galene_data:${dataDir}\` or add a volumes entry to your compose file). Set GALENE_ALLOW_EPHEMERAL_DATA=1 to override.`
		);
	}
}

/** /proc/mounts escapes spaces/newlines/tabs in mountpoints as \040/\012/\013. */
function unescapeMountpoint(mp: string): string {
	return mp.replace(/\\040/g, ' ').replace(/\\012/g, '\n').replace(/\\013/g, '\t');
}

/** Singleton SQLite connection (bun:sqlite). Runs under bun in both dev and production. */
export function db(): Database {
	if (!_db) {
		assertDataDirOnVolume();
		mkdirSync(dirname(DB_PATH), { recursive: true });
		_db = new Database(DB_PATH, { create: true });
		_db.exec('PRAGMA journal_mode = WAL;');
		_db.exec('PRAGMA foreign_keys = ON;');
		// Writers that lose the write-lock race (e.g. two concurrent first
		// signups in separate processes) wait for it instead of failing with
		// SQLITE_BUSY, so the loser can re-check state and reject cleanly.
		_db.exec('PRAGMA busy_timeout = 5000;');
		migrate(_db);
	}
	return _db;
}

/**
 * A migration is either a plain SQL string, or an object with the SQL plus an
 * optional `after` hook for steps that need JavaScript (e.g. hashing rows).
 * Hooks run inside the same transaction as the SQL. `vacuum` rewrites the
 * whole database after the migration commits, so data replaced by the
 * migration (e.g. a raw token) doesn't linger in freed pages or backups.
 */
type Migration = string | { sql: string; after?: (database: Database) => void; vacuum?: boolean };

const MIGRATIONS: Migration[] = [
	`
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		expires_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'bank' CHECK (type IN ('bank','credit','cash','investment','other')),
		color TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

	CREATE TABLE IF NOT EXISTS categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
		parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
		color TEXT,
		UNIQUE (user_id, name, type)
	);
	CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		UNIQUE (user_id, name)
	);
	CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

	CREATE TABLE IF NOT EXISTS transactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
		category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
		date TEXT NOT NULL,
		amount_cents INTEGER NOT NULL,
		merchant TEXT,
		notes TEXT,
		color TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
	CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
	CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);

	CREATE TABLE IF NOT EXISTS transaction_tags (
		transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (transaction_id, tag_id)
	);

	CREATE TABLE IF NOT EXISTS budgets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		period TEXT NOT NULL CHECK (period IN ('week','month','year')),
		limit_cents INTEGER NOT NULL,
		UNIQUE (user_id, category_id, period)
	);
	CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(user_id);

	CREATE TABLE IF NOT EXISTS scheduled (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
		category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
		amount_cents INTEGER NOT NULL,
		start_date TEXT NOT NULL,
		repeat_interval INTEGER,
		repeat_unit TEXT CHECK (repeat_unit IN ('day','week','month','year')),
		until_date TEXT,
		forecast_behavior TEXT NOT NULL DEFAULT 'bill' CHECK (forecast_behavior IN ('bill','spread')),
		color TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_scheduled_user ON scheduled(user_id);

	CREATE TABLE IF NOT EXISTS scheduled_tags (
		scheduled_id INTEGER NOT NULL REFERENCES scheduled(id) ON DELETE CASCADE,
		tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
		PRIMARY KEY (scheduled_id, tag_id)
	);

	CREATE TABLE IF NOT EXISTS categorization_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		conditions TEXT NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		priority INTEGER NOT NULL DEFAULT 0,
		enabled INTEGER NOT NULL DEFAULT 1
	);
	CREATE INDEX IF NOT EXISTS idx_rules_user ON categorization_rules(user_id);

	CREATE TABLE IF NOT EXISTS settings (
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		key TEXT NOT NULL,
		value TEXT NOT NULL,
		PRIMARY KEY (user_id, key)
	);
	`,
	`
	-- Phase 2: split transactions + notes on scheduled expectations
	CREATE TABLE IF NOT EXISTS transaction_splits (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
		category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
		amount_cents INTEGER NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_splits_tx ON transaction_splits(transaction_id);
	CREATE INDEX IF NOT EXISTS idx_splits_category ON transaction_splits(category_id);

	ALTER TABLE scheduled ADD COLUMN notes TEXT;
	`,
	`
	-- Phase: custom theming & branding (instance-level, single row)
	CREATE TABLE IF NOT EXISTS branding (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		name TEXT NOT NULL DEFAULT 'Galene',
		accent TEXT
	);
	INSERT OR IGNORE INTO branding (id, name) VALUES (1, 'Galene');
	`,
	`
	-- Phase: per-user themes (colors stored as JSON)
	CREATE TABLE IF NOT EXISTS themes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		colors TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_themes_user ON themes(user_id);
	`,
	`
	-- Phase: bank sync (provider connections + external identity for dedup)
	CREATE TABLE IF NOT EXISTS connections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		provider TEXT NOT NULL,
		credentials TEXT NOT NULL DEFAULT '{}',
		status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error')),
		last_synced_at TEXT,
		last_error TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE (user_id, provider)
	);
	CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);

	ALTER TABLE accounts ADD COLUMN provider TEXT;
	ALTER TABLE accounts ADD COLUMN external_id TEXT;
	-- NULL provider (manual accounts) never collides; one external id per provider.
	CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external ON accounts(user_id, provider, external_id);

	ALTER TABLE transactions ADD COLUMN provider TEXT;
	ALTER TABLE transactions ADD COLUMN external_id TEXT;
	CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external ON transactions(user_id, provider, external_id);
	`,
`
-- Phase 2: auto-sync scheduling for provider connections
ALTER TABLE connections ADD COLUMN sync_interval_minutes INTEGER;
ALTER TABLE connections ADD COLUMN next_sync_at TEXT;
`,
`
-- Phase: map provider accounts to user-named Galene accounts
-- source_name keeps the provider's own name (shown as the "source"); name
-- marks a user-chosen name the sync engine must not overwrite.
ALTER TABLE accounts ADD COLUMN source_name TEXT;
ALTER TABLE accounts ADD COLUMN name_locked INTEGER NOT NULL DEFAULT 0;
`,
`
-- Phase: in-app notifications (sync failures/recoveries, budget overruns,
-- upcoming bills). dedup_key makes a recurring condition one live row;
-- NULLs stay distinct so one-off rows never collide.
CREATE TABLE IF NOT EXISTS notifications (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('sync_failed','sync_recovered','budget_overrun','bill_upcoming')),
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	link TEXT,
	dedup_key TEXT,
	read_at TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	resolved_at TEXT,
	UNIQUE (user_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`,
`
-- Phase: API tokens for the REST API and the MCP server
CREATE TABLE IF NOT EXISTS api_tokens (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	token TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
`,
`
-- Phase: admin role. The first account ever created (server setup) is the
-- initial admin; the backfill below covers databases created before this
-- column existed.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users
SET is_admin = 1
WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1);
-- Orphan cleanup: rows left behind by users that were removed before the
-- cascade rules were in place. Every table is per-user, so a row whose
-- user no longer exists belongs to no account.
DELETE FROM transactions WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM transaction_splits WHERE transaction_id NOT IN (SELECT id FROM transactions);
DELETE FROM transaction_tags WHERE transaction_id NOT IN (SELECT id FROM transactions);
DELETE FROM scheduled WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM scheduled_tags WHERE scheduled_id NOT IN (SELECT id FROM scheduled);
DELETE FROM budgets WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM categorization_rules WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM accounts WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM categories WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM tags WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM connections WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM notifications WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM api_tokens WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM themes WHERE user_id NOT IN (SELECT id FROM users);
DELETE FROM settings WHERE user_id NOT IN (SELECT id FROM users);
`,
`
-- Phase: database backups (Settings > Backups, admin-only). Instance-level
-- (one row per server): a backup is a full copy of the database file, which
-- holds every user's data.
CREATE TABLE IF NOT EXISTS backup_settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	dest_dir TEXT NOT NULL DEFAULT '',
	interval_minutes INTEGER,
	next_run_at TEXT,
	last_run_at TEXT,
	last_error TEXT,
	keep_days INTEGER
);
`,
{
	// Phase: hash API tokens at rest (issue #15). The raw token is replaced by
	// a per-row salted scrypt hash; a one-way SHA-256 hint is kept to locate
	// the row. The table is rebuilt because the old `token` column is UNIQUE
	// and SQLite cannot drop it. Existing tokens are hashed in place, so they
	// keep working without reissue.
	sql: `
CREATE TABLE api_tokens_new (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	token_hint TEXT NOT NULL UNIQUE,
	salt TEXT NOT NULL,
	token_hash TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	last_used_at TEXT
);
`,
	after(database) {
		const rows = database
			.query('SELECT id, user_id, name, token, created_at, last_used_at FROM api_tokens')
			.all() as {
				id: number;
				user_id: number;
				name: string;
				token: string;
				created_at: string;
				last_used_at: string | null;
			}[];
		for (const row of rows) {
			const { hint, salt, hash } = hashToken(row.token);
			database
				.query(
					'INSERT INTO api_tokens_new (id, user_id, name, token_hint, salt, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
				)
				.run(row.id, row.user_id, row.name, hint, salt, hash, row.created_at, row.last_used_at);
		}
		database.exec('DROP TABLE api_tokens;');
		database.exec('ALTER TABLE api_tokens_new RENAME TO api_tokens;');
		database.exec('CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);');
		// Keep the autoincrement sequence past the copied ids so new tokens
		// never collide with a migrated one.
		const maxId = (database.query('SELECT MAX(id) AS m FROM api_tokens').get() as { m: number | null } | null)?.m;
		database.query('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(maxId ?? 0, 'api_tokens');
	}
},
{
	// Phase: hash web session tokens at rest (issue #16). The raw cookie value
	// is replaced by a per-row salted scrypt hash; a one-way SHA-256 hint is
	// kept to locate the row. The table is rebuilt because the old `token`
	// column is the primary key and SQLite cannot drop it. Existing sessions
	// are hashed in place, so they keep working without re-login.
	vacuum: true,
	sql: `
CREATE TABLE sessions_new (
	token_hint TEXT NOT NULL PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	salt TEXT NOT NULL,
	token_hash TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
`,
	after(database) {
		const rows = database
			.query('SELECT token, user_id, expires_at FROM sessions')
			.all() as { token: string; user_id: number; expires_at: string }[];
		for (const row of rows) {
			const { hint, salt, hash } = hashToken(row.token);
			database
				.query(
					'INSERT INTO sessions_new (token_hint, user_id, salt, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)'
				)
				.run(hint, row.user_id, salt, hash, row.expires_at);
		}
		database.exec('DROP TABLE sessions;');
		database.exec('ALTER TABLE sessions_new RENAME TO sessions;');
	}
},
`
-- Phase: TOTP two-factor authentication (issue #30). The model is
-- method-agnostic: the type discriminator and the challenge's method_type
-- leave room for a future email OTP once SMTP exists.
CREATE TABLE IF NOT EXISTS user_mfa_methods (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	type TEXT NOT NULL DEFAULT 'totp' CHECK (type IN ('totp')), -- future: 'email'
	label TEXT NOT NULL,
	secret TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	confirmed_at TEXT,
	UNIQUE (user_id, type)
);
CREATE INDEX IF NOT EXISTS idx_mfa_methods_user ON user_mfa_methods(user_id);

-- Pending login step, issued after a correct password and before any session
-- cookie. The raw token is stored only as a salted hash plus a one-way hint,
-- same as sessions.
CREATE TABLE IF NOT EXISTS mfa_challenges (
	token_hint TEXT NOT NULL PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	salt TEXT NOT NULL,
	token_hash TEXT NOT NULL,
	method_type TEXT NOT NULL DEFAULT 'totp',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	expires_at TEXT NOT NULL
);

-- One-time backup codes, scrypt-hashed like passwords.
CREATE TABLE IF NOT EXISTS user_mfa_backup_codes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	code_hash TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user ON user_mfa_backup_codes(user_id);
`,
`
-- Phase: login rate limiting (issue #19). Progressive lockout for failed
-- sign-in attempts, tracked per IP and per email. In-app enforcement; a
-- reverse-proxy rate limit is complementary, and a CAPTCHA after N failures
-- is a possible follow-up (not implemented).
CREATE TABLE IF NOT EXISTS auth_throttle (
	bucket TEXT NOT NULL CHECK (bucket IN ('ip','email')),
	key TEXT NOT NULL,
	fail_count INTEGER NOT NULL DEFAULT 0,
	window_started_at TEXT NOT NULL,
	locked_until TEXT,
	PRIMARY KEY (bucket, key)
);
`,
`
-- Phase: transfer categories (issue #36). PocketSmith-style categories that move
-- money between accounts without counting as income or expense. Stored as a
-- flag so existing CHECK (type IN ('expense','income')) stays valid; the app
-- exposes type "transfer" when is_transfer = 1. Seed sensible defaults per user
-- without renaming any existing categories.
ALTER TABLE categories ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0;

-- Defaults for every existing user (UNIQUE user_id+name+type ignores duplicates).
INSERT OR IGNORE INTO categories (user_id, name, type, parent_id, color, is_transfer)
SELECT id, 'Credit card payment', 'expense', NULL, NULL, 1 FROM users;
INSERT OR IGNORE INTO categories (user_id, name, type, parent_id, color, is_transfer)
SELECT id, 'Transfer', 'expense', NULL, NULL, 1 FROM users;
`,
`
-- Phase: account opening balance + as-of date (ledger anchor, issue #44)
-- opening_balance_cents: signed cents (same sign convention as transactions).
-- opening_as_of: YYYY-MM-DD; NULL until set.
-- Balance rule: COALESCE(opening,0) + SUM(txns on/after as-of when set, else all txns).
-- Opening is the balance *before* transactions on/after the as-of date.
ALTER TABLE accounts ADD COLUMN opening_balance_cents INTEGER;
ALTER TABLE accounts ADD COLUMN opening_as_of TEXT;
`,
`
-- Phase: last provider (bank) balance from SimpleFIN/Plaid sync (issue #45)
-- provider_balance_cents: signed cents (Galene convention; null until a sync reports one).
-- provider_balance_as_of: UTC 'YYYY-MM-DD HH:MM:SS' — provider balance-date when known, else fetch time.
-- Manual accounts stay null (no fake bank balance). Not used to adjust the ledger.
ALTER TABLE accounts ADD COLUMN provider_balance_cents INTEGER;
ALTER TABLE accounts ADD COLUMN provider_balance_as_of TEXT;
`
];

function migrate(database: Database) {
	const row = database.query('PRAGMA user_version').get() as { user_version: number } | null;
	const current = row?.user_version ?? 0;
	if (current >= MIGRATIONS.length) return;
	let needsVacuum = false;
	database.run('BEGIN');
	try {
		for (let i = current; i < MIGRATIONS.length; i++) {
			const migration = MIGRATIONS[i];
			database.exec(typeof migration === 'string' ? migration : migration.sql);
			if (typeof migration !== 'string') {
				if (migration.after) migration.after(database);
				if (migration.vacuum) needsVacuum = true;
			}
		}
		database.run(`PRAGMA user_version = ${MIGRATIONS.length}`);
		database.run('COMMIT');
	} catch (error) {
		database.run('ROLLBACK');
		throw error;
	}
	// VACUUM can't run inside a transaction, so it happens after the commit.
	// In WAL mode its output lands in the -wal file, which keeps the old
	// frames (with the replaced data) until a checkpoint drops them, so the
	// TRUNCATE checkpoint moves everything into the main file and zeroes the
	// WAL. A failure here only leaves replaced data in the file — the hashed
	// columns are already in place — so warn instead of failing startup.
	if (needsVacuum) {
		try {
			database.exec('VACUUM;');
			const r = database.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | null;
			if (r?.busy) {
				console.error('Galene: wal_checkpoint(TRUNCATE) was busy; replaced data may remain in the -wal file until the next checkpoint.');
			}
		} catch (error) {
			console.error('Galene: VACUUM after migration failed:', error);
		}
	}
}
