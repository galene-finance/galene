/** Additive only. Existing ledger/import/budget rows are never altered. */
export const budgetEngineMigration = `
CREATE TABLE IF NOT EXISTS budget_engine_state (
 owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), baseline_json TEXT,
 activity_through TEXT, register_json TEXT
);
CREATE TABLE IF NOT EXISTS budget_engine_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('allocation','posted')),
 date TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(owner_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_budget_events_owner ON budget_engine_events(owner_id,date,sequence);
CREATE TABLE IF NOT EXISTS budget_engine_receipts (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(owner_id,key)
);
CREATE TABLE IF NOT EXISTS budget_engine_targets (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 target_id TEXT NOT NULL, version INTEGER NOT NULL, category_id INTEGER NOT NULL,
 effective_month TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY(owner_id,target_id,version)
);
CREATE INDEX IF NOT EXISTS idx_budget_targets_owner ON budget_engine_targets(owner_id,effective_month);
CREATE TABLE IF NOT EXISTS budget_engine_legacy_targets (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 budget_id INTEGER NOT NULL, category_id INTEGER NOT NULL, cadence TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, needs_review INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(owner_id,budget_id)
);
INSERT OR IGNORE INTO budget_engine_legacy_targets(owner_id,budget_id,category_id,cadence,amount_cents)
 SELECT user_id,id,category_id,period,limit_cents FROM budgets;
CREATE TABLE IF NOT EXISTS budget_engine_snapshots (
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_key TEXT NOT NULL, account_id INTEGER NOT NULL, as_of TEXT NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(owner_id,source_key)
);
CREATE INDEX IF NOT EXISTS idx_budget_snapshots_owner ON budget_engine_snapshots(owner_id,as_of,account_id);
CREATE TRIGGER IF NOT EXISTS budget_engine_transactions_insert AFTER INSERT ON transactions BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_transactions_update AFTER UPDATE ON transactions BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id OR owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_transactions_delete AFTER DELETE ON transactions BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_accounts_insert AFTER INSERT ON accounts BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_accounts_update AFTER UPDATE ON accounts BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id OR owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_accounts_delete AFTER DELETE ON accounts BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_categories_insert AFTER INSERT ON categories BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_categories_update AFTER UPDATE ON categories BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id OR owner_id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_categories_delete AFTER DELETE ON categories BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=OLD.user_id; END;
CREATE TRIGGER IF NOT EXISTS budget_engine_splits_insert AFTER INSERT ON transaction_splits BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=(SELECT user_id FROM transactions WHERE id=NEW.transaction_id); END;
CREATE TRIGGER IF NOT EXISTS budget_engine_splits_update AFTER UPDATE ON transaction_splits BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=(SELECT user_id FROM transactions WHERE id=OLD.transaction_id) OR owner_id=(SELECT user_id FROM transactions WHERE id=NEW.transaction_id); END;
CREATE TRIGGER IF NOT EXISTS budget_engine_splits_delete AFTER DELETE ON transaction_splits BEGIN UPDATE budget_engine_state SET revision=revision+1 WHERE owner_id=(SELECT user_id FROM transactions WHERE id=OLD.transaction_id); END;

`;
