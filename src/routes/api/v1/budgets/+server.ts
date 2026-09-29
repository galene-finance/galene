import { apiUser, json, unauthorized } from '$lib/server/api';
import { budgetPeriodSpend, getBudgets } from '$lib/server/finance';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	const budgets = getBudgets(user.id).map((b) => {
		const { from, to, spentCents } = budgetPeriodSpend(user.id, b.category_id, b.period);
		return { ...b, spent_cents: spentCents, period_from: from, period_to: to };
	});
	return json(200, { budgets });
}
