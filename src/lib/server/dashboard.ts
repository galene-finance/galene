import {
	DASHBOARD_SETTING_KEY,
	DEFAULT_LAYOUT,
	sanitizeLayout
} from '$lib/dashboard';
import type {
	DashboardFilters,
	DashboardWidget,
	DashboardWidgetData
} from '$lib/types';
import {
	categoryAmountInPeriod,
	currentPeriodBounds,
	getAccountBalances,
	getAccounts,
	getBudgets,
	getCategories,
	getOccurrences,
	getScheduled,
	getSetting,
	getTransactions,
	monthBounds,
	monthSpendingCents,
	setSetting,
	shiftMonth
} from './finance';
import { listNotifications, unreadCount } from './notifications';
import { dayGroupLabel, monthLabel, todayISO } from '$lib/utils';
import { db } from './db';
import { detectRecurringSuggestions } from './recurringDetect';

/** The user's saved layout, or the default one when nothing is stored yet. */
export function getDashboardLayout(userId: number): DashboardWidget[] {
	const raw = getSetting(userId, DASHBOARD_SETTING_KEY);
	if (raw === null) return DEFAULT_LAYOUT;
	try {
		return sanitizeLayout(JSON.parse(raw));
	} catch {
		return DEFAULT_LAYOUT;
	}
}

/** Validate and persist a layout; returns the sanitized (compacted) layout. */
export function saveDashboardLayout(userId: number, layout: unknown): DashboardWidget[] {
	const sanitized = sanitizeLayout(layout);
	setSetting(userId, DASHBOARD_SETTING_KEY, JSON.stringify(sanitized));
	return sanitized;
}

/** Compute the data payload for every widget in a layout, keyed by widget id. */
export function computeDashboardData(userId: number, layout: DashboardWidget[]): Record<string, DashboardWidgetData> {
	const out: Record<string, DashboardWidgetData> = {};
	for (const w of layout) out[w.id] = computeWidgetData(userId, w);
	return out;
}

function computeWidgetData(userId: number, w: DashboardWidget): DashboardWidgetData {
	switch (w.type) {
		case 'balances':
			return balancesData(userId, w.filters);
		case 'recent':
			return recentData(userId, w.filters);
		case 'upcoming':
			return upcomingData(userId, w.filters);
		case 'budgets':
			return budgetsData(userId, w.filters);
		case 'month':
			return monthData(userId, w.filters);
		case 'notifications':
			return notificationsData(userId, w.filters);
		case 'trends':
			return trendsData(userId, w.filters);
	}
}

/**
 * Running ledger balance per account (issue #44) plus last provider/bank
 * balance when synced (issue #45). Manual accounts keep bankCents null.
 * Ledger: opening_balance_cents + SUM(txns on/after opening_as_of); opening is
 * balance *before* those transactions. Unset opening/as-of → legacy SUM(all txns).
 */
function balancesData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const balanceByAccount = getAccountBalances(userId);
	const items = getAccounts(userId)
		.filter((a) => {
			if (f.accountType && a.type !== f.accountType) return false;
			if (f.accountIds && f.accountIds.length && !f.accountIds.includes(a.id)) return false;
			return true;
		})
		.map((a) => {
			const linked = Boolean(a.provider);
			const bank =
				linked && a.provider_balance_cents != null ? a.provider_balance_cents : null;
			return {
				id: a.id,
				name: a.name,
				type: a.type,
				color: a.color,
				balanceCents: balanceByAccount.get(a.id) ?? 0,
				bankCents: bank,
				bankAsOf: bank != null ? (a.provider_balance_as_of ?? null) : null
			};
		});
	return { kind: 'balances', items, totalCents: items.reduce((s, i) => s + i.balanceCents, 0) };
}

function recentData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const { items } = getTransactions(userId, {
		accountIds: f.accountIds ?? [],
		categoryIds: f.categoryIds ?? [],
		tagIds: f.tagIds ?? [],
		amountOp: '',
		amountFrom: null,
		amountTo: null,
		dateFrom: null,
		dateTo: null,
		q: '',
		page: 1,
		pageSize: f.limit ?? 10
	});
	return { kind: 'recent', items };
}

function upcomingData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const days = f.days ?? 14;
	const today = todayISO();
	const end = addDaysISO(today, days - 1);
	const byDate = new Map<string, { id: number; name: string; amountCents: number; color: string | null; accountName: string | null; categoryName: string | null }[]>();
	for (const s of getScheduled(userId)) {
		if (f.accountIds && f.accountIds.length) {
			if (s.account_id === null || !f.accountIds.includes(s.account_id)) continue;
		}
		if (f.categoryIds && f.categoryIds.length) {
			if (s.category_id === null || !f.categoryIds.includes(s.category_id)) continue;
		}
		for (const date of getOccurrences(s, today, end)) {
			const list = byDate.get(date) ?? [];
			list.push({
				id: s.id,
				name: s.name,
				amountCents: s.amount_cents,
				color: s.color,
				accountName: s.account_name ?? null,
				categoryName: s.category_name ?? null
			});
			byDate.set(date, list);
		}
	}
	const daysOut = [...byDate.keys()].sort().map((date) => ({
		date,
		label: dayGroupLabel(date),
		items: byDate.get(date)!.sort((a, b) => a.name.localeCompare(b.name))
	}));
	const recurringSuggestionCount = detectRecurringSuggestions(userId).length;
	return { kind: 'upcoming', days: daysOut, recurringSuggestionCount };
}

