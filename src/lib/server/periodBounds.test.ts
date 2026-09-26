import { describe, expect, test } from 'bun:test';
import { periodLabel } from '$lib/utils';
import { currentPeriodBounds } from './finance';

/** Local calendar date so getFullYear/getMonth/getDate/getDay match the function. */
function localDate(y: number, m: number, d: number): Date {
	return new Date(y, m - 1, d);
}

describe('currentPeriodBounds week', () => {
	test('Saturday is the Monday–Sunday week containing that day', () => {
		const ref = localDate(2026, 9, 26);
		const bounds = currentPeriodBounds('week', ref);
		expect(bounds).toEqual({ from: '2026-09-21', to: '2026-09-28' });
		expect(periodLabel('week', bounds.from, bounds.to)).toBe('Sep 21 – Sep 27, 2026');
	});

	test('Tuesday is the Monday–Sunday week containing that day', () => {
		expect(currentPeriodBounds('week', localDate(2026, 9, 15))).toEqual({
			from: '2026-09-14',
			to: '2026-09-21'
		});
	});
});

describe('currentPeriodBounds month and year', () => {
	test('month and year ignore weekday and stay calendar periods', () => {
		for (const ref of [localDate(2026, 9, 26), localDate(2026, 9, 15)]) {
			expect(currentPeriodBounds('month', ref)).toEqual({ from: '2026-09-01', to: '2026-10-01' });
			expect(currentPeriodBounds('year', ref)).toEqual({ from: '2026-01-01', to: '2027-01-01' });
		}
	});
});
