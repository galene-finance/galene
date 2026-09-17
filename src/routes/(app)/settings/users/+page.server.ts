import { redirect } from '@sveltejs/kit';
import { createUser, deleteUser, getUserRow, listUsers, resetPassword, setUserAdmin } from '$lib/server/users';

export function load({ locals }) {
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) redirect(303, '/settings');
	return { users: listUsers(), me: locals.user.id };
}

/** Every action on this page is admin-only. */
function requireAdmin(locals: App.Locals) {
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) redirect(303, '/settings');
}

export const actions = {
	create: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		const result = createUser({
			name,
			email,
			password,
			isAdmin: form.get('is_admin') != null,
			demoData: form.get('demo_data') != null
		});
		if (!result.ok) return { error: result.error, source: 'create', name, email };
		return { ok: true, source: 'create', message: `Created ${name}'s account.` };
	},

	'toggle-admin': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const makeAdmin = form.get('make_admin') === '1';
		const result = setUserAdmin(locals.user!.id, id, makeAdmin);
		if (!result.ok) return { error: result.error, source: 'toggle' };
		return { ok: true, source: 'toggle' };
	},

	delete: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const target = getUserRow(id);
		if (!target) return { error: 'User not found.', source: 'delete' };
		if (String(form.get('confirm') ?? '').trim() !== target.name) {
			return { error: `Type the user's name exactly — "${target.name}" — to confirm.`, source: 'delete' };
		}
		const result = deleteUser(locals.user!.id, id);
		if (!result.ok) return { error: result.error, source: 'delete' };
		return { ok: true, source: 'delete', message: `Deleted ${target.name}'s account and all of its data.` };
	},

	'reset-password': async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const target = getUserRow(id);
		if (!target) return { error: 'User not found.', source: 'reset' };
		const result = resetPassword(locals.user!.id, id, String(form.get('password') ?? ''));
		if (!result.ok) return { error: result.error, source: 'reset' };
		return { ok: true, source: 'reset', message: `Updated ${target.name}'s password.` };
	}
};
