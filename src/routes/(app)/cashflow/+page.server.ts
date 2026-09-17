import { fail, redirect } from '@sveltejs/kit';
import {
	cashflowFiltersActive,
	cashflowForMonths,
	getAccounts,
	getCashflowFilters,
	getCategories,
	getOccurrences,
	getScheduled,
	getTransactionsInPeriod,
	lastDayOfMonth,
	monthBounds,
	monthDiff,
	saveCashflowFilters,
	shiftMonth
} from '$lib/server/finance';

/** Compact header label, e.g. "AUG '26". */
function shortMonthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const mon = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
	return `${mon} '${String(y).slice(2)}`;
}

export function load({ locals, url }) {
	const userId = locals.user!.id;
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	// Date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD. The view is month-based, so only
	// the year-month of each date matters. Defaults to the last 6 months.
	const isDate = (s: string | null) => s != null && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	let fromMonth = isDate(fromParam) ? fromParam!.slice(0, 7) : shiftMonth(currentMonth, -5);
	let toMonth = isDate(toParam) ? toParam!.slice(0, 7) : currentMonth;
	if (fromMonth > toMonth) [fromMonth, toMonth] = [toMonth, fromMonth];
	if (monthDiff(fromMonth, toMonth) > 23) fromMonth = shiftMonth(toMonth, -23); // cap at 24 months

	// Date strings for the form inputs: first day of the start month, last day of the end month.
	const from = `${fromMonth}-01`;
	const to = lastDayOfMonth(toMonth);

	const monthList: string[] = [];
	for (let cur = fromMonth; cur <= toMonth; cur = shiftMonth(cur, 1)) monthList.push(cur);

	const filters = getCashflowFilters(userId);
	const { sections, summary } = cashflowForMonths(userId, monthList, filters);

	const accounts = getAccounts(userId);
	const categories = getCategories(userId);

	// Drill-down payloads: the range's transactions (splits attached) and
	// scheduled occurrences, scoped to the selected months and view filters.
	const rangeFrom = `${monthList[0]}-01`;
	const lastMonth = monthList[monthList.length - 1];
	const accountSet = filters.accountIds.length > 0 ? new Set(filters.accountIds) : null;
	const categorySet = filters.categoryIds.length > 0 ? new Set(filters.categoryIds) : null;
	const transferIds = new Set(categories.filter((c) => c.type === 'transfer').map((c) => c.id));

	function categoryAllowed(categoryId: number | null): boolean {
		if (categorySet) {
			// Explicit list: only selected ids (transfers only if listed).
			return categoryId != null && categorySet.has(categoryId);
		}
		// Default: all non-transfer (uncategorized allowed).
		return categoryId == null || !transferIds.has(categoryId);
	}

	let transactions = getTransactionsInPeriod(userId, rangeFrom, monthBounds(lastMonth).to);
	if (accountSet) transactions = transactions.filter((t) => accountSet.has(t.account_id));
	// Keep transactions that still contribute under the category filter (main
	// category or any split). Full exclusion of transfers matches cashflow totals.
	transactions = transactions.filter((t) => {
		if (t.splits && t.splits.length > 0) {
			return t.splits.some((s) => categoryAllowed(s.category_id));
		}
		return categoryAllowed(t.category_id);
	});

	const occurrences = getScheduled(userId)
		.filter((s) => {
			if (accountSet && (s.account_id == null || !accountSet.has(s.account_id))) return false;
			return categoryAllowed(s.category_id);
		})
		.flatMap((s) =>
			getOccurrences(s, rangeFrom, lastDayOfMonth(lastMonth)).map((date) => ({
				id: s.id,
				name: s.name,
				date,
				amountCents: s.amount_cents,
				behavior: s.forecast_behavior,
				categoryId: s.category_id,
				accountId: s.account_id
			}))
		);

	return {
		from,
		to,
		currentMonth,
		monthList,
		monthLabels: monthList.map(shortMonthLabel),
		sections,
		summary,
		transactions,
		occurrences,
		accounts,
		categories,
		filters,
		filtersActive: cashflowFiltersActive(filters)
	};
}

export const actions = {
	// Read-only bounce for stray POSTs (e.g. refresh re-POSTing a stale history entry).
	default: ({ url }) => redirect(303, url.pathname + url.search),

	'save-filters': async ({ request, locals, url }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const raw = String(form.get('filters') ?? '');
		let parsed: unknown = {};
		if (raw.trim() !== '') {
			try {
				parsed = JSON.parse(raw);
			} catch {
				return fail(400, { error: 'Invalid filters payload.' });
			}
		}
		saveCashflowFilters(userId, parsed);
		redirect(303, url.pathname + url.search);
	}
};
