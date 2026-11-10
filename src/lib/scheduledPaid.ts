import { addDaysIso } from '$lib/calendarMobile';
import { formatRepeat } from '$lib/calendarPillPopup';
import type { RepeatUnit, Scheduled } from '$lib/types';

/** Unpaid occurrences older than this are not marked overdue. */
export const OVERDUE_LOOKBACK_DAYS = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type PillVisualState = 'paid' | 'overdue' | 'due' | 'scheduled';

export type PaidFields = {
	paid: boolean;
	paidAt: string | null;
	overdue: boolean;
	daysLate: number;
};

/** One expanded occurrence plus manual paid state. `date` is the display date. */
export type CalendarOccurrence = {
	date: string;
	occurrenceDate: string;
	scheduled: Scheduled;
} & PaidFields;

export type ScheduleFocus =
	| { kind: 'overdue'; date: string; occurrenceDate: string; daysLate: number }
	| { kind: 'paid'; date: string; occurrenceDate: string; paidAt: string }
	| { kind: 'due'; date: string; occurrenceDate: string }
	| { kind: 'upcoming'; date: string; occurrenceDate: string }
	| { kind: 'none' };

export function paidKey(scheduledId: number, occurrenceDate: string): string {
	return `${scheduledId}|${occurrenceDate}`;
}

export function isIsoDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Whole days from `from` to `to` (ISO dates, UTC). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	const [fy, fm, fd] = from.split('-').map(Number);
	const [ty, tm, td] = to.split('-').map(Number);
	const a = Date.UTC(fy, fm - 1, fd);
	const b = Date.UTC(ty, tm - 1, td);
	return Math.round((b - a) / 86400000);
}

/**
 * Overdue when unpaid, displayed before today, and still inside the lookback.
 * Today is not overdue. A date exactly 30 days back is. 31 days back is not.
 */
export function isOverdue(displayDate: string, paid: boolean, today: string): boolean {
	if (paid) return false;
	if (displayDate >= today) return false;
	return displayDate >= addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
}

export function daysLate(displayDate: string, today: string): number {
	return Math.max(0, daysBetween(displayDate, today));
}

export function attachPaidState<T extends { date: string; occurrenceDate: string; scheduled: { id: number } }>(
	rows: T[],
	paidAtByKey: ReadonlyMap<string, string>,
	today: string
): (T & PaidFields)[] {
	return rows.map((row) => {
		const paidAt = paidAtByKey.get(paidKey(row.scheduled.id, row.occurrenceDate)) ?? null;
		const paid = paidAt != null;
		const overdue = isOverdue(row.date, paid, today);
		return {
			...row,
			paid,
			paidAt,
			overdue,
			daysLate: overdue ? daysLate(row.date, today) : 0
		};
	});
}

/** Overdue rows whose display date falls in `YYYY-MM`. */
export function countOverdueInMonth(
	rows: { date: string; paid: boolean; overdue?: boolean }[],
	today: string,
	month: string
): number {
	const prefix = `${month}-`;
	return rows.filter(
		(row) => row.date.startsWith(prefix) && (row.overdue ?? isOverdue(row.date, row.paid, today))
	).length;
}

/**
 * Oldest unpaid past occurrence inside the lookback, otherwise the next
 * occurrence on or after today. Paid / due / upcoming describe that next date.
 */
export function selectScheduleFocus(
	occurrences: { date: string; occurrenceDate: string; paid: boolean; paidAt: string | null }[],
	today: string
): ScheduleFocus {
	const windowStart = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
	const sorted = [...occurrences].sort(
		(a, b) => a.date.localeCompare(b.date) || a.occurrenceDate.localeCompare(b.occurrenceDate)
	);
	const unpaidPast = sorted.filter((row) => !row.paid && row.date < today && row.date >= windowStart);
	if (unpaidPast.length > 0) {
		const oldest = unpaidPast[0];
		return {
			kind: 'overdue',
			date: oldest.date,
			occurrenceDate: oldest.occurrenceDate,
			daysLate: daysLate(oldest.date, today)
		};
	}
	const next = sorted.find((row) => row.date >= today);
	if (!next) return { kind: 'none' };
	if (next.paid) {
		return {
			kind: 'paid',
			date: next.date,
			occurrenceDate: next.occurrenceDate,
			paidAt: next.paidAt ?? ''
		};
	}
	if (next.date === today) return { kind: 'due', date: next.date, occurrenceDate: next.occurrenceDate };
	return { kind: 'upcoming', date: next.date, occurrenceDate: next.occurrenceDate };
}

/** Overdue wins, then paid, then due today. */
export function pillState(row: { paid: boolean; overdue: boolean; date: string }, today: string): PillVisualState {
	if (row.overdue) return 'overdue';
	if (row.paid) return 'paid';
	if (row.date === today) return 'due';
	return 'scheduled';
}

export function formatMonthDay(iso: string): string {
	const [, m, d] = iso.split('-').map(Number);
	return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

export function formatWeekdayMonthDay(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return `${weekday}, ${formatMonthDay(iso)}`;
}

/** "Nov 1, 9:12 AM" in local time. */
export function formatPaidStamp(paidAt: string): string {
	const date = new Date(paidAt);
	if (Number.isNaN(date.getTime())) return paidAt;
	const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
	let hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const suffix = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;
	return `${day}, ${hours}:${minutes} ${suffix}`;
}

export function daysLatePhrase(n: number): string {
	return n === 1 ? '1 day late' : `${n} days late`;
}

export function scheduledPillLabel(name: string, amount: string, state: PillVisualState, late = 0): string {
	if (state === 'paid') return `${name}, ${amount}, paid`;
	if (state === 'overdue') return `${name}, ${amount}, overdue ${daysLatePhrase(late)}`;
	if (state === 'due') return `${name}, ${amount}, due today`;
	return `${name}, ${amount}, scheduled`;
}

export function occurrenceSubtitle(
	date: string,
	repeatInterval: number | null | undefined,
	repeatUnit: RepeatUnit | null | undefined
): string {
	return `${formatWeekdayMonthDay(date)} · ${formatRepeat(repeatInterval, repeatUnit) ?? 'One time'}`;
}

export function paidHint(paid: boolean, paidAt: string | null): string {
	if (!paid) return 'This occurrence only';
	if (paidAt) return `Marked paid ${formatPaidStamp(paidAt)} · this occurrence only`;
	return 'Marked paid · this occurrence only';
}

export function detailPopoverPosition(
	rect: { top: number; bottom: number; left: number; width: number },
	viewport: { width: number; height: number } = { width: 1280, height: 800 },
	box: { width: number; height: number } = { width: 320, height: 260 }
): { top: number; left: number } {
	const gap = 6;
	const margin = 8;
	let left = rect.left;
	if (left + box.width > viewport.width - margin) left = viewport.width - box.width - margin;
	if (left < margin) left = margin;
	const spaceBelow = viewport.height - rect.bottom;
	const top =
		spaceBelow < box.height + gap ? Math.max(margin, rect.top - box.height - gap) : rect.bottom + gap;
	return { top, left };
}
