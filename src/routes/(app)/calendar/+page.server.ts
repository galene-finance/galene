import {
	deleteScheduled,
	getAccounts,
	getCategories,
	getOccurrences,
	getScheduled,
	getSetting,
	getTags,
	getTransactionsInPeriod,
	saveScheduled,
	saveTransaction,
	setSetting,
	scheduledInputFromForm,
	transactionInputFromForm
} from '$lib/server/finance';

function monthBounds(month: string): { from: string; to: string } {
	const [y, m] = month.split('-').map(Number);
	return {
		from: `${month}-01`,
		to: m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
	};
}

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
	const occurrences = scheduled.flatMap((s) =>
		getOccurrences(s, from, to).map((date) => ({ scheduled: s, date }))
	);
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
		saveScheduled(locals.user!.id, input);
		return { ok: true };
	},

	'delete-scheduled': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteScheduled(locals.user!.id, id);
		return { ok: true };
	},

	'set-hide-actuals': async ({ request, locals }) => {
		const form = await request.formData();
		setSetting(locals.user!.id, 'hide_actuals', form.get('hide_actuals') === 'on' ? '1' : '0');
		return { ok: true };
	}
};
