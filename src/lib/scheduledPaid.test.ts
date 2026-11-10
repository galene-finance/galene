import { describe, expect, test } from 'bun:test';
import { addDaysIso } from './calendarMobile';
import {
	attachPaidState,
	compareScheduleCards,
	countOverdueInMonth,
	daysLate,
	detailPopoverPosition,
	formatPaidStamp,
	isOverdue,
	paidHint,
	pillState,
	scheduleListBounds,
	scheduledPillLabel,
	selectScheduleFocus
} from './scheduledPaid';

const today = '2026-11-10';

describe('isOverdue', () => {
	test('exactly 30 days back is overdue', () => {
		const date = addDaysIso(today, -30);
		expect(date).toBe('2026-10-11');
		expect(isOverdue(date, false, today)).toBe(true);
		expect(daysLate(date, today)).toBe(30);
	});

	test('31 days back is not overdue', () => {
		const date = addDaysIso(today, -31);
		expect(isOverdue(date, false, today)).toBe(false);
	});

	test('today is not overdue', () => {
		expect(isOverdue(today, false, today)).toBe(false);
	});

	test('a future date is not overdue', () => {
		expect(isOverdue(addDaysIso(today, 1), false, today)).toBe(false);
	});

	test('a paid past date inside the window is not overdue', () => {
		expect(isOverdue(addDaysIso(today, -5), true, today)).toBe(false);
	});

	test('yesterday unpaid is overdue', () => {
		expect(isOverdue(addDaysIso(today, -1), false, today)).toBe(true);
		expect(daysLate(addDaysIso(today, -1), today)).toBe(1);
	});
});

describe('selectScheduleFocus', () => {
	const row = (
		date: string,
		paid = false,
		paidAt: string | null = null,
		occurrenceDate = date
	) => ({ date, occurrenceDate, paid, paidAt });

	test('picks the oldest unpaid date inside the window', () => {
		const focus = selectScheduleFocus(
			[
				row('2026-11-08'),
				row('2026-11-02'),
				row('2026-11-16'),
				row('2026-10-01')
			],
			today
		);
		expect(focus).toEqual({
			kind: 'overdue',
			date: '2026-11-02',
			occurrenceDate: '2026-11-02',
			daysLate: 8
		});
	});

	test('ignores a paid past date and a date 31 days back', () => {
		const focus = selectScheduleFocus(
			[row('2026-10-10'), row('2026-11-01', true, '2026-11-01T14:00:00.000Z'), row('2026-11-16')],
			today
		);
		expect(focus.kind).toBe('upcoming');
		if (focus.kind === 'upcoming') expect(focus.date).toBe('2026-11-16');
	});

	test('uses the next occurrence when nothing in the window is unpaid', () => {
		expect(selectScheduleFocus([row(today)], today)).toEqual({
			kind: 'due',
			date: today,
			occurrenceDate: today
		});
		expect(selectScheduleFocus([row(today, true, '2026-11-10T15:00:00.000Z')], today).kind).toBe('paid');
		expect(selectScheduleFocus([row('2026-11-20')], today).kind).toBe('upcoming');
		expect(selectScheduleFocus([row('2026-11-20', true, '2026-11-09T15:00:00.000Z')], today)).toMatchObject({
			kind: 'paid',
			date: '2026-11-20',
			paidAt: '2026-11-09T15:00:00.000Z'
		});
	});

	test('returns none when the series has no occurrence to show', () => {
		expect(selectScheduleFocus([row('2026-09-01')], today)).toEqual({ kind: 'none' });
		expect(selectScheduleFocus([], today)).toEqual({ kind: 'none' });
	});

	test('a paid one-time in the past, with no upcoming date, stays paid', () => {
		expect(selectScheduleFocus([row('2026-09-01', true, '2026-09-02T12:00:00.000Z')], today)).toEqual({
			kind: 'paid',
			date: '2026-09-01',
			occurrenceDate: '2026-09-01',
			paidAt: '2026-09-02T12:00:00.000Z',
			matched: false
		});
	});

	test('a matched past occurrence is paid focus', () => {
		expect(
			selectScheduleFocus(
				[{ date: '2026-11-01', occurrenceDate: '2026-11-01', paid: true, paidAt: null, matched: true }],
				today
			)
		).toMatchObject({ kind: 'paid', date: '2026-11-01', matched: true });
	});

	test('judges a moved occurrence by its display date', () => {
		const focus = selectScheduleFocus(
			[row('2026-11-07', false, null, '2026-11-05'), row('2026-12-05', false, null, '2026-12-05')],
			today
		);
		expect(focus).toMatchObject({ kind: 'overdue', date: '2026-11-07', occurrenceDate: '2026-11-05', daysLate: 3 });
	});
});

