import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate, migrationCount } from './db';
import { ledgerBaselineConfig, ledgerFinanceEvidenceContext } from './ledgerBaselineEvidence';

const databases: Database[] = [];
const config = { currency: 'USD', timeZone: 'America/New_York' };
const now = '2026-11-27T15:00:00.000Z';

function fixture(): Database {
	const database = new Database(':memory:');
	migrate(database);
	database
		.query('INSERT INTO users (id, name, email, password_hash) VALUES (1, ?, ?, ?)')
		.run('Synthetic owner', 'owner@example.test', 'unused');
	databases.push(database);
	return database;
}

function addAccount(
	database: Database,
	values: {
		name: string;
		opening?: { balance: number; date: string };
		provider?: { balance: number; asOf: string; externalId: string };
	}
): number {
	const result = database
		.query(
			`INSERT INTO accounts
			 (user_id, name, type, provider, external_id, opening_balance_cents, opening_as_of,
			  provider_balance_cents, provider_balance_as_of)
			 VALUES (1, ?, 'bank', ?, ?, ?, ?, ?, ?)`
		)
		.run(
			values.name,
			values.provider ? 'plaid' : null,
			values.provider?.externalId ?? null,
			values.opening?.balance ?? null,
			values.opening?.date ?? null,
			values.provider?.balance ?? null,
			values.provider?.asOf ?? null
		);
	return Number(result.lastInsertRowid);
}

function addTransaction(
	database: Database,
	accountId: number,
	date: string,
	amount: number,
	pending = false,
	categoryId: number | null = null
): number {
	const result = database
		.query(
			`INSERT INTO transactions
			 (user_id, account_id, category_id, date, amount_cents, pending)
			 VALUES (1, ?, ?, ?, ?, ?)`
		)
		.run(accountId, categoryId, date, amount, pending ? 1 : 0);
	return Number(result.lastInsertRowid);
}

afterEach(() => {
	for (const database of databases.splice(0)) database.close();
});

describe('ledger baseline configuration', () => {
	test('requires an explicit enable flag, currency, and accounting timezone', () => {
		expect(ledgerBaselineConfig({})).toBeNull();
		expect(ledgerBaselineConfig({ GALENE_LEDGER_BASELINE_ENABLED: '1' })).toBeNull();
		expect(
			ledgerBaselineConfig({
				GALENE_LEDGER_BASELINE_ENABLED: '1',
				GALENE_LEDGER_BASELINE_CURRENCY: 'usd',
				GALENE_LEDGER_BASELINE_TIME_ZONE: 'America/New_York'
			})
		).toBeNull();
		expect(
			ledgerBaselineConfig({
				GALENE_LEDGER_BASELINE_ENABLED: '1',
				GALENE_LEDGER_BASELINE_CURRENCY: 'USD',
				GALENE_LEDGER_BASELINE_TIME_ZONE: 'Not/A_Zone'
			})
		).toBeNull();
		expect(
			ledgerBaselineConfig({
				GALENE_LEDGER_BASELINE_ENABLED: '1',
				GALENE_LEDGER_BASELINE_CURRENCY: 'USD',
				GALENE_LEDGER_BASELINE_TIME_ZONE: 'America/New_York'
			})
		).toEqual(config);
	});
});

