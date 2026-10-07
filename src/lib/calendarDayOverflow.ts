/** Pure helpers for Calendar month-grid day overflow (+N more). */

/** Max items of each kind (actual / scheduled) shown in a month-grid day cell. */
export const GRID_MAX_PER_KIND = 3;

export type DayGridItem<T, O> = { kind: 'tx'; t: T } | { kind: 'occ'; o: O };

/**
 * Split a day's transactions and scheduled occurrences into the items shown in
 * the month-grid cell and the truncated remainder that belong behind +N more.
 * Truncation caps are per kind and must stay in sync with the cell UI.
 */
export function splitDayGridItems<T, O>(
	transactions: T[],
	occurrences: O[],
	hideActuals: boolean,
	maxPerKind: number = GRID_MAX_PER_KIND
): { shown: DayGridItem<T, O>[]; truncated: DayGridItem<T, O>[]; hidden: number } {
	const txs = hideActuals ? [] : transactions;
	const shownTxs = txs.slice(0, maxPerKind);
	const shownOccs = occurrences.slice(0, maxPerKind);
	const truncatedTxs = txs.slice(maxPerKind);
	const truncatedOccs = occurrences.slice(maxPerKind);
	const shown: DayGridItem<T, O>[] = [
		...shownTxs.map((t) => ({ kind: 'tx' as const, t })),
		...shownOccs.map((o) => ({ kind: 'occ' as const, o }))
	];
	const truncated: DayGridItem<T, O>[] = [
		...truncatedTxs.map((t) => ({ kind: 'tx' as const, t })),
		...truncatedOccs.map((o) => ({ kind: 'occ' as const, o }))
	];
	return { shown, truncated, hidden: truncated.length };
}

export function estimatedOverflowHeight(itemCount: number): number {
	// Header + rows; clamp to roughly max-h-72.
	return Math.min(288, 32 + Math.max(1, itemCount) * 36);
}

/** Anchor an overflow panel near its trigger (mirrors pill popup placement). */
export function overflowPanelPosition(
	rect: { top: number; bottom: number; left: number; width: number },
	viewport: { width: number; height: number } = { width: 1280, height: 800 },
	height = 160,
	panelWidth = 256
): { top: number; left: number } {
	const gap = 6;
	const margin = 8;
	let left = rect.left;
	if (left + panelWidth > viewport.width - margin) left = viewport.width - panelWidth - margin;
	if (left < margin) left = margin;
	const spaceBelow = viewport.height - rect.bottom;
	const top = spaceBelow < height ? Math.max(margin, rect.top - height - gap) : rect.bottom + gap;
	return { top, left };
}
