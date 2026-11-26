import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { BaselineEvidence } from '../baselineSetupTypes';
import { add, civil, timestamp } from '../budget/validation';
import { baselineClosedDate, type BaselineCatalog } from './baselineSetupFeature';
import type { HistoryCapturePolicy, HistoryExternalEvidence } from './historyCaptureProvider';

const MAX_ACCOUNTS = 256;
const MAX_TRANSACTIONS = 50_000;
const MAX_RECEIPTS_PER_DATE = 8;
const MAX_RECEIPT_BYTES = 256 * 1024;
const PROVIDER_ROLLBACK_DAYS = 14;
const METHOD = 'galene-signed-parent-baseline-v1';

type AccountRow = {
	id: number;
	opening_balance_cents: number | null;
	opening_as_of: string | null;
	provider: string | null;
	external_id: string | null;
	provider_balance_cents: number | null;
	provider_balance_as_of: string | null;
};
type TransactionRow = { id: number; date: string; amount_cents: number };
type Anchor =
	| { kind: 'opening'; balanceCents: number; date: string }
	| { kind: 'provider_observation'; balanceCents: number; date: string; observedAt: string; identityDigest: string };
type Provenance = {
	accountId: number;
	anchorKind: Anchor['kind'];
	anchorDate: string;
	anchorObservedAt: string | null;
	anchorIdentityDigest: string | null;
	transactionCount: number;
	transactionDigest: string;
};
type Derived = {
	ownerId: number;
	asOfDate: string;
	timeZone: string;
	currency: string;
	sourceDigest: string;
	provenance: Provenance[];
	records(recordedAt: string): BaselineEvidence[];
};
type StoredReceipt = {
	version: 1;
	method: typeof METHOD;
	ownerId: number;
	asOfDate: string;
	timeZone: string;
	currency: string;
	recordedAt: string;
	sourceDigest: string;
	provenance: Provenance[];
	records: BaselineEvidence[];
};

export type LedgerBaselineConfig = { currency: string; timeZone: string };
export type LedgerFinanceEvidenceContext = {
	ownerId: number;
	timeZone: string;
	baselineDate: string;
	previewClosingCatalog: Exclude<BaselineCatalog, null>;
	closingCatalog: Exclude<BaselineCatalog, null>;
	prepareClosingEvidence: (ownerId: number, date: string) => void;
	historyPolicies: readonly HistoryCapturePolicy[];
	historyReceipts: readonly HistoryExternalEvidence[];
};

