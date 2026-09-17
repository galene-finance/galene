import { fail, redirect } from '@sveltejs/kit';
import {
	detectRecurringSuggestions,
	dismissRecurringSuggestion
} from '$lib/server/recurringDetect';
import {
	getAccounts,
	getCategories,
	getTags,
	saveScheduled,
	scheduledInputFromForm
} from '$lib/server/finance';

export function load({ locals }) {
	if (!locals.user) redirect(303, '/login');
	return {
		suggestions: detectRecurringSuggestions(locals.user.id),
		accounts: getAccounts(locals.user.id),
		categories: getCategories(locals.user.id),
		tags: getTags(locals.user.id)
	};
}

export const actions = {
	dismiss: async ({ request, locals }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '').trim();
		if (!key) return fail(400, { error: 'Missing suggestion key.' });
		dismissRecurringSuggestion(locals.user!.id, key);
		return { ok: true, message: 'Suggestion dismissed.' };
	},

	'save-scheduled': async ({ request, locals }) => {
		const form = await request.formData();
		const dismissKey = String(form.get('dismiss_key') ?? '').trim();
		const { input, error } = scheduledInputFromForm(locals.user!.id, form);
		if (error || !input) return fail(400, { error: error ?? 'Could not save.' });
		input.forecastBehavior = 'bill';
		saveScheduled(locals.user!.id, input);
		if (dismissKey) dismissRecurringSuggestion(locals.user!.id, dismissKey);
		return { ok: true, message: 'Scheduled expectation added.' };
	}
};
