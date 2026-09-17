import { deleteTag, getTags, saveTag } from '$lib/server/finance';

export function load({ locals }) {
	return { tags: getTags(locals.user!.id) };
}

export const actions = {
	'save-tag': async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { error: 'Tag name is required.', source: 'save' as const };
		try {
			saveTag(locals.user!.id, id, name);
		} catch {
			return { error: 'This tag already exists.', source: 'save' as const };
		}
		return {
			ok: true,
			source: 'save' as const,
			message: id ? 'Tag updated.' : 'Tag added.'
		};
	},

	'delete-tag': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) {
			return { error: 'Tag not found.', source: 'delete' as const };
		}
		try {
			deleteTag(locals.user!.id, id);
		} catch (error) {
			return {
				error: (error as Error).message || 'Tag could not be deleted.',
				source: 'delete' as const
			};
		}
		return { ok: true, source: 'delete' as const, message: 'Tag deleted.' };
	}
};
