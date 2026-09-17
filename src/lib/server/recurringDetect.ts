/**
 * Recurring / subscription detection POC (ADO-13).
 * Local heuristics only — never auto-creates scheduled expectations.
 */
import { db } from '$lib/server/db';
import { getScheduled, getSetting, setSetting } from '$lib/server/finance';
import type { RecurringSuggestion, RepeatUnit } from '$lib/types';

const DISMISS_KEY = 'recurring_dismissed';
const LOOKBACK_DAYS = 365;
const MIN_HITS = 3;

export type RecurringGuessUnit = RepeatUnit;

export type { RecurringSuggestion };

function normalizeMerchant(raw: string | null): string | null {
	if (!raw) return null;
	let s = raw.trim().toLowerCase();
	s = s.replace(/\s+/g, ' ');
	// Drop trailing store numbers / #123
	s = s.replace(/\s+#?\d{2,}$/g, '').trim();
	if (s.length < 2) return null;
	return s;
}

function median(nums: number[]): number {
	if (nums.length === 0) return 0;
	const a = [...nums].sort((x, y) => x - y);
	const mid = Math.floor(a.length / 2);
	return a.length % 2 ? a[mid]! : Math.round((a[mid - 1]! + a[mid]!) / 2);
}

function daysBetween(a: string, b: string): number {
	const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
	const db_ = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
	return Math.round((db_ - da) / 86400000);
}

function addInterval(iso: string, interval: number, unit: RecurringGuessUnit): string {
	const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
	if (unit === 'day') d.setUTCDate(d.getUTCDate() + interval);
	else if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7 * interval);
	else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + interval);
	else d.setUTCFullYear(d.getUTCFullYear() + interval);
	return d.toISOString().slice(0, 10);
}

/** Guess cadence from sorted ascending day-gaps between hits. */
function guessCadence(gaps: number[]): { interval: number; unit: RecurringGuessUnit; score: number } | null {
	if (gaps.length === 0) return null;
	const med = median(gaps);
	const candidates: { interval: number; unit: RecurringGuessUnit; target: number }[] = [
		{ interval: 1, unit: 'week', target: 7 },
		{ interval: 2, unit: 'week', target: 14 },
		{ interval: 1, unit: 'month', target: 30.4 },
		{ interval: 1, unit: 'year', target: 365 }
	];
	let best: { interval: number; unit: RecurringGuessUnit; score: number } | null = null;
	for (const c of candidates) {
		const err = Math.abs(med - c.target) / c.target;
		if (err > 0.35) continue;
		// How many gaps are within 25% of target
		const close = gaps.filter((g) => Math.abs(g - c.target) / c.target <= 0.25).length;
		const score = close / gaps.length - err;
		if (!best || score > best.score) best = { interval: c.interval, unit: c.unit, score };
	}
	return best;
}

