/**
 * Pure reconcile arithmetic (ADO-8). The headline compares the full ledger to
 * the bank. The work — and "left to explain" — compares the bank to the
 * cleared balance through the statement date. Nothing here writes.
 */

export interface ReconcileRow {
	id: number;
	date: string;
	amountCents: number;
	merchant: string | null;
	categoryName: string | null;
	cleared: boolean;
	reconciledAt: string | null;
	pending: boolean;
	/** Imported from a provider. Manual rows are not synced. */
	synced: boolean;
}

export interface MissingLine {
	id: number;
	date: string;
	amountCents: number;
	merchant: string | null;
}

export interface DuplicatePair {
	manual: ReconcileRow;
	synced: ReconcileRow;
}

export interface ReconcileInput {
	openingCents: number;
	openingAsOf: string | null;
	through: string;
	bankCents: number | null;
	rows: ReconcileRow[];
	missing: MissingLine[];
	/** Keys from pairKey for duplicates the user chose to keep. */
	dismissedPairs: string[];
	lastStatementDate: string | null;
	showAll: boolean;
	stagedAddIds: number[];
	stagedDeleteIds: number[];
	stagedAdjustmentCents: number | null;
	stagedAdjustmentDate: string | null;
}

export interface OpeningCause {
	asOf: string;
	residualCents: number;
	ok: boolean;
}

export interface ReconcileView {
	ledgerCents: number;
	ledgerThroughCents: number;
	clearedCents: number;
	previewClearedCents: number;
	/** Cleared minus the in-statement ledger. Positive when uncleared rows are outflows. */
	notClearedEffectCents: number;
	notClearedCount: number;
	/** Ledger rows dated after the statement. Not part of this reconcile. */
	afterThroughCents: number;
	/** Preview cleared minus the cleared balance: staged adds, deletes, and the adjustment. */
	stagedCents: number;
	leftCents: number | null;
	previewLeftCents: number | null;
	ticked: number;
	toCheck: number;
	visibleRows: ReconcileRow[];
	collapsedCount: number;
	collapsedRows: ReconcileRow[];
	reconciledShown: number;
	duplicates: DuplicatePair[];
	notAtBank: ReconcileRow[];
	missingShown: MissingLine[];
	opening: OpeningCause | null;
	canFinish: boolean;
	markCount: number;
	leaveCount: number;
	leaveMerchant: string | null;
	progressPct: number;
}

export function pairKey(manualId: number, syncedId: number): string {
	return `${manualId}:${syncedId}`;
}

export function inLedger(date: string, openingAsOf: string | null): boolean {
	return !openingAsOf || date >= openingAsOf;
}

export function inWindow(date: string, openingAsOf: string | null, through: string): boolean {
	return !!through && date <= through && inLedger(date, openingAsOf);
}

/** Same merchant, amount, and day, one manual and one synced, unless dismissed. */
export function findDuplicates(rows: ReconcileRow[], dismissed: ReadonlySet<string>): DuplicatePair[] {
	const groups = new Map<string, ReconcileRow[]>();
	for (const row of rows) {
		const merchant = row.merchant?.trim().toLowerCase() ?? '';
		if (!merchant) continue;
		const key = `${row.date}|${row.amountCents}|${merchant}`;
		const list = groups.get(key);
		if (list) list.push(row);
		else groups.set(key, [row]);
	}
	const pairs: DuplicatePair[] = [];
	for (const list of groups.values()) {
		const manuals = list.filter((row) => !row.synced);
		const synced = list.filter((row) => row.synced);
		const used = new Set<number>();
		for (const manual of manuals) {
			const match = synced.find((row) => !used.has(row.id) && !dismissed.has(pairKey(manual.id, row.id)));
			if (!match) continue;
			used.add(match.id);
			pairs.push({ manual, synced: match });
		}
	}
	return pairs;
}

function byDateDesc(a: { date: string; id: number }, b: { date: string; id: number }): number {
	if (a.date !== b.date) return a.date < b.date ? 1 : -1;
	return b.id - a.id;
}

