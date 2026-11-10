import { attachPaidState, countOverdueInMonth } from '$lib/scheduledPaid';
import { deleteScheduledAction } from '$lib/server/scheduledDeleteAction';
import { paidAtByScheduled, setPaidAction } from '$lib/server/scheduledPaid';
import {
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
	scheduledInputFromForm,
	transactionInputFromForm
} from '$lib/server/finance';
import { todayISO } from '$lib/utils';

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
	const today = todayISO();
	const paidAt = paidAtByScheduled(
		userId,
		scheduled.map((series) => series.id)
	);
	const occurrences = attachPaidState(
		scheduled.flatMap((series) => expandScheduled(series, from, to)),
		paidAt,
		today
	);
	const overdueCount = countOverdueInMonth(occurrences, today, month);
	const hideActuals = getSetting(userId, 'hide_actuals') === '1';
	const weekStartsOn = getSetting(userId, 'week_starts_on') === 'monday' ? 'monday' : 'sunday';

	return {
		month,
		transactions,
		occurrences,
		overdueCount,
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

	'delete-scheduled': deleteScheduledAction,

	'set-paid': setPaidAction,

	'set-hide-actuals': async ({ request, locals }) => {
		const form = await request.formData();
		setSetting(locals.user!.id, 'hide_actuals', form.get('hide_actuals') === 'on' ? '1' : '0');
		return { ok: true };
	}
};