function modeId(ids: (number | null)[]): number | null {
	const counts = new Map<number, number>();
	for (const id of ids) {
		if (id == null) continue;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	let best: number | null = null;
	let n = 0;
	for (const [id, c] of counts) {
		if (c > n) {
			best = id;
			n = c;
		}
	}
	return best;
}

export function getDismissedRecurring(userId: number): string[] {
	const raw = getSetting(userId, DISMISS_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		return [];
	}
}

export function dismissRecurringSuggestion(userId: number, key: string) {
	const set = new Set(getDismissedRecurring(userId));
	set.add(key);
	setSetting(userId, DISMISS_KEY, JSON.stringify([...set]));
}

export function undismissRecurringSuggestion(userId: number, key: string) {
	const next = getDismissedRecurring(userId).filter((k) => k !== key);
	setSetting(userId, DISMISS_KEY, JSON.stringify(next));
}

function looksLikeExistingScheduled(
	sugs: { name: string; amount_cents: number; repeat_interval: number | null; repeat_unit: string | null }[],
	merchant: string,
	amountCents: number,
	interval: number,
	unit: string
): boolean {
	const m = merchant.toLowerCase();
	for (const s of sugs) {
		const sn = s.name.toLowerCase();
		if (!(sn.includes(m) || m.includes(sn))) continue;
		const amtOk = Math.abs(Math.abs(s.amount_cents) - amountCents) / Math.max(amountCents, 1) <= 0.15;
		if (!amtOk) continue;
		if (s.repeat_unit === unit && (s.repeat_interval ?? 1) === interval) return true;
		// Same name+amount recurring of any unit still counts as covered for POC
		if (s.repeat_unit) return true;
	}
	return false;
}

export function detectRecurringSuggestions(userId: number): RecurringSuggestion[] {
	const since = new Date();
	since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
	const sinceIso = since.toISOString().slice(0, 10);

	const rows = db()
		.query(
			`SELECT t.date, t.amount_cents, t.merchant, t.account_id, t.category_id,
			        a.name AS account_name, c.name AS category_name,
			        CASE WHEN c.id IS NULL THEN NULL WHEN c.is_transfer = 1 THEN 'transfer' ELSE c.type END AS category_type
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ?
			   AND t.date >= ?
			   AND t.amount_cents < 0
			   AND t.merchant IS NOT NULL
			   AND TRIM(t.merchant) != ''
			   AND (c.id IS NULL OR c.is_transfer = 0)
			 ORDER BY t.date ASC`
		)
		.all(userId, sinceIso) as {
		date: string;
		amount_cents: number;
		merchant: string;
		account_id: number;
		category_id: number | null;
		account_name: string;
		category_name: string | null;
		category_type: string | null;
	}[];

	type Bucket = {
		display: string;
		dates: string[];
		amounts: number[];
		accountIds: number[];
		categoryIds: (number | null)[];
		accountNames: string[];
		categoryNames: (string | null)[];
	};
	const groups = new Map<string, Bucket>();

	for (const r of rows) {
		const key = normalizeMerchant(r.merchant);
		if (!key) continue;
		let b = groups.get(key);
		if (!b) {
			b = {
				display: r.merchant.trim(),
				dates: [],
				amounts: [],
				accountIds: [],
				categoryIds: [],
				accountNames: [],
				categoryNames: []
			};
			groups.set(key, b);
		}
		b.dates.push(r.date);
		b.amounts.push(Math.abs(r.amount_cents));
		b.accountIds.push(r.account_id);
		b.categoryIds.push(r.category_id);
		b.accountNames.push(r.account_name);
		b.categoryNames.push(r.category_name);
	}

	const dismissed = new Set(getDismissedRecurring(userId));
	const scheduled = getScheduled(userId);
	const out: RecurringSuggestion[] = [];

	for (const [key, b] of groups) {
		if (dismissed.has(key)) continue;
		if (b.dates.length < MIN_HITS) continue;

		const gaps: number[] = [];
		for (let i = 1; i < b.dates.length; i++) {
			gaps.push(daysBetween(b.dates[i - 1]!, b.dates[i]!));
		}
		const cadence = guessCadence(gaps);
		if (!cadence) continue;

		const medianAmount = median(b.amounts);
		if (looksLikeExistingScheduled(scheduled, b.display, medianAmount, cadence.interval, cadence.unit)) {
			continue;
		}

		// Amount consistency
		const amtSpread =
			medianAmount === 0
				? 1
				: b.amounts.reduce((s, a) => s + Math.abs(a - medianAmount), 0) / b.amounts.length / medianAmount;
		const amountScore = Math.max(0, 1 - amtSpread);
		const confidence = Math.max(0.15, Math.min(0.99, 0.45 * cadence.score + 0.4 * amountScore + 0.15 * Math.min(1, b.dates.length / 8)));

		const accountId = modeId(b.accountIds);
		const categoryId = modeId(b.categoryIds);
		const accountName = accountId != null ? b.accountNames[b.accountIds.indexOf(accountId)] ?? null : null;
		const categoryName =
			categoryId != null ? b.categoryNames[b.categoryIds.indexOf(categoryId)] ?? null : null;

		const lastDate = b.dates[b.dates.length - 1]!;
		let nextDate = addInterval(lastDate, cadence.interval, cadence.unit);
		const today = new Date().toISOString().slice(0, 10);
		while (nextDate < today) {
			nextDate = addInterval(nextDate, cadence.interval, cadence.unit);
		}

		out.push({
			key,
			merchant: b.display,
			hitCount: b.dates.length,
			medianAmountCents: medianAmount,
			nextDate,
			lastDate,
			repeatInterval: cadence.interval,
			repeatUnit: cadence.unit,
			accountId,
			accountName,
			categoryId,
			categoryName,
			confidence,
			sampleDates: [...b.dates].reverse().slice(0, 6)
		});
	}

	out.sort((a, b) => b.confidence - a.confidence || b.hitCount - a.hitCount);
	return out;
}
