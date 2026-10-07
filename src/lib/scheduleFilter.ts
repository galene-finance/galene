/** Schedule list scope: upcoming (default) vs all series. */

export type ScheduleListFilter = 'upcoming' | 'all';

export const SCHEDULE_FILTER_STORAGE_KEY = 'galene.schedule.listFilter';

/** True when next occurrence is today or later (ISO YYYY-MM-DD, local calendar day). */
export function isUpcomingNextDate(nextDate: string | null, today: string): boolean {
	return nextDate != null && nextDate >= today;
}

export function filterScheduleRows<T extends { nextDate: string | null }>(
	rows: T[],
	filter: ScheduleListFilter,
	today: string
): T[] {
	if (filter === 'all') return rows;
	return rows.filter((row) => isUpcomingNextDate(row.nextDate, today));
}

export function parseScheduleListFilter(raw: string | null | undefined): ScheduleListFilter | null {
	if (raw === 'upcoming' || raw === 'all') return raw;
	return null;
}
