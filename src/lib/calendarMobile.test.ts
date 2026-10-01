import { describe, expect, test } from 'bun:test';
import {
	addDaysIso,
	dayCardDateLabel,
	dayTotalLabel,
	defaultSelectedIso,
	dowShort,
	otherWeekDaysWithActivity,
	parseMobileView,
	softFill,
	weekContaining
} from './calendarMobile';

describe('weekContaining', () => {
	test('sunday start: Oct 6 2026 week is Sun 4 – Sat 10', () => {
		expect(weekContaining('2026-10-06', 'sunday')).toEqual([
			'2026-10-04',
			'2026-10-05',
			'2026-10-06',
			'2026-10-07',
			'2026-10-08',
			'2026-10-09',
			'2026-10-10'
		]);
	});

	test('monday start: Oct 6 2026 week is Mon 5 – Sun 11', () => {
		expect(weekContaining('2026-10-06', 'monday')).toEqual([
			'2026-10-05',
			'2026-10-06',
			'2026-10-07',
			'2026-10-08',
			'2026-10-09',
			'2026-10-10',
			'2026-10-11'
		]);
	});
});

describe('day labels', () => {
	test('dowShort and dayCardDateLabel', () => {
		expect(dowShort('2026-10-06')).toBe('Tue');
		expect(dayCardDateLabel('2026-10-06')).toBe('Tuesday 6');
	});
});

describe('defaultSelectedIso', () => {
	test('prefers today when in month', () => {
		expect(defaultSelectedIso('2026-10', '2026-10-06')).toBe('2026-10-06');
	});
	test('falls back to 1st when today outside month', () => {
		expect(defaultSelectedIso('2026-09', '2026-10-06')).toBe('2026-09-01');
	});
});

describe('dayTotalLabel', () => {
	test('booked only', () => {
		expect(dayTotalLabel(815, 0, false)).toBe('$8.15');
	});
	test('booked + sched', () => {
		expect(dayTotalLabel(815, 1, false)).toBe('$8.15 + sched');
	});
	test('sched only', () => {
		expect(dayTotalLabel(0, 2, false)).toBe('Scheduled');
	});
	test('empty', () => {
		expect(dayTotalLabel(0, 0, false)).toBe('—');
	});
	test('hide actuals with sched', () => {
		expect(dayTotalLabel(500, 1, true)).toBe('Scheduled');
	});
});

describe('otherWeekDaysWithActivity', () => {
	test('omits selected and empty days', () => {
		const week = [
			{ iso: '2026-10-04', day: 4, inMonth: true, transactions: [{ amount_cents: 100 }], occurrences: [] },
			{ iso: '2026-10-05', day: 5, inMonth: true, transactions: [], occurrences: [] },
			{
				iso: '2026-10-06',
				day: 6,
				inMonth: true,
				transactions: [{ amount_cents: 50 }],
				occurrences: [{ scheduled: { color: '#8b5cf6' } }]
			},
			{
				iso: '2026-10-07',
				day: 7,
				inMonth: true,
				transactions: [],
				occurrences: [{ scheduled: { color: null } }]
			}
		];
		const other = otherWeekDaysWithActivity(week, '2026-10-06', false);
		expect(other.map((c) => c.iso)).toEqual(['2026-10-04', '2026-10-07']);
	});
});

describe('misc', () => {
	test('addDaysIso crosses months', () => {
		expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
	});
	test('parseMobileView', () => {
		expect(parseMobileView('stack')).toBe('stack');
		expect(parseMobileView('month')).toBe('month');
		expect(parseMobileView('nope')).toBeNull();
	});
	test('softFill', () => {
		expect(softFill('#8b5cf6')).toBe('#8b5cf61a');
		expect(softFill('bad')).toBeUndefined();
	});
});
