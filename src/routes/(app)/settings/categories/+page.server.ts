import { deleteCategory, getCategories, saveCategory } from '$lib/server/finance';
import type { CategoryType } from '$lib/types';
import { CATEGORY_TYPES } from '$lib/types';

function parseCategoryType(value: FormDataEntryValue | null): CategoryType {
	const v = String(value ?? '');
	if ((CATEGORY_TYPES as string[]).includes(v)) return v as CategoryType;
	return 'expense';
}

export function load({ locals }) {
	return { categories: getCategories(locals.user!.id) };
}

export const actions = {
	'save-category': async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const name = String(form.get('name') ?? '').trim();
		const type = parseCategoryType(form.get('type'));
		const parent = form.get('parent') ? parseInt(String(form.get('parent')), 10) : null;
		const color = String(form.get('color') ?? '').trim() || null;
		if (!name) return { error: 'Category name is required.', source: 'save' as const };
		try {
			saveCategory(locals.user!.id, id, { name, type, parent_id: parent, color });
		} catch {
			return {
				error: 'A category with this name already exists for that type.',
				source: 'save' as const
			};
		}
		return {
			ok: true,
			source: 'save' as const,
			message: id ? 'Category updated.' : 'Category added.'
		};
	},

	'delete-category': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) {
			return { error: 'Category not found.', source: 'delete' as const };
		}
		const raw = String(form.get('reassign_to') ?? '').trim();
		let reassignTo: number | null = null;
		if (raw && raw !== 'none') {
			const n = parseInt(raw, 10);
			if (!Number.isFinite(n)) {
				return { error: 'Choose where to move transactions.', source: 'delete' as const };
			}
			reassignTo = n;
		}
		try {
			deleteCategory(locals.user!.id, id, reassignTo);
		} catch (error) {
			return {
				error: (error as Error).message || 'Category could not be deleted.',
				source: 'delete' as const
			};
		}
		return { ok: true, source: 'delete' as const, message: 'Category deleted.' };
	}
};
