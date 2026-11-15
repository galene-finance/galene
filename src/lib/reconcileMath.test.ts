import { describe, expect, test } from 'bun:test';
import { buildReconcileView, findDuplicates, pairKey, type ReconcileRow } from './reconcileMath';

function row(partial: Partial<ReconcileRow> & Pick<ReconcileRow, 'id' | 'amountCents'>): ReconcileRow {
	return {
		date: '2026-11-12',
		merchant: 'Coffee Shop',
		categoryName: 'Dining',
		cleared: false,
		reconciledAt: null,
		pending: false,
		synced: false,
		...partial
	};
}

describe('reconcile math', () => {
	test('left to explain is bank minus cleared, and the headline gap includes uncleared rows', () => {
		const rows = [
			row({ id: 1, date: '2026-11-14', merchant: 'Paycheck', amountCents: 240000, cleared: true, synced: true }),
			row({ id: 2, date: '2026-11-13', merchant: 'Check 1042', amountCents: -12000, cleared: false, synced: false }),
			row({ id: 3, date: '2026-11-12', merchant: 'Coffee Shop', amountCents: -480, cleared: true, synced: true }),
			row({ id: 4, date: '2026-11-12', merchant: 'Coffee Shop', amountCents: -480, cleared: false, synced: false })
		];
		const cleared = 240000 - 480;
		const view = buildReconcileView({
			openingCents: 0,
			openingAsOf: null,
			through: '2026-11-14',
			bankCents: cleared + 3738,
			rows,
			missing: [{ id: 9, date: '2026-11-10', amountCents: 3738, merchant: 'Corner Hardware' }],
			dismissedPairs: [],
			lastStatementDate: null,
			showAll: true,
			stagedAddIds: [],
			stagedDeleteIds: [],
			stagedAdjustmentCents: null,
			stagedAdjustmentDate: null
		});
		expect(view.ledgerCents).toBe(240000 - 12000 - 480 - 480);
		expect(view.clearedCents).toBe(cleared);
		expect(view.notClearedEffectCents).toBe(12000 + 480);
		expect(view.notClearedCount).toBe(2);
		expect(view.leftCents).toBe(3738);
		expect(view.previewLeftCents).toBe(3738);
		expect(view.canFinish).toBe(false);
		expect(view.duplicates).toHaveLength(1);
		expect(view.duplicates[0]?.manual.id).toBe(4);
		expect(view.notAtBank.map((item) => item.id)).toEqual([2]);
		expect(view.missingShown).toHaveLength(1);
		expect(view.ticked).toBe(2);
		expect(view.toCheck).toBe(4);
	});

	test('staging the missing line or an adjustment for the same amount enables finish', () => {
		const base = {
			openingCents: 0,
			openingAsOf: null,
			through: '2026-11-14',
			bankCents: 3738,
			rows: [] as ReconcileRow[],
			missing: [{ id: 9, date: '2026-11-10', amountCents: 3738, merchant: 'Corner Hardware' }],
			dismissedPairs: [],
			lastStatementDate: null,
			showAll: false,
			stagedDeleteIds: [],
			stagedAdjustmentCents: null,
			stagedAdjustmentDate: null
		};
		expect(buildReconcileView({ ...base, stagedAddIds: [9] }).canFinish).toBe(true);
		const exact = buildReconcileView({
			...base,
			stagedAddIds: [],
			stagedAdjustmentCents: 3738,
			stagedAdjustmentDate: '2026-11-14'
		});
		expect(exact.previewLeftCents).toBe(0);
		expect(exact.canFinish).toBe(true);
		const adjusted = buildReconcileView({
			...base,
			stagedAddIds: [],
			stagedAdjustmentCents: 1000,
			stagedAdjustmentDate: '2026-11-14'
		});
		expect(adjusted.previewLeftCents).toBe(2738);
		expect(adjusted.canFinish).toBe(false);
	});

	test('opening is ok when missing lines explain the gap, and a problem when they do not', () => {
		const explained = buildReconcileView({
			openingCents: 100,
			openingAsOf: '2026-10-01',
			through: '2026-11-14',
			bankCents: 100 + 3738,
			rows: [],
			missing: [{ id: 1, date: '2026-11-10', amountCents: 3738, merchant: 'Refund' }],
			dismissedPairs: [],
			lastStatementDate: null,
			showAll: false,
			stagedAddIds: [],
			stagedDeleteIds: [],
			stagedAdjustmentCents: null,
			stagedAdjustmentDate: null
		});
		expect(explained.opening?.ok).toBe(true);
		const openingGap = buildReconcileView({
			openingCents: 0,
			openingAsOf: '2026-10-01',
			through: '2026-11-14',
			bankCents: 25000,
			rows: [],
			missing: [],
			dismissedPairs: [],
			lastStatementDate: null,
			showAll: false,
			stagedAddIds: [],
			stagedDeleteIds: [],
			stagedAdjustmentCents: null,
			stagedAdjustmentDate: null
		});
		expect(openingGap.leftCents).toBe(25000);
		expect(openingGap.opening?.ok).toBe(false);
		expect(openingGap.opening?.residualCents).toBe(25000);
	});

	test('keep both drops the duplicate hint', () => {
		const rows = [
			row({ id: 1, amountCents: -480, synced: true, cleared: true }),
			row({ id: 2, amountCents: -480, synced: false, cleared: false })
		];
		expect(findDuplicates(rows, new Set()).map((pair) => pair.manual.id)).toEqual([2]);
		expect(findDuplicates(rows, new Set([pairKey(2, 1)]))).toEqual([]);
	});

	test('rows after the statement date stay out of the cleared balance', () => {
		const view = buildReconcileView({
			openingCents: 0,
			openingAsOf: null,
			through: '2026-11-14',
			bankCents: 0,
			rows: [row({ id: 1, date: '2026-11-20', amountCents: -500, cleared: true, synced: true })],
			missing: [],
			dismissedPairs: [],
			lastStatementDate: null,
			showAll: true,
			stagedAddIds: [],
			stagedDeleteIds: [],
			stagedAdjustmentCents: null,
			stagedAdjustmentDate: null
		});
		expect(view.ledgerCents).toBe(-500);
		expect(view.clearedCents).toBe(0);
		expect(view.afterThroughCents).toBe(-500);
		expect(view.visibleRows).toHaveLength(0);
		expect(view.canFinish).toBe(true);
	});
});
