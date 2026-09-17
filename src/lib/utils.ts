export function formatMoney(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	})}`;
}

/** Parse a user-entered amount like "1,234.56" into integer cents. Returns null if invalid. */
export function parseAmountToCents(input: string): number | null {
	const trimmed = input.trim().replace(/[$,\s]/g, '');
	if (trimmed === '') return null;
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

/** Format integer cents as a plain dollar string for input fields, e.g. 4250 → "42.50". */
export function centsToDollars(cents: number): string {
	return (cents / 100).toFixed(2);
}


/**
 * Default opening as-of for suggestions (issue #47): earliest imported
 * transaction date for the account, else the calendar date of the provider
 * balance fetch / balance-date.
 */
export function defaultOpeningAsOf(
	earliestTxnDate: string | null | undefined,
	providerBalanceAsOf: string | null | undefined
): string | null {
	if (earliestTxnDate && /^\d{4}-\d{2}-\d{2}/.test(earliestTxnDate)) {
		return earliestTxnDate.slice(0, 10);
	}
	if (providerBalanceAsOf && /^\d{4}-\d{2}-\d{2}/.test(providerBalanceAsOf)) {
		return providerBalanceAsOf.slice(0, 10);
	}
	return null;
}

/**
 * Suggested opening ≈ bank/provider balance − SUM(txns on/after as-of).
 * Matches the #44 ledger rule (opening is the balance *before* those txns).
 */
export function suggestedOpeningCents(
	bankBalanceCents: number,
	txnSumOnOrAfterAsOfCents: number
): number {
	return Math.round(bankBalanceCents) - Math.round(txnSumOnOrAfterAsOfCents);
}

export function todayISO(): string {
	const d = new Date();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${month}-${day}`;
}

export function formatDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Group header for the mobile transaction list: "Today (Sep 9)", "Yesterday (Sep 8)", or the full date. */
export function dayGroupLabel(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	const short = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	const isoOf = (dt: Date) =>
		`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
	if (iso === isoOf(new Date())) return `Today (${short})`;
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	if (iso === isoOf(yesterday)) return `Yesterday (${short})`;
	return formatDate(iso);
}

export function monthLabel(iso: string): string {
	const [y, m] = iso.split('-').map(Number);
	return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Human-readable file size, e.g. "2.3 MB". */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "N duplicate(s) merged" trailer for sync summaries, empty when nothing merged. */
export function mergedNote(summary: { merged?: number }): string {
	return summary.merged ? `, ${summary.merged} duplicate${summary.merged === 1 ? '' : 's'} merged` : '';
}

/** Human label for a period range, e.g. "September 2026", "2026", "Sep 1 – Sep 7, 2026". */
export function periodLabel(period: 'week' | 'month' | 'year', from: string, to: string): string {
	const [fy, fm, fd] = from.split('-').map(Number);
	if (period === 'month') return new Date(fy, fm - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	if (period === 'year') return String(fy);
	const [ty, tm, td] = to.split('-').map(Number);
	// Local Date + local formatting: a UTC midnight would shift a day in negative-offset timezones.
	const end = new Date(ty, tm - 1, td - 1);
	const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	return `${fmt(new Date(fy, fm - 1, fd))} – ${fmt(end)}, ${fy}`;
}
