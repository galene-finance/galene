import { describe, expect, test } from 'bun:test';
import {
	filterScheduleRows,
	isUpcomingNextDate,
	parseScheduleListFilter
} from './scheduleFilter';

describe('isUpcomingNextDate', () => {
	test('today and future count as upcoming', () => {
		expect(isUpcomingNextDate('2026-10-07', '2026-10-07')).toBe(true);
		expect(isUpcomingNextDate('2026-10-08', '2026-10-07')).toBe(true);
	});

	test('past dates and null are not upcoming', () => {
		expect(isUpcomingNextDate('2026-10-06', '2026-10-07')).toBe(false);
		expect(isUpcomingNextDate(null, '2026-10-07')).toBe(false);
	});
});

describe('filterScheduleRows', () => {
	const rows = [
		{ id: 1, nextDate: '2026-10-06' },
		{ id: 2, nextDate: '2026-10-07' },
		{ id: 3, nextDate: '2026-11-01' },
		{ id: 4, nextDate: null }
	];

	test('upcoming keeps today+ only', () => {
		expect(filterScheduleRows(rows, 'upcoming', '2026-10-07').map((r) => r.id)).toEqual([2, 3]);
	});

	test('all returns every row', () => {
		expect(filterScheduleRows(rows, 'all', '2026-10-07')).toEqual(rows);
	});
});

describe('parseScheduleListFilter', () => {
	test('accepts upcoming and all', () => {
		expect(parseScheduleListFilter('upcoming')).toBe('upcoming');
		expect(parseScheduleListFilter('all')).toBe('all');
	});

	test('rejects unknown values', () => {
		expect(parseScheduleListFilter(null)).toBe(null);
		expect(parseScheduleListFilter('')).toBe(null);
		expect(parseScheduleListFilter('ended')).toBe(null);
	});
});