describe('attachPaidState and month count', () => {
	test('attaches paid by identity and overdue by display date', () => {
		const paid = new Map([['4|2026-11-05', '2026-11-06T14:12:00.000Z']]);
		const rows = attachPaidState(
			[
				{
					date: '2026-11-07',
					occurrenceDate: '2026-11-05',
					scheduled: { id: 4 }
				},
				{
					date: '2026-11-09',
					occurrenceDate: '2026-11-09',
					scheduled: { id: 4 }
				}
			],
			paid,
			today
		);
		expect(rows[0]).toMatchObject({ paid: true, overdue: false, paidAt: '2026-11-06T14:12:00.000Z', matched: false });
		expect(rows[1]).toMatchObject({ paid: false, overdue: true, daysLate: 1, matched: false });
		const matched = attachPaidState(
			[{ date: '2026-11-09', occurrenceDate: '2026-11-09', scheduled: { id: 4 } }],
			new Map(),
			today,
			new Map([
				[
					'4|2026-11-09',
					{
						transactionId: 9,
						matchedAt: '2026-11-09T12:00:00.000Z',
						date: '2026-11-09',
						amountCents: -100,
						merchant: 'Rent',
						accountId: 1,
						accountName: 'Checking'
					}
				]
			])
		);
		expect(matched[0]).toMatchObject({ paid: true, paidAt: null, overdue: false, matched: true });
		expect(countOverdueInMonth(rows, today, '2026-11')).toBe(1);
		expect(countOverdueInMonth(rows, today, '2026-10')).toBe(0);
	});
});

describe('pill copy', () => {
	test('state never drops the text label', () => {
		expect(pillState({ paid: true, overdue: false, date: '2026-11-01' }, today)).toBe('paid');
		expect(pillState({ paid: false, overdue: true, date: '2026-11-05' }, today)).toBe('overdue');
		expect(pillState({ paid: false, overdue: false, date: today }, today)).toBe('due');
		expect(paidHint(false, null)).toBe('This occurrence only');
		expect(paidHint(true, null, true)).toBe('Matched to a transaction. Unmatch first.');
		expect(scheduledPillLabel('Rent', '$100.00', 'paid', 0, true)).toContain('matched to a transaction');
		expect(paidHint(true, '2026-11-01T14:12:00.000Z')).toContain('Marked paid');
		expect(paidHint(true, '2026-11-01T14:12:00.000Z')).toContain('this occurrence only');
		expect(formatPaidStamp('not-a-date')).toBe('not-a-date');
	});

	test('popover stays inside the viewport', () => {
		const below = detailPopoverPosition(
			{ top: 40, bottom: 60, left: 20, width: 80 },
			{ width: 800, height: 600 }
		);
		expect(below.top).toBe(66);
		const flipped = detailPopoverPosition(
			{ top: 500, bottom: 540, left: 700, width: 80 },
			{ width: 800, height: 600 }
		);
		expect(flipped.left).toBeLessThanOrEqual(800 - 320 - 8);
		expect(flipped.top).toBeLessThan(500);
	});
});

describe('schedule list order', () => {
	test('the list range includes a one-time start older than the overdue window', () => {
		expect(scheduleListBounds('2026-09-01', today).from).toBe('2026-09-01');
		expect(scheduleListBounds('2026-11-01', today).from).toBe('2026-10-11');
	});

	test('overdue cards sort first, oldest overdue date first', () => {
		const overdue = (
			date: string,
			name: string
		): {
			nextDate: string | null;
			focus: { kind: 'overdue'; date: string; occurrenceDate: string; daysLate: number };
			scheduled: { name: string };
		} => ({
			nextDate: '2026-12-01',
			focus: { kind: 'overdue', date, occurrenceDate: date, daysLate: 1 },
			scheduled: { name }
		});
		const upcoming = {
			nextDate: '2026-11-12',
			focus: { kind: 'upcoming' as const, date: '2026-11-12', occurrenceDate: '2026-11-12' },
			scheduled: { name: 'Internet' }
		};
		const older = overdue('2026-10-20', 'Zed');
		const newer = overdue('2026-11-01', 'Aaa');
		expect(compareScheduleCards(older, upcoming)).toBeLessThan(0);
		expect(compareScheduleCards(upcoming, newer)).toBeGreaterThan(0);
		expect(compareScheduleCards(older, newer)).toBeLessThan(0);
	});
});
