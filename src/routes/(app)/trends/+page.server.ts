import { redirect } from '@sveltejs/kit';
import { budgetsForCategory, getCategories, getTransactionsInPeriod, monthSpendingCents, saveBudget } from '$lib/server/finance';
import { mondayOnOrBefore, parseISO, toISO, type TrendPeriod, type TrendPoint } from '$lib/trendsChart';
import { drillRows } from '$lib/trendDrill';
import type { Budget } from '$lib/types';

type Period = TrendPeriod;

const isDate = (s: string | null) =>
	s != null && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function load({ locals, url }) {
	const userId = locals.user!.id;
	const now = new Date();

	const periodParam = url.searchParams.get('period');
	const period: Period = periodParam === 'week' || periodParam === 'year' ? periodParam : 'month';

	const categories = getCategories(userId);
	const catParam = url.searchParams.get('category') ?? '';
	const cat = /^\d+$/.test(catParam)
		? categories.find((c) => c.id === parseInt(catParam, 10))
		: undefined;
	const categoryId = cat ? cat.id : null;

	// Date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD. Defaults depend on the view
	// period; the range is capped so the chart stays readable.
	const defaultFrom =
		period === 'month'
			? new Date(now.getFullYear(), now.getMonth() - 11, 1)
			: period === 'week'
				? new Date(now.getTime() - 25 * 7 * 86400000)
				: new Date(now.getFullYear() - 9, 0, 1);
	const fromParam = url.searchParams.get('from');
	const toParam = url.searchParams.get('to');
	let from = isDate(fromParam) ? parseISO(fromParam!) : defaultFrom;
	let to = isDate(toParam) ? parseISO(toParam!) : now;
	if (from > to) [from, to] = [to, from];

	const maxFrom =
		period === 'month'
			? new Date(to.getFullYear(), to.getMonth() - 23, 1)
			: period === 'week'
				? new Date(to.getTime() - 51 * 7 * 86400000)
				: new Date(to.getFullYear() - 9, 0, 1);
	if (from < maxFrom) from = maxFrom;

	// The budget line sums all budgets (any period) for the selected
	// category, each scaled to the length of the period being viewed, so a
	// weekly budget shows as a month/year aggregate. Weekly budgets are
	// rate-based and scale with the target period's actual day count ($400/week
	// is $1,600 in a 28-day month, $1,771 in a 31-day month); monthly and
	// yearly budgets are fixed amounts and convert by count (×12, ÷12, ÷avg weeks).
	const AVG_MONTH_DAYS = 365.25 / 12;
	const AVG_YEAR_DAYS = 365.25;
	function scaleBudgetCents(limitCents: number, src: Budget['period'], targetDays: number): number {
		if (src === 'week') return (limitCents * targetDays) / 7;
		if (src === 'month') {
			if (period === 'week') return (limitCents * 7) / AVG_MONTH_DAYS;
			if (period === 'month') return limitCents;
			return limitCents * 12;
		}
		if (period === 'week') return (limitCents * 7) / AVG_YEAR_DAYS;
		if (period === 'month') return limitCents / 12;
		return limitCents;
	}
	const budgets = budgetsForCategory(userId, categoryId);
	const budgetForDays = (days: number) =>
		budgets.reduce((s, b) => s + scaleBudgetCents(b.limit_cents, b.period, days), 0);
	const toBudgetCents = (days: number) => {
		const c = Math.round(budgetForDays(days));
		return c > 0 ? c : null;
	};
	const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	const daysInYear = (y: number) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365);

	const points: TrendPoint[] = [];
	if (period === 'month') {
		let cur = new Date(from.getFullYear(), from.getMonth(), 1);
		const last = new Date(to.getFullYear(), to.getMonth(), 1);
		while (cur <= last) {
			const fromISO = toISO(cur);
			const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
			points.push({
				key: fromISO.slice(0, 7),
				label: `${MONTHS[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
				spentCents: monthSpendingCents(userId, fromISO, toISO(next), categoryId),
				budgetCents: toBudgetCents(daysInMonth(cur)),
				from: fromISO,
				to: toISO(next)
			});
			cur = next;
		}
	} else if (period === 'week') {
		const weekBudget = toBudgetCents(7);
		let cur = mondayOnOrBefore(from);
		const lastStart = mondayOnOrBefore(to);
		while (cur <= lastStart) {
			const fromISO = toISO(cur);
			const next = new Date(cur.getTime() + 7 * 86400000);
			points.push({
				key: fromISO,
				label: `${MONTHS[cur.getMonth()]} ${cur.getDate()}`,
				spentCents: monthSpendingCents(userId, fromISO, toISO(next), categoryId),
				budgetCents: weekBudget,
				from: fromISO,
				to: toISO(next)
			});
			cur = next;
		}
	} else {
		for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
			points.push({
				key: String(y),
				label: String(y),
				spentCents: monthSpendingCents(userId, `${y}-01-01`, `${y + 1}-01-01`, categoryId),
				budgetCents: toBudgetCents(daysInYear(y)),
				from: `${y}-01-01`,
				to: `${y + 1}-01-01`
			});
		}
	}

	const rangeFrom = points[0]?.from ?? toISO(from);
	const rangeTo = points[points.length - 1]?.to ?? toISO(to);
	const transferIds = new Set(categories.filter((c) => c.type === 'transfer').map((c) => c.id));
	const drillTransactions = drillRows(
		getTransactionsInPeriod(userId, rangeFrom, rangeTo),
		categoryId,
		transferIds
	);

	return {
		categoryId,
		categoryName: cat ? cat.name : null,
		categoryType: cat ? cat.type : null,
		period,
		from: toISO(from),
		to: toISO(to),
		points,
		categories,
		drillTransactions,
		hasBudget: budgets.length > 0,
		avgSpentCents: points.length
			? Math.round(points.reduce((s, p) => s + p.spentCents, 0) / points.length)
			: 0
	};
}

export const actions = {
	'create-budget': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const categoryId = parseInt(String(form.get('category_id') ?? ''), 10);
		const period = String(form.get('period') ?? '');
		const limitCents = parseInt(String(form.get('limit_cents') ?? ''), 10);
		const cat = getCategories(userId).find((c) => c.id === categoryId);
		if (!cat || cat.type === 'transfer') return { error: 'Select a category that can have a budget.' };
		if (period !== 'week' && period !== 'month' && period !== 'year') return { error: 'Invalid period.' };
		if (!Number.isFinite(limitCents) || limitCents <= 0) return { error: 'Enter a positive amount.' };
		if (budgetsForCategory(userId, categoryId).length > 0) {
			return { error: 'This category already has a budget.' };
		}
		saveBudget(userId, null, { categoryId, period, limitCents });
		const params = new URLSearchParams();
		params.set('category', String(categoryId));
		params.set('period', period);
		const nextFrom = String(form.get('next_from') ?? '');
		const nextTo = String(form.get('next_to') ?? '');
		if (isDate(nextFrom)) params.set('from', nextFrom);
		if (isDate(nextTo)) params.set('to', nextTo);
		redirect(303, `/trends?${params.toString()}`);
	}
};
