/** Pure helpers for narrow Calendar D2 stack (#149). */

export type WeekStart = 'sunday' | 'monday';

export type CalendarDayCell = {
	iso: string;
	day: number;
	inMonth: boolean;
	transactions: { amount_cents: number }[];
	occurrences: { scheduled: { color: string | null } }[];
};

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DOW_LONG = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
] as const;

/** Parse YYYY-MM-DD as UTC midnight (stable across local TZ). */
export function parseIsoUtc(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

export function formatIsoUtc(d: Date): string {
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
		d.getUTCDate()
	).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, delta: number): string {
	const d = parseIsoUtc(iso);
	d.setUTCDate(d.getUTCDate() + delta);
	return formatIsoUtc(d);
}

/** Seven ISO dates for the week containing `iso`, respecting weekStartsOn. */
export function weekContaining(iso: string, weekStartsOn: WeekStart): string[] {
	const d = parseIsoUtc(iso);
	const dow = d.getUTCDay(); // 0=Sun
	const offset = weekStartsOn === 'monday' ? (dow + 6) % 7 : dow;
	const start = addDaysIso(iso, -offset);
	return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

export function dowShort(iso: string): string {
	return DOW_SHORT[parseIsoUtc(iso).getUTCDay()];
}

export function dowLong(iso: string): string {
	return DOW_LONG[parseIsoUtc(iso).getUTCDay()];
}

/** "Tuesday 6" style label for a day card header. */
export function dayCardDateLabel(iso: string): string {
	const d = parseIsoUtc(iso);
	return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Default selected day for a month view: today if in month, else the 1st. */
export function defaultSelectedIso(month: string, today: string): string {
	if (today.startsWith(month)) return today;
	return `${month}-01`;
}

export function dayBookedCents(
	transactions: { amount_cents: number }[],
	hideActuals: boolean
): number {
	if (hideActuals) return 0;
	return transactions.reduce((sum, t) => sum + t.amount_cents, 0);
}

/** Compact day total: booked sum, with " + sched" when scheduled items exist. */
export function dayTotalLabel(
	bookedCents: number,
	scheduledCount: number,
	hideActuals: boolean
): string {
	const hasSched = scheduledCount > 0;
	if (hideActuals) {
		return hasSched ? 'Scheduled' : '—';
	}
	const money = formatCentsCompact(bookedCents);
	if (hasSched && bookedCents !== 0) return `${money} + sched`;
	if (hasSched && bookedCents === 0) return scheduledCount === 1 ? 'Scheduled' : 'Scheduled';
	if (bookedCents === 0 && !hasSched) return '—';
	return money;
}

function formatCentsCompact(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	})}`;
}

/** First schedule color on a day (for strip/mini dots), else null. */
export function firstScheduleColor(
	occurrences: { scheduled: { color: string | null } }[]
): string | null {
	for (const o of occurrences) {
		if (o.scheduled.color) return o.scheduled.color;
	}
	return null;
}

export function dayHasBooked(
	transactions: { amount_cents: number }[],
	hideActuals: boolean
): boolean {
	return !hideActuals && transactions.length > 0;
}

export function dayHasScheduled(
	occurrences: { scheduled: unknown }[]
): boolean {
	return occurrences.length > 0;
}

/** Soft fill from a #rrggbb (appends 1a ≈ 10% alpha). */
export function softFill(hex: string | null | undefined): string | undefined {
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
	return `${hex}1a`;
}

export type MobileCalendarView = 'stack' | 'month';

export const MOBILE_VIEW_STORAGE_KEY = 'galene_calendar_mobile_view';

export function parseMobileView(raw: string | null): MobileCalendarView | null {
	if (raw === 'stack' || raw === 'month') return raw;
	return null;
}

/** Other week days that have activity, excluding the selected day. */
export function otherWeekDaysWithActivity<T extends CalendarDayCell>(
	weekCells: T[],
	selectedIso: string,
	hideActuals: boolean
): T[] {
	return weekCells.filter((c) => {
		if (c.iso === selectedIso) return false;
		const booked = dayHasBooked(c.transactions, hideActuals);
		const sched = dayHasScheduled(c.occurrences);
		return booked || sched;
	});
}
