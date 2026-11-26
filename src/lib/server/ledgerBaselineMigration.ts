/** Additive, owner-scoped storage for immutable baseline evidence receipts. */
export const ledgerBaselineEvidenceMigration = `
CREATE TABLE IF NOT EXISTS ledger_baseline_receipts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	as_of_date TEXT NOT NULL,
	source_digest TEXT NOT NULL CHECK(length(source_digest) = 64),
	recorded_at TEXT NOT NULL,
	payload TEXT NOT NULL,
	UNIQUE(owner_id, as_of_date, source_digest)
);
CREATE INDEX IF NOT EXISTS idx_ledger_baseline_receipts_owner_date
	ON ledger_baseline_receipts(owner_id, as_of_date, id);
`;
