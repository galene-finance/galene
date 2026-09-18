import {
	categoryAmountInPeriod,
	currentPeriodBounds,
	deleteBudget,
	getBudgets,
	getCategories,
	getOrCreateCategory,
	saveBudget
} from '$lib/server/finance';
import { parseAmountToCents } from '$lib/utils';
import type { Budget } from '$lib/types';

export function load({ locals }) {
	const userId = locals.user!.id;
	const categories = getCategories(userId);
	const budgets = getBudgets(userId).map((b) => {
		const cat = categories.find((c) => c.id === b.category_id);
		const { from, to } = currentPeriodBounds(b.period);
		const signed = categoryAmountInPeriod(userId, b.category_id, from, to);
		const spent = Math.max(0, -signed); // #17: refunds reduce used
		return { ...b, spentCents: Math.max(0, Math.round(spent)), from, to };
	});
	return {
		budgets,
		categories
	};
}

export const actions = {
	save: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const period = String(form.get('period') ?? 'month');
		if (!['week', 'month', 'year'].includes(period)) return { error: 'Invalid period.' };
		const amount = parseAmountToCents(String(form.get('amount') ?? ''));
		if (amount === null || amount <= 0) return { error: 'Enter a valid, positive amount.' };

		const categoryNew = String(form.get('category_new') ?? '').trim();
		const categoryExisting = String(form.get('category_id') ?? '').trim();
		let categoryId: number | null = null;
		if (categoryNew) {
			categoryId = getOrCreateCategory(userId, categoryNew, type);
		} else if (categoryExisting) {
			const category = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
			if (category) categoryId = category.id;
		}
		if (categoryId === null) return { error: 'Select a category.' };
		const cat = getCategories(userId).find((c) => c.id === categoryId);
		if (cat?.type === 'transfer') {
			return { error: 'Transfer categories are excluded from budgets by default.' };
		}

		saveBudget(userId, id, { categoryId, period: period as Budget['period'], limitCents: amount });
		return { ok: true };
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteBudget(locals.user!.id, id);
		return { ok: true };
	}
};
