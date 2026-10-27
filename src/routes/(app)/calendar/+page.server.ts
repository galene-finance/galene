import { fail } from '@sveltejs/kit';
import {
	deleteScheduledScoped,
	getAccounts,
	getCategories,
	expandScheduled,
	getScheduled,
	monthBounds,
	getSetting,
	getTags,
	getTransactionsInPeriod,
	saveScheduled,
	saveTransaction,
	setSetting,
	scheduledDeleteFromForm,
	scheduledInputFromForm,
	transactionInputFromForm
} from '$lib/server/finance';

export function load({ locals, url }) {
	const userId = locals.user!.id;
	const now = new Date();
	const monthParam = url.searchParams.get('month') ?? '';
	const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
		? monthParam
		: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const { from, to } = monthBounds(month);

	const transactions = getTransactionsInPeriod(userId, from, to);
	const scheduled = getScheduled(userId);
	const occurrences = scheduled.flatMap((s) => expandScheduled(s, from, to));
	const hideActuals = getSetting(userId, 'hide_actuals') === '1';
	const weekStartsOn = getSetting(userId, 'week_starts_on') === 'monday' ? 'monday' : 'sunday';

	return {
		month,
		transactions,
		occurrences,
		hideActuals,
		weekStartsOn,
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId)
	};
}

export const actions = {
	save: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const { input, error } = transactionInputFromForm(userId, form);
		if (error || !input) return { error };
		saveTransaction(userId, input);
		return { ok: true };
	},

	'save-scheduled': async ({ request, locals }) => {
		const { input, error } = scheduledInputFromForm(locals.user!.id, await request.formData());
		if (error || !input) return { error };
		try {
			const id = saveScheduled(locals.user!.id, input);
			return { ok: true, id };
		} catch (e) {
			return { error: e instanceof Error ? e.message : 'Could not save.' };
		}
	},

	'delete-scheduled': async ({ request, locals }) => {
		const form = await request.formData();
		const parsed = scheduledDeleteFromForm(locals.user!.id, form);
		if (parsed.error || parsed.id == null || !parsed.scope) return fail(400, { error: parsed.error ?? 'Choose what to delete.' });
		try {
			const result = deleteScheduledScoped(locals.user!.id, parsed.id, parsed.scope, parsed.occurrenceDate);
			return { ok: true, removed: result.removed };
		} catch (error) {
			return fail(400, { error: error instanceof Error ? error.message : 'Could not delete.' });
		}
	},

	'set-hide-actuals': async ({ request, locals }) => {
		const form = await request.formData();
		setSetting(locals.user!.id, 'hide_actuals', form.get('hide_actuals') === 'on' ? '1' : '0');
		return { ok: true };
	}
};
