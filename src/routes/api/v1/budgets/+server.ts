import { apiUser, json, unauthorized } from '$lib/server/api';
import { categoryAmountInPeriod, currentPeriodBounds, getBudgets, getCategories } from '$lib/server/finance';

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	const categories = getCategories(user.id);
	const budgets = getBudgets(user.id).map((b) => {
		const cat = categories.find((c) => c.id === b.category_id);
		const { from, to } = currentPeriodBounds(b.period);
		const signed = categoryAmountInPeriod(user.id, b.category_id, from, to);
		const spent = Math.max(0, -signed); // #17: refunds reduce used
		return { ...b, spent_cents: Math.max(0, Math.round(spent)), period_from: from, period_to: to };
	});
	return json(200, { budgets });
}