export function buildReconcileView(input: ReconcileInput): ReconcileView {
	const deleted = new Set(input.stagedDeleteIds);
	const rows = input.rows.filter((row) => !deleted.has(row.id));
	const opening = input.openingCents;
	const asOf = input.openingAsOf;
	const through = input.through;

	let ledgerCents = opening;
	for (const row of rows) {
		if (inLedger(row.date, asOf)) ledgerCents += row.amountCents;
	}

	const inWin = rows.filter((row) => inWindow(row.date, asOf, through));
	const ledgerThroughCents = opening + inWin.reduce((sum, row) => sum + row.amountCents, 0);
	const clearedCents = opening + inWin.filter((row) => row.cleared).reduce((sum, row) => sum + row.amountCents, 0);

	const stagedAdds = input.missing.filter((line) => input.stagedAddIds.includes(line.id));
	let previewClearedCents = clearedCents;
	for (const line of stagedAdds) {
		if (inWindow(line.date, asOf, through)) previewClearedCents += line.amountCents;
	}
	const adjustmentDate = input.stagedAdjustmentDate;
	const adjustmentCents = input.stagedAdjustmentCents;
	if (adjustmentCents != null && adjustmentDate && inWindow(adjustmentDate, asOf, through)) {
		previewClearedCents += adjustmentCents;
	}

	const notCleared = inWin.filter((row) => !row.cleared);
	const leftCents = input.bankCents == null ? null : input.bankCents - clearedCents;
	const previewLeftCents = input.bankCents == null ? null : input.bankCents - previewClearedCents;

	const last = input.lastStatementDate;
	const collapsedRows = (last ? rows.filter((row) => row.reconciledAt && row.date < last) : []).sort(byDateDesc);
	const collapsedIds = new Set(collapsedRows.map((row) => row.id));
	const candidates = rows.filter((row) => inLedger(row.date, asOf) && row.date <= through && !collapsedIds.has(row.id));
	const openRows = candidates.filter((row) => !row.reconciledAt);
	const visibleRows = (input.showAll ? candidates : openRows).slice().sort(byDateDesc);

	const dismissed = new Set(input.dismissedPairs);
	const duplicates = findDuplicates(
		rows.filter((row) => inWindow(row.date, asOf, through)),
		dismissed
	).filter((pair) => !pair.manual.cleared);
	const duplicateManualIds = new Set(duplicates.map((pair) => pair.manual.id));
	const notAtBank = notCleared.filter((row) => !duplicateManualIds.has(row.id) && (!row.synced || row.pending));
	const missingShown = input.missing.filter((line) => inWindow(line.date, asOf, through));
	const missingExplain = missingShown.reduce((sum, line) => sum + line.amountCents, 0);

	const openingCause: OpeningCause | null =
		asOf && leftCents != null
			? { asOf, residualCents: leftCents - missingExplain, ok: leftCents - missingExplain === 0 }
			: null;

	const markCount =
		inWin.filter((row) => row.cleared && !row.reconciledAt).length +
		stagedAdds.filter((line) => inWindow(line.date, asOf, through)).length +
		(adjustmentCents != null && adjustmentDate && inWindow(adjustmentDate, asOf, through) ? 1 : 0);
	const leaveRows = inWin.filter((row) => !row.cleared && !row.reconciledAt);

	return {
		ledgerCents,
		ledgerThroughCents,
		clearedCents,
		previewClearedCents,
		notClearedEffectCents: clearedCents - ledgerThroughCents,
		notClearedCount: notCleared.length,
		afterThroughCents: ledgerCents - ledgerThroughCents,
		stagedCents: previewClearedCents - clearedCents,
		leftCents,
		previewLeftCents,
		ticked: openRows.filter((row) => row.cleared).length,
		toCheck: openRows.length,
		visibleRows,
		collapsedCount: collapsedRows.length,
		collapsedRows,
		reconciledShown: visibleRows.filter((row) => row.reconciledAt).length,
		duplicates,
		notAtBank,
		missingShown,
		opening: openingCause,
		canFinish: previewLeftCents === 0,
		markCount,
		leaveCount: leaveRows.length,
		leaveMerchant: leaveRows.length === 1 ? (leaveRows[0]?.merchant ?? null) : null,
		progressPct: progressPct(previewClearedCents, input.bankCents)
	};
}

function progressPct(cleared: number, bank: number | null): number {
	if (bank == null) return 0;
	if (bank === cleared) return 100;
	if (bank === 0) return 0;
	const ratio = cleared / bank;
	if (!Number.isFinite(ratio) || ratio <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}