function digest(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function validTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
		return true;
	} catch {
		return false;
	}
}
export function ledgerBaselineConfig(
	env: Record<string, string | undefined> = process.env
): LedgerBaselineConfig | null {
	if (env.GALENE_LEDGER_BASELINE_ENABLED !== '1') return null;
	const currency = String(env.GALENE_LEDGER_BASELINE_CURRENCY ?? '').trim();
	const timeZone = String(env.GALENE_LEDGER_BASELINE_TIME_ZONE ?? '').trim();
	if (!/^[A-Z]{3}$/.test(currency) || !timeZone || !validTimeZone(timeZone)) return null;
	return { currency, timeZone };
}
function previousDay(value: string): string {
	return new Date(civil(value).getTime() - 86_400_000).toISOString().slice(0, 10);
}
function providerObservation(value: string | null, timeZone: string): { date: string; instant: string } {
	if (!value || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		throw new Error('provider observation timestamp unavailable');
	}
	const instant = timestamp(value.replace(' ', 'T') + '.000Z');
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date(instant));
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
	const date = `${part('year')}-${part('month')}-${part('day')}`;
	civil(date);
	return { date, instant };
}
function accounts(database: Database, ownerId: number): AccountRow[] {
	if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error('invalid owner');
	const rows = database
		.query(
			`SELECT id, opening_balance_cents, opening_as_of, provider, external_id,
			        provider_balance_cents, provider_balance_as_of
			 FROM accounts WHERE user_id = ? ORDER BY id LIMIT ?`
		)
		.all(ownerId, MAX_ACCOUNTS + 1) as AccountRow[];
	if (!rows.length || rows.length > MAX_ACCOUNTS) throw new Error('baseline account scope unavailable');
	return rows;
}
function anchor(row: AccountRow, timeZone: string, now: string): Anchor {
	if (row.opening_balance_cents !== null || row.opening_as_of !== null) {
		if (!Number.isSafeInteger(row.opening_balance_cents) || !row.opening_as_of) {
			throw new Error('opening anchor incomplete');
		}
		civil(row.opening_as_of);
		return { kind: 'opening', balanceCents: row.opening_balance_cents!, date: row.opening_as_of };
	}
	if (
		!Number.isSafeInteger(row.provider_balance_cents) ||
		!row.provider ||
		!row.external_id ||
		!row.provider_balance_as_of
	) {
		throw new Error('provider anchor incomplete');
	}
	const observation = providerObservation(row.provider_balance_as_of, timeZone);
	if (observation.instant > now) throw new Error('provider observation is in the future');
	return {
		kind: 'provider_observation',
		balanceCents: row.provider_balance_cents!,
		date: observation.date,
		observedAt: observation.instant,
		identityDigest: digest(['ledger-baseline-provider-v1', row.provider, row.external_id])
	};
}
function latestCommonDate(
	database: Database,
	ownerId: number,
	now: string,
	config: LedgerBaselineConfig
): string {
	timestamp(now);
	let latest = baselineClosedDate({ now, timeZone: config.timeZone });
	let earliest = '1900-01-01';
	for (const row of accounts(database, ownerId)) {
		const source = anchor(row, config.timeZone, now);
		if (source.kind === 'opening') {
			if (source.date > earliest) earliest = source.date;
		} else {
			const firstEligible = new Date(
				civil(source.date).getTime() - PROVIDER_ROLLBACK_DAYS * 86_400_000
			).toISOString().slice(0, 10);
			if (firstEligible > earliest) earliest = firstEligible;
			const lastEligible = previousDay(source.date);
			if (lastEligible < latest) latest = lastEligible;
		}
	}
	if (latest < earliest) throw new Error('no common completed baseline date');
	return latest;
}
function transactionRows(
	database: Database,
	ownerId: number,
	accountId: number,
	from: string,
	through: string,
	includeFrom: boolean
): TransactionRow[] {
	const operator = includeFrom ? '>=' : '>';
	const rows = database
		.query(
			`SELECT id, date, amount_cents FROM transactions
			 WHERE user_id = ? AND account_id = ? AND pending = 0
			   AND date ${operator} ? AND date <= ?
			 ORDER BY date, id LIMIT ?`
		)
		.all(ownerId, accountId, from, through, MAX_TRANSACTIONS + 1) as TransactionRow[];
	if (rows.length > MAX_TRANSACTIONS) throw new Error('baseline transaction scope too large');
	for (const row of rows) {
		if (!Number.isSafeInteger(row.id) || row.id < 1 || !Number.isSafeInteger(row.amount_cents)) {
			throw new Error('invalid baseline transaction');
		}
		civil(row.date);
	}
	return rows;
}
function description(kind: Anchor['kind']): string {
	return kind === 'opening'
		? 'Accepted estimate derived from the native opening anchor and posted signed parent transactions through the completed-day cutoff. Categories and splits are not used.'
		: 'Accepted estimate derived from a later stored provider balance observation by reversing posted signed parent transactions after the completed-day cutoff through the observation civil date. It is a ledger estimate, not an independently verified end-of-day bank balance; categories and splits are not used.';
}
function derive(
	database: Database,
	ownerId: number,
	date: string,
	now: string,
	config: LedgerBaselineConfig
): Derived {
	civil(date);
	timestamp(now);
	if (date > baselineClosedDate({ now, timeZone: config.timeZone })) throw new Error('baseline day is not closed');
	const canonicalAccounts: unknown[] = [];
	const evidenceParts: { accountId: number; balanceCents: number; source: Anchor }[] = [];
	const provenance: Provenance[] = [];
	for (const row of accounts(database, ownerId)) {
		const source = anchor(row, config.timeZone, now);
		let transactions: TransactionRow[];
		let balance = source.balanceCents;
		if (source.kind === 'opening') {
			if (date < source.date) throw new Error('cutoff precedes opening anchor');
			transactions = transactionRows(database, ownerId, row.id, source.date, date, true);
			for (const transaction of transactions) balance = add(balance, transaction.amount_cents);
		} else {
			if (date >= source.date) throw new Error('provider cutoff must precede observation day');
			const rollbackDays = (civil(source.date).getTime() - civil(date).getTime()) / 86_400_000;
			if (rollbackDays > PROVIDER_ROLLBACK_DAYS) throw new Error('provider rollback exceeds proven window');
			transactions = transactionRows(database, ownerId, row.id, date, source.date, false);
			for (const transaction of transactions) balance = add(balance, -transaction.amount_cents);
		}
		const transactionDigest = digest(transactions.map((t) => [t.id, t.date, t.amount_cents]));
		provenance.push({
			accountId: row.id,
			anchorKind: source.kind,
			anchorDate: source.date,
			anchorObservedAt: source.kind === 'provider_observation' ? source.observedAt : null,
			anchorIdentityDigest: source.kind === 'provider_observation' ? source.identityDigest : null,
			transactionCount: transactions.length,
			transactionDigest
		});
		canonicalAccounts.push({
			accountId: row.id,
			anchor: source,
			transactions: transactions.map((t) => ({ id: t.id, date: t.date, amountCents: t.amount_cents }))
		});
		evidenceParts.push({ accountId: row.id, balanceCents: balance, source });
	}
	const sourceDigest = digest({
		version: 1,
		method: METHOD,
		ownerId,
		asOfDate: date,
		timeZone: config.timeZone,
		currency: config.currency,
		accounts: canonicalAccounts
	});
	return {
		ownerId,
		asOfDate: date,
		timeZone: config.timeZone,
		currency: config.currency,
		sourceDigest,
		provenance,
		records: (recordedAt: string) => {
			timestamp(recordedAt);
			return evidenceParts.map((part) => ({
				reference: `ledger-baseline-v1:${digest([sourceDigest, part.accountId])}`,
				ownerId,
				accountId: part.accountId,
				currency: config.currency,
				balanceCents: part.balanceCents,
				asOfDate: date,
				timeZone: config.timeZone,
				cutoff: 'end_of_day',
				source: 'accepted_estimate',
				description: description(part.source.kind),
				recordedAt
			}));
		}
	};
}
function storedReceipt(database: Database, derived: Derived, now: string): BaselineEvidence[] {
	const row = database
		.query(
			`SELECT payload FROM ledger_baseline_receipts
			 WHERE owner_id = ? AND as_of_date = ? AND source_digest = ?`
		)
		.get(derived.ownerId, derived.asOfDate, derived.sourceDigest) as { payload: string } | null;
	if (!row) return [];
	if (row.payload.length > MAX_RECEIPT_BYTES) throw new Error('baseline receipt too large');
	const receipt = JSON.parse(row.payload) as StoredReceipt;
	timestamp(now);
	timestamp(receipt.recordedAt);
	if (
		receipt.version !== 1 ||
		receipt.method !== METHOD ||
		receipt.ownerId !== derived.ownerId ||
		receipt.asOfDate !== derived.asOfDate ||
		receipt.timeZone !== derived.timeZone ||
		receipt.currency !== derived.currency ||
		receipt.sourceDigest !== derived.sourceDigest ||
		receipt.recordedAt > now ||
		JSON.stringify(receipt.provenance) !== JSON.stringify(derived.provenance) ||
		JSON.stringify(receipt.records) !== JSON.stringify(derived.records(receipt.recordedAt))
	) throw new Error('baseline receipt invalid');
	return receipt.records;
}
function prepareReceipt(database: Database, derived: Derived, now: string): void {
	if (storedReceipt(database, derived, now).length) return;
	const count = database
		.query('SELECT COUNT(*) AS count FROM ledger_baseline_receipts WHERE owner_id = ? AND as_of_date = ?')
		.get(derived.ownerId, derived.asOfDate) as { count: number };
	if (count.count >= MAX_RECEIPTS_PER_DATE) throw new Error('baseline receipt revision limit reached');
	const receipt: StoredReceipt = {
		version: 1,
		method: METHOD,
		ownerId: derived.ownerId,
		asOfDate: derived.asOfDate,
		timeZone: derived.timeZone,
		currency: derived.currency,
		recordedAt: now,
		sourceDigest: derived.sourceDigest,
		provenance: derived.provenance,
		records: derived.records(now)
	};
	const payload = JSON.stringify(receipt);
	if (payload.length > MAX_RECEIPT_BYTES) throw new Error('baseline receipt too large');
	database
		.query(
			`INSERT INTO ledger_baseline_receipts
			 (owner_id, as_of_date, source_digest, recorded_at, payload) VALUES (?, ?, ?, ?, ?)`
		)
		.run(derived.ownerId, derived.asOfDate, derived.sourceDigest, now, payload);
}

/** Build a read-only request context. Only prepareClosingEvidence can write. */
export function ledgerFinanceEvidenceContext(
	database: Database,
	ownerId: number,
	now: string,
	config: LedgerBaselineConfig
): LedgerFinanceEvidenceContext {
	const baselineDate = latestCommonDate(database, ownerId, now, config);
	const previewClosingCatalog = (requestedOwner: number, date: string) => {
		if (requestedOwner !== ownerId) return [];
		try { return derive(database, ownerId, date, now, config).records(now); } catch { return []; }
	};
	const closingCatalog = (requestedOwner: number, date: string) => {
		if (requestedOwner !== ownerId) return [];
		try { return storedReceipt(database, derive(database, ownerId, date, now, config), now); } catch { return []; }
	};
	const prepareClosingEvidence = (requestedOwner: number, date: string) => {
		if (requestedOwner !== ownerId) throw new Error('owner scope mismatch');
		database.transaction(() => prepareReceipt(database, derive(database, ownerId, date, now, config), now)).immediate();
	};
	return {
		ownerId,
		timeZone: config.timeZone,
		baselineDate,
		previewClosingCatalog,
		closingCatalog,
		prepareClosingEvidence,
		historyPolicies: [],
		historyReceipts: []
	};
}
