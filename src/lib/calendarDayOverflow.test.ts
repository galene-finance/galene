import { describe, expect, test } from 'bun:test';
import {
	GRID_MAX_PER_KIND,
	estimatedOverflowHeight,
	overflowPanelPosition,
	splitDayGridItems
} from './calendarDayOverflow';

describe('splitDayGridItems', () => {
	test('no overflow when under the per-kind cap', () => {
		const { shown, truncated, hidden } = splitDayGridItems(
			[{ id: 1 }, { id: 2 }],
			[{ id: 'a' }],
			false
		);
		expect(shown).toHaveLength(3);
		expect(truncated).toEqual([]);
		expect(hidden).toBe(0);
	});

	test('truncates transactions beyond the per-kind cap', () => {
		const txs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
		const { shown, truncated, hidden } = splitDayGridItems(txs, [], false);
		expect(shown.map((i) => (i.kind === 'tx' ? i.t.id : null))).toEqual([1, 2, 3]);
		expect(truncated.map((i) => (i.kind === 'tx' ? i.t.id : null))).toEqual([4, 5]);
		expect(hidden).toBe(2);
	});

	test('truncates scheduled beyond the per-kind cap', () => {
		const occs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
		const { shown, truncated, hidden } = splitDayGridItems([], occs, false);
		expect(shown).toHaveLength(GRID_MAX_PER_KIND);
		expect(truncated.map((i) => (i.kind === 'occ' ? i.o.id : null))).toEqual(['d']);
		expect(hidden).toBe(1);
	});

	test('lists truncated scheduled and actuals together', () => {
		const txs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
		const occs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
		const { shown, truncated, hidden } = splitDayGridItems(txs, occs, false);
		expect(shown).toHaveLength(6);
		expect(truncated).toEqual([
			{ kind: 'tx', t: { id: 4 } },
			{ kind: 'occ', o: { id: 'd' } },
			{ kind: 'occ', o: { id: 'e' } }
		]);
		expect(hidden).toBe(3);
	});

	test('hideActuals drops transactions from shown and truncated', () => {
		const txs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
		const occs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
		const { shown, truncated, hidden } = splitDayGridItems(txs, occs, true);
		expect(shown.every((i) => i.kind === 'occ')).toBe(true);
		expect(shown).toHaveLength(3);
		expect(truncated).toEqual([{ kind: 'occ', o: { id: 'd' } }]);
		expect(hidden).toBe(1);
	});
});

describe('overflowPanelPosition', () => {
	test('places below when there is room', () => {
		const pos = overflowPanelPosition(
			{ top: 100, bottom: 120, left: 40, width: 80 },
			{ width: 1280, height: 800 },
			160
		);
		expect(pos.top).toBe(126);
		expect(pos.left).toBe(40);
	});

	test('flips above when space below is tight', () => {
		const pos = overflowPanelPosition(
			{ top: 700, bottom: 720, left: 40, width: 80 },
			{ width: 1280, height: 800 },
			160
		);
		expect(pos.top).toBe(700 - 160 - 6);
	});

	test('clamps horizontally into the viewport', () => {
		const pos = overflowPanelPosition(
			{ top: 100, bottom: 120, left: 1200, width: 80 },
			{ width: 1280, height: 800 },
			160,
			256
		);
		expect(pos.left).toBe(1280 - 256 - 8);
	});
});

describe('estimatedOverflowHeight', () => {
	test('grows with items and clamps', () => {
		expect(estimatedOverflowHeight(1)).toBe(68);
		expect(estimatedOverflowHeight(20)).toBe(288);
	});
});
