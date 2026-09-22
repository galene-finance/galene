export type TrendPeriod = 'week' | 'month' | 'year';

export interface TrendPoint {
	key: string;
	label: string;
	spentCents: number;
	budgetCents: number | null;
	/** Inclusive start of the bar's period (YYYY-MM-DD). */
	from: string;
	/** Exclusive end of the bar's period (YYYY-MM-DD). */
	to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Monday on or before the given local date (weeks are Monday-start, matching budgets). */
export function mondayOnOrBefore(d: Date): Date {
	const dow = (d.getDay() + 6) % 7;
	return new Date(d.getTime() - dow * 86400000);
}

export function toISO(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/** Last calendar day of [from, to), as YYYY-MM-DD. Transactions filters are inclusive. */
export function inclusiveEnd(toExclusive: string): string {
	const d = parseISO(toExclusive);
	d.setDate(d.getDate() - 1);
	return toISO(d);
}

export interface BudgetVertex {
	x: number;
	y: number;
}

/**
 * One vertex per bar that has a budget, at the bar's horizontal center.
 * Null budgets are skipped so the polyline connects the points that exist.
 */
export function budgetLinePoints(
	points: { budgetCents: number | null }[],
	xAt: (index: number) => number,
	yOf: (cents: number) => number
): BudgetVertex[] {
	const out: BudgetVertex[] = [];
	points.forEach((p, i) => {
		if (p.budgetCents === null) return;
		out.push({ x: xAt(i), y: yOf(p.budgetCents) });
	});
	return out;
}

/** SVG polyline `points` attribute. */
export function budgetPolyline(vertices: BudgetVertex[]): string {
	return vertices.map((v) => `${v.x},${v.y}`).join(' ');
}