describe('ledger-derived accepted estimates', () => {
	test('covers opening and later-provider anchors, persists only on prepare, and detects drift', () => {
		const database = fixture();
		const category = Number(
			database
				.query("INSERT INTO categories (user_id, name, type) VALUES (1, 'Synthetic', 'expense')")
				.run().lastInsertRowid
		);
		const opening = addAccount(database, {
			name: 'Opening anchored',
			opening: { balance: 10_000, date: '2026-11-20' }
		});
		const provider = addAccount(database, {
			name: 'Provider anchored',
			provider: { balance: 5_000, asOf: '2026-11-26 15:00:00', externalId: 'synthetic-source' }
		});
		const openingExpense = addTransaction(database, opening, '2026-11-20', -1_000, false, category);
		addTransaction(database, opening, '2026-11-21', 250);
		addTransaction(database, opening, '2026-11-22', -999, true);
		addTransaction(database, opening, '2026-11-26', 500);
		addTransaction(database, provider, '2026-11-25', -300);
		addTransaction(database, provider, '2026-11-26', -1_000);
		addTransaction(database, provider, '2026-11-26', 200);
		addTransaction(database, provider, '2026-11-26', -999, true);

		const evidence = ledgerFinanceEvidenceContext(database, 1, now, config);
		expect(evidence.baselineDate).toBe('2026-11-25');
		expect(evidence.closingCatalog(1, evidence.baselineDate)).toEqual([]);
		expect(
			(database.query('SELECT COUNT(*) AS n FROM ledger_baseline_receipts').get() as { n: number }).n
		).toBe(0);

		const preview = evidence.previewClosingCatalog(1, evidence.baselineDate);
		expect(preview.map((record) => record.balanceCents)).toEqual([9_250, 5_800]);
		expect(preview.every((record) => record.source === 'accepted_estimate')).toBe(true);
		expect(preview.every((record) => record.description.includes('signed parent transactions'))).toBe(true);

		evidence.prepareClosingEvidence(1, evidence.baselineDate);
		const stored = evidence.closingCatalog(1, evidence.baselineDate);
		expect(stored.map((record) => record.balanceCents)).toEqual([9_250, 5_800]);
		const payload = (
			database.query('SELECT payload FROM ledger_baseline_receipts').get() as { payload: string }
		).payload;
		expect(payload).not.toContain('synthetic-source');
		expect(payload).not.toContain('Opening anchored');

		// Category and split data are deliberately outside balance math and source digests.
		database.query('UPDATE transactions SET category_id = NULL WHERE id = ?').run(openingExpense);
		database
			.query('INSERT INTO transaction_splits (transaction_id, category_id, amount_cents) VALUES (?, ?, ?)')
			.run(openingExpense, category, 1_000);
		expect(evidence.closingCatalog(1, evidence.baselineDate)).toEqual(stored);

		// A signed source-row edit invalidates the old receipt until a new review prepares a new digest.
		database.query('UPDATE transactions SET amount_cents = -1100 WHERE id = ?').run(openingExpense);
		expect(evidence.closingCatalog(1, evidence.baselineDate)).toEqual([]);
		evidence.prepareClosingEvidence(1, evidence.baselineDate);
		expect(evidence.closingCatalog(1, evidence.baselineDate)[0]?.balanceCents).toBe(9_150);
		expect(
			(database.query('SELECT COUNT(*) AS n FROM ledger_baseline_receipts').get() as { n: number }).n
		).toBe(2);
	});

	test('reloads an exact receipt idempotently and rejects foreign owners and tampering', () => {
		const database = fixture();
		addAccount(database, { name: 'Opening anchored', opening: { balance: 100, date: '2026-11-20' } });
		database
			.query('INSERT INTO users (id, name, email, password_hash) VALUES (2, ?, ?, ?)')
			.run('Other owner', 'other@example.test', 'unused');
		database
			.query("INSERT INTO accounts (user_id, name, type, opening_balance_cents, opening_as_of) VALUES (2, 'Other', 'bank', 999, '2026-11-20')")
			.run();
		const first = ledgerFinanceEvidenceContext(database, 1, now, config);
		expect(first.previewClosingCatalog(2, first.baselineDate)).toEqual([]);
		expect(() => first.prepareClosingEvidence(2, first.baselineDate)).toThrow('owner scope');
		first.prepareClosingEvidence(1, first.baselineDate);
		first.prepareClosingEvidence(1, first.baselineDate);
		expect((database.query('SELECT COUNT(*) AS n FROM ledger_baseline_receipts').get() as { n: number }).n).toBe(1);
		const reloaded = ledgerFinanceEvidenceContext(database, 1, now, config);
		expect(reloaded.closingCatalog(1, first.baselineDate)).toEqual(first.closingCatalog(1, first.baselineDate));
		database.query("UPDATE ledger_baseline_receipts SET payload = '{}'").run();
		expect(reloaded.closingCatalog(1, first.baselineDate)).toEqual([]);
	});

	test('revalidates provider balance, observation, and source identity drift', () => {
		const database = fixture();
		const accountId = addAccount(database, {
			name: 'Provider anchored',
			provider: { balance: 5_000, asOf: '2026-11-26 15:00:00', externalId: 'synthetic-source' }
		});
		const original = ledgerFinanceEvidenceContext(database, 1, now, config);
		original.prepareClosingEvidence(1, original.baselineDate);
		expect(original.closingCatalog(1, original.baselineDate)).toHaveLength(1);
		database.query('UPDATE accounts SET provider_balance_cents = 5001 WHERE id = ?').run(accountId);
		expect(original.closingCatalog(1, original.baselineDate)).toEqual([]);
		database.query('UPDATE accounts SET provider_balance_cents = 5000, external_id = ? WHERE id = ?').run('changed-source', accountId);
		expect(original.closingCatalog(1, original.baselineDate)).toEqual([]);
		database
			.query('UPDATE accounts SET external_id = ?, provider_balance_as_of = ? WHERE id = ?')
			.run('synthetic-source', '2026-11-26 15:00:01', accountId);
		expect(original.closingCatalog(1, original.baselineDate)).toEqual([]);
	});

	test('uses opening-as-of inclusively and preserves equal/opposite movement and zero rows', () => {
		const database = fixture();
		const from = addAccount(database, { name: 'From', opening: { balance: 1_000, date: '2026-11-20' } });
		const to = addAccount(database, { name: 'To', opening: { balance: 1_000, date: '2026-11-20' } });
		addTransaction(database, from, '2026-11-20', -500);
		addTransaction(database, to, '2026-11-20', 500);
		addTransaction(database, from, '2026-11-20', 0);
		const evidence = ledgerFinanceEvidenceContext(database, 1, now, config);
		const records = evidence.previewClosingCatalog(1, evidence.baselineDate);
		expect(records.map((record) => record.balanceCents)).toEqual([500, 1_500]);
		expect(records.reduce((sum, record) => sum + record.balanceCents, 0)).toBe(2_000);
	});

	test('uses the configured timezone for provider civil dates and caps rollback at fourteen days', () => {
		const database = fixture();
		addAccount(database, {
			name: 'Provider anchored',
			// UTC date is Nov 26, but the configured accounting civil date is Nov 25.
			provider: { balance: 5_000, asOf: '2026-11-26 02:00:00', externalId: 'synthetic-source' }
		});
		const evidence = ledgerFinanceEvidenceContext(database, 1, now, config);
		expect(evidence.baselineDate).toBe('2026-11-24');
		expect(evidence.previewClosingCatalog(1, '2026-11-25')).toEqual([]);
		expect(evidence.previewClosingCatalog(1, '2026-11-11')).toHaveLength(1);
		expect(evidence.previewClosingCatalog(1, '2026-11-10')).toEqual([]);
	});

	test('rejects a provider observation timestamp later than the request clock', () => {
		const database = fixture();
		addAccount(database, {
			name: 'Future provider observation',
			provider: { balance: 5_000, asOf: '2026-11-27 16:00:00', externalId: 'synthetic-source' }
		});
		expect(() => ledgerFinanceEvidenceContext(database, 1, now, config)).toThrow(
			'provider observation is in the future'
		);
	});

	test('fails closed when all accounts cannot share one bounded completed cutoff', () => {
		const database = fixture();
		addAccount(database, {
			name: 'Late opening',
			opening: { balance: 100, date: '2026-11-20' }
		});
		addAccount(database, {
			name: 'Old provider',
			provider: { balance: 200, asOf: '2026-11-19 12:00:00', externalId: 'synthetic-source' }
		});
		expect(() => ledgerFinanceEvidenceContext(database, 1, now, config)).toThrow(
			'no common completed baseline date'
		);
	});

	test('fails closed for an incomplete anchor', () => {
		const database = fixture();
		database
			.query("INSERT INTO accounts (user_id, name, type, opening_balance_cents) VALUES (1, 'Incomplete', 'bank', 100)")
			.run();
		expect(() => ledgerFinanceEvidenceContext(database, 1, now, config)).toThrow('opening anchor incomplete');
	});

	test('the additive receipt migration preserves existing finance rows', () => {
		const database = fixture();
		const accountId = addAccount(database, { name: 'Opening anchored', opening: { balance: 100, date: '2026-11-20' } });
		const transactionId = addTransaction(database, accountId, '2026-11-20', -25);
		database.query('DROP TABLE ledger_baseline_receipts').run();
		database.run(`PRAGMA user_version = ${migrationCount() - 1}`);
		migrate(database);
		expect((database.query('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n).toBe(1);
		expect((database.query('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(transactionId) as { n: number }).n).toBe(1);
		expect((database.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'ledger_baseline_receipts'").get() as { n: number }).n).toBe(1);
	});
});
