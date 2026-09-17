import { redirect } from '@sveltejs/kit';
import { dataCounts, deleteAllData, deleteDataType, getDataType } from '$lib/server/data';
import type { User } from '$lib/types';

export function load({ locals, depends }) {
	depends('user');
	depends('settings');
	if (!locals.user) redirect(303, '/login');
	return {
		user: { name: locals.user.name, email: locals.user.email },
		counts: dataCounts(locals.user.id)
	};
}

/**
 * A deletion only goes through when the user types their own username
 * (the account's display name) into the confirmation field.
 */
function confirmError(user: User, raw: string): string | null {
	const input = (raw ?? '').trim();
	if (input !== user.name) {
		return `Type your username exactly — "${user.name}" — to confirm.`;
	}
	return null;
}

export const actions = {
	delete: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const type = getDataType(String(form.get('type') ?? ''));
		if (!type) return { error: 'Unknown data type.' };
		const err = confirmError(user, String(form.get('confirm') ?? ''));
		if (err) return { error: err };
		deleteDataType(user.id, type.key);
		return { ok: true, message: `${type.label} deleted.` };
	},

	'delete-all': async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const err = confirmError(user, String(form.get('confirm') ?? ''));
		if (err) return { error: err };
		deleteAllData(user.id);
		return { ok: true, message: 'All your data has been deleted.' };
	}
};
