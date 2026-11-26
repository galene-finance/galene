/** Planning intent, not an envelope balance or projection of received cash. */
export type PlanningTarget = { id: number; category_id: number; period: string; limit_cents: number };
export type MonthlyPlanTotal = {
	totalCents: number | null;
	targetIds: number[];
	otherCadenceCount: number;
	excludedIncomeCount: number;
	needsReview: boolean;
};

export function monthlyPlanTotal(
	targets: readonly PlanningTarget[],
	categoryKinds: ReadonlyMap<number, string>
): MonthlyPlanTotal {
	const result: MonthlyPlanTotal = { totalCents: null, targetIds: [], otherCadenceCount: 0, excludedIncomeCount: 0, needsReview: false };
	let total = 0;
	for (const target of targets) {
		if (categoryKinds.get(target.category_id) === 'income') {
			result.excludedIncomeCount++;
			continue;
		}
		if (target.period !== 'month') {
			result.otherCadenceCount++;
			continue;
		}
		const kind = categoryKinds.get(target.category_id);
		if (!['expense', 'transfer'].includes(kind ?? '') ||
			!Number.isSafeInteger(target.limit_cents) || target.limit_cents < 0) {
			result.needsReview = true;
			continue;
		}
		if (result.targetIds.includes(target.id) || !Number.isSafeInteger(total + target.limit_cents)) {
			result.needsReview = true;
			continue;
		}
		total += target.limit_cents;
		result.targetIds.push(target.id);
	}
	result.totalCents = !result.needsReview && result.targetIds.length ? total : null;
	return result;
}
