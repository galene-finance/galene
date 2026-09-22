import type { Transaction } from '$lib/types';

export interface TrendDrillRow {
	id: string;
	date: string;
	label: string;
	amountCents: number;
	categoryId: number | null;
}

/** Rows that contribute to a trends bar: non-transfer spending, split-aware, same sign rule as the bar total. */
export function drillRows(
	transactions: Transaction[],
	categoryId: number | null,
	transferIds: ReadonlySet<number>
): TrendDrillRow[] {
	const out: TrendDrillRow[] = [];
	for (const t of transactions) {
		if (t.splits && t.splits.length > 0) {
			for (const s of t.splits) {
				if (transferIds.has(s.category_id)) continue;
				if (categoryId != null && s.category_id !== categoryId) continue;
				const amountCents = s.amount_cents * Math.sign(t.amount_cents);
				if (amountCents === 0) continue;
				out.push({
					id: `${t.id}-${s.category_id}`,
					date: t.date,
					label: t.merchant ?? t.account_name ?? 'Transaction',
					amountCents,
					categoryId: s.category_id
				});
			}
			continue;
		}
		if (t.category_id != null && transferIds.has(t.category_id)) continue;
		if (categoryId != null && t.category_id !== categoryId) continue;
		if (t.amount_cents === 0) continue;
		out.push({
			id: String(t.id),
			date: t.date,
			label: t.merchant ?? t.account_name ?? 'Transaction',
			amountCents: t.amount_cents,
			categoryId: t.category_id
		});
	}
	return out;
}