function budgetsData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const categories = getCategories(userId);
	const items = getBudgets(userId)
		.filter((b) => {
			if (f.period && b.period !== f.period) return false;
			if (f.categoryIds && f.categoryIds.length && !f.categoryIds.includes(b.category_id)) return false;
			return true;
		})
		.filter((b) => categories.find((c) => c.id === b.category_id)?.type !== 'transfer')
		.map((b) => {
			const cat = categories.find((c) => c.id === b.category_id);
			const { from, to } = currentPeriodBounds(b.period);
			const signed = categoryAmountInPeriod(userId, b.category_id, from, to);
			const spent = cat?.type === 'income' ? signed : -signed;
			return {
				id: b.id,
				categoryName: b.category_name,
				categoryColor: b.category_color,
				period: b.period,
				limitCents: b.limit_cents,
				spentCents: Math.max(0, Math.round(spent))
			};
		});
	return { kind: 'budgets', items };
}

/**
 * Raw (non-split-aware) income/expense sums for a date range, matching the
 * home summary's treatment of split transactions as their parent amount.
 */
function monthSums(userId: number, from: string, to: string, f: DashboardFilters): { income: number; expense: number } {
	const where: string[] = ['user_id = ?', 'date >= ?', 'date < ?'];
	const params: (number | string)[] = [userId, from, to];
	if (f.accountIds && f.accountIds.length) {
		where.push(`account_id IN (${f.accountIds.map(() => '?').join(',')})`);
		params.push(...f.accountIds);
	}
	if (f.categoryIds && f.categoryIds.length) {
		where.push(`category_id IN (${f.categoryIds.map(() => '?').join(',')})`);
		params.push(...f.categoryIds);
	}
	if (f.tagIds && f.tagIds.length) {
		where.push(
			`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = transactions.id AND tt.tag_id IN (${f.tagIds
				.map(() => '?')
				.join(',')}))`
		);
		params.push(...f.tagIds);
	}
	// Transfer-categorized amounts are excluded from income/expense (issue #36).
	where.push(
		`(category_id IS NULL OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = transactions.category_id AND c.is_transfer = 1))`
	);
	const row = db()
		.query(
			`SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income,
			        COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) AS expense
			 FROM transactions
			 WHERE ${where.join(' AND ')}`
		)
		.get(...params) as { income: number; expense: number };
	return { income: Math.round(row.income), expense: Math.round(row.expense) };
}

function monthData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const now = new Date();
	const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const prev = shiftMonth(cur, -1);
	const c = monthSums(userId, monthBounds(cur).from, monthBounds(cur).to, f);
	const p = monthSums(userId, monthBounds(prev).from, monthBounds(prev).to, f);
	return {
		kind: 'month',
		label: monthLabel(cur),
		prevLabel: monthLabel(prev),
		incomeCents: c.income,
		expenseCents: c.expense,
		netCents: c.income - c.expense,
		prevIncomeCents: p.income,
		prevExpenseCents: p.expense
	};
}

function notificationsData(userId: number, f: DashboardFilters): DashboardWidgetData {
	let items = listNotifications(userId, 30);
	if (f.kinds && f.kinds.length) items = items.filter((n) => f.kinds!.includes(n.kind));
	if (f.unreadOnly) items = items.filter((n) => n.read_at === null);
	return { kind: 'notifications', items: items.slice(0, 10), unread: unreadCount(userId) };
}

function trendsData(userId: number, f: DashboardFilters): DashboardWidgetData {
	const months = f.months ?? 6;
	const now = new Date();
	const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const categoryId = f.categoryIds && f.categoryIds.length ? f.categoryIds[0] : null;
	const points = [];
	for (let i = months - 1; i >= 0; i--) {
		const m = shiftMonth(cur, -i);
		const { from, to } = monthBounds(m);
		points.push({
			key: m,
			label: shortMonthLabel(m),
			spentCents: monthSpendingCents(userId, from, to, categoryId)
		});
	}
	return { kind: 'trends', months, points };
}

/** Short axis label, e.g. "Sep" (full year shown in the bar tooltip). */
function shortMonthLabel(ym: string): string {
	const [y, m] = ym.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 1, 1));
	return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/** 'YYYY-MM-DD' plus N days (local-date arithmetic, no timezone drift). */
function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	dt.setUTCDate(dt.getUTCDate() + days);
	return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
