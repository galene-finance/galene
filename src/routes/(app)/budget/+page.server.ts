import {
	budgetPeriodSpend,
	deleteBudget,
	getBudgets,
	getCategories,
	resolveCategoryFromForm,
	saveBudget
} from '$lib/server/finance';
import { parseAmountToCents } from '$lib/utils';
import { productOwner } from '$lib/server/productAccess';
import { budgetDate,budgetFunding,budgetCommand } from '$lib/server/budgetIntegration';
import type { Budget } from '$lib/types';

export function load({locals,url}) {
 const userId=productOwner(locals.user);
 const selectedDate=budgetDate(url);
 const ref=new Date(`${selectedDate}T12:00:00Z`);
 const categories=getCategories(userId);
 const budgets=getBudgets(userId).map(b=>({...b,...budgetPeriodSpend(userId,b.category_id,b.period,ref)}));
 return {budgets,categories,selectedDate,...budgetFunding(userId,selectedDate)};
}

export const actions = {
 target: (event)=>budgetCommand('target',event),
 archiveTarget: (event)=>budgetCommand('target-archive',event),
 allocate: (event)=>budgetCommand('assign',event),
 refresh: (event)=>budgetCommand('refresh',event),
	save: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const period = String(form.get('period') ?? 'month');
		if (!['week', 'month', 'year'].includes(period)) return { error: 'Invalid period.' };
		const amount = parseAmountToCents(String(form.get('amount') ?? ''));
		if (amount === null || amount <= 0) return { error: 'Enter a valid, positive amount.' };

		const categoryId = resolveCategoryFromForm(userId, form, type);
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
