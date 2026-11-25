import { describe, expect, test } from 'bun:test';
import { monthlyPlanTotal } from './monthlyPlan';

const kinds = new Map([[1, 'expense'], [2, 'transfer'], [3, 'income']]);

describe('current monthly planning total (synthetic data)', () => {
	test('counts monthly outgoing targets, not wages or other cadences', () => {
		const result = monthlyPlanTotal([
			{ id: 1, category_id: 1, period: 'month', limit_cents: 10000 },
			{ id: 2, category_id: 2, period: 'month', limit_cents: 2500 },
			{ id: 3, category_id: 3, period: 'month', limit_cents: 90000 },
			{ id: 4, category_id: 1, period: 'week', limit_cents: 5000 }
		], kinds);
		expect(result.totalCents).toBe(12500);
		expect(result.targetIds).toEqual([1, 2]);
		expect(result.otherCadenceCount).toBe(1);
		expect(result.excludedIncomeCount).toBe(1);
		expect(result.needsReview).toBe(false);
	});

	test.each([
		[{ id: 1, category_id: 1, period: 'month', limit_cents: 10000 }, { id: 1, category_id: 1, period: 'month', limit_cents: 10000 }],
		[{ id: 1, category_id: 1, period: 'month', limit_cents: Number.MAX_SAFE_INTEGER }, { id: 2, category_id: 1, period: 'month', limit_cents: 1 }]
	])('rejects an ambiguous or unsafe aggregate: %j', (first, second) => {
		const result = monthlyPlanTotal([first, second], kinds);
		expect(result.totalCents).toBeNull();
		expect(result.needsReview).toBe(true);
	});

	test('does not invent category kinds outside the native schema', () => {
		const result = monthlyPlanTotal([{ id: 1, category_id: 1, period: 'month', limit_cents: 10000 }], new Map([[1, 'credit_card_payment']]));
		expect(result.totalCents).toBeNull();
		expect(result.needsReview).toBe(true);
	});

	test('does not fabricate a total from invalid target data', () => {
		for (const target of [
			{ id: 1, category_id: 99, period: 'month', limit_cents: 10000 },
			{ id: 1, category_id: 1, period: 'month', limit_cents: -1 },
			{ id: 1, category_id: 1, period: 'month', limit_cents: 1.5 },
			{ id: 1, category_id: 1, period: 'month', limit_cents: Number.NaN }
		]) {
			const result = monthlyPlanTotal([target], kinds);
			expect(result.totalCents).toBeNull();
			expect(result.needsReview).toBe(true);
		}
	});
});
