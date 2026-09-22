import { describe, expect, test } from 'bun:test';
import {
	budgetLabelAnchor,
	budgetLinePoints,
	budgetPolyline,
	inclusiveEnd,
	mondayOnOrBefore
} from './trendsChart';

describe('budget line', () => {
	test('connects each bar center and skips a missing budget', () => {
		const points = [{ budgetCents: 100 }, { budgetCents: null }, { budgetCents: 250 }];
		const verts = budgetLinePoints(
			points,
			(i) => i * 10 + 5,
			(cents) => cents
		);
		expect(verts).toEqual([
			{ x: 5, y: 100 },
			{ x: 25, y: 250 }
		]);
		expect(budgetPolyline(verts)).toBe('5,100 25,250');
	});

	test('one point is still a point on that bar', () => {
		const verts = budgetLinePoints([{ budgetCents: 40 }], () => 12, (c) => c);
		expect(verts).toEqual([{ x: 12, y: 40 }]);
	});
});

describe('budget label', () => {
	test('sits above the line with a leader down to it', () => {
		const a = budgetLabelAnchor(80, 16, 288);
		expect(a.labelY).toBe(64);
		expect(a.leaderY2).toBe(80);
		expect(a.leaderY1).toBeLessThan(a.leaderY2);
	});

	test('drops below when above would leave the plot', () => {
		const a = budgetLabelAnchor(20, 16, 288);
		expect(a.labelY).toBe(36);
		expect(a.leaderY1).toBe(32);
		expect(a.leaderY2).toBe(20);
	});
});

describe('bar dates', () => {
	test('inclusive end is the day before the exclusive bound', () => {
		expect(inclusiveEnd('2026-02-01')).toBe('2026-01-31');
		expect(inclusiveEnd('2026-03-02')).toBe('2026-03-01');
	});

	test('weeks start on Monday', () => {
		const wed = new Date(2026, 0, 7);
		expect(mondayOnOrBefore(wed).getDate()).toBe(5);
	});
});
