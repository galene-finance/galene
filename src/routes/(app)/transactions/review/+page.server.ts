import { fail } from '@sveltejs/kit';
import { listOpenSyncReviews, resolveSyncReview } from '$lib/server/sync';

export function load({ locals }) {
	const userId = locals.user!.id;
	if (locals.user?.role === 'viewer') {
		return { items: [], viewer: true };
	}
	return { items: listOpenSyncReviews(userId), viewer: false };
}

export const actions = {
	keep: async ({ request, locals }) => {
		if (locals.user?.role === 'viewer') return fail(403, { error: 'Viewers cannot resolve reviews.' });
		const form = await request.formData();
		const id = Number(form.get('id'));
		const result = resolveSyncReview(locals.user!.id, id, 'keep');
		if ('error' in result) return fail(400, { error: result.error });
		return { ok: true, message: 'Kept both transactions.' };
	},
	dismiss: async ({ request, locals }) => {
		if (locals.user?.role === 'viewer') return fail(403, { error: 'Viewers cannot resolve reviews.' });
		const form = await request.formData();
		const id = Number(form.get('id'));
		const result = resolveSyncReview(locals.user!.id, id, 'dismiss');
		if ('error' in result) return fail(400, { error: result.error });
		return { ok: true, message: 'Dismissed.' };
	},
	fold: async ({ request, locals }) => {
		if (locals.user?.role === 'viewer') return fail(403, { error: 'Viewers cannot resolve reviews.' });
		const form = await request.formData();
		const id = Number(form.get('id'));
		const foldInto = Number(form.get('fold_into'));
		const result = resolveSyncReview(locals.user!.id, id, 'fold', foldInto);
		if ('error' in result) return fail(400, { error: result.error });
		return { ok: true, message: 'Folded into the selected transaction.' };
	}
};
