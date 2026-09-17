import {
	backfillCategorizationRules,
	countUncategorized,
	deleteRule,
	getAccounts,
	getCategories,
	getOrCreateCategory,
	getRules,
	saveRule,
	setRuleEnabled
} from '$lib/server/finance';
import { parseAmountToCents } from '$lib/utils';
import type { RuleCondition, RuleField, RuleOp } from '$lib/types';

export function load({ locals }) {
	const userId = locals.user!.id;
	return {
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		rules: getRules(userId)
	};
}

export const actions = {
	'save-rule': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { error: 'Rule name is required.' };
		const type = form.get('type') === 'income' ? 'income' : 'expense';
		const categoryNew = String(form.get('category_new') ?? '').trim();
		const categoryExisting = String(form.get('category_id') ?? '').trim();
		let categoryId: number | null = null;
		if (categoryNew) {
			categoryId = getOrCreateCategory(userId, categoryNew, type);
		} else if (categoryExisting) {
			const category = getCategories(userId).find((c) => c.id === parseInt(categoryExisting, 10));
			if (category) categoryId = category.id;
		}
		if (categoryId === null) return { error: 'Select a category for this rule.' };

		const conditions: RuleCondition[] = [];
		for (let i = 0; ; i++) {
			const field = String(form.get(`cond_field_${i}`) ?? '');
			if (!field) break;
			if (!['merchant', 'amount', 'account'].includes(field)) return { error: 'Invalid condition field.' };
			const op = String(form.get(`cond_op_${i}`) ?? '') as RuleOp;
			const value = String(form.get(`cond_value_${i}`) ?? '').trim();
			if (field === 'amount') {
				const v = parseAmountToCents(value);
				if (v === null || v <= 0) return { error: `Condition ${i + 1} needs a valid amount.` };
				if (op === 'between') {
					const v2 = parseAmountToCents(String(form.get(`cond_value2_${i}`) ?? ''));
					if (v2 === null || v2 < v) {
						return { error: `Condition ${i + 1}: the max must be at least the min.` };
					}
					conditions.push({ field: field as RuleField, op, value: v, value2: v2 });
				} else {
					conditions.push({ field: field as RuleField, op, value: v });
				}
			} else {
				if (!value) return { error: `Condition ${i + 1} needs a value.` };
				conditions.push({ field: field as RuleField, op, value });
			}
		}
		if (conditions.length === 0) return { error: 'Add at least one condition.' };

		const ruleId = saveRule(userId, id, { name, conditions, categoryId });
		if (form.get('apply_existing') === '1') {
			const n = backfillCategorizationRules(userId, ruleId);
			return {
				message:
					n > 0
						? `Rule saved — applied to ${n} existing transaction${n === 1 ? '' : 's'}.`
						: 'Rule saved — no uncategorized transactions matched.'
			};
		}
		return { ok: true };
	},

	'apply-existing': async ({ locals }) => {
		const userId = locals.user!.id;
		if (getRules(userId).every((r) => r.enabled !== 1)) return { message: 'No enabled rules to apply.' };
		const total = countUncategorized(userId);
		if (total === 0) return { message: 'No uncategorized transactions.' };
		const n = backfillCategorizationRules(userId);
		return { message: `Categorized ${n} of ${total} uncategorized transaction${total === 1 ? '' : 's'}.` };
	},

	'delete-rule': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteRule(locals.user!.id, id);
		return { ok: true };
	},

	'toggle-rule': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) setRuleEnabled(locals.user!.id, id, form.get('enabled') === '1');
		return { ok: true };
	}
};
