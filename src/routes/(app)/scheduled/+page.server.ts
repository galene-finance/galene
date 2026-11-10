import { deleteScheduledAction } from '$lib/server/scheduledDeleteAction';
import { matchesByScheduled } from '$lib/server/scheduledMatch';
import { paidAtByScheduled } from '$lib/server/scheduledPaid';
import {
	getAccounts,
	getCategories,
	expandScheduled,
	getScheduled,
	getTags,
	saveScheduled,
	scheduledInputFromForm
} from '$lib/server/finance';
import { addDaysIso } from '$lib/calendarMobile';
import { OVERDUE_LOOKBACK_DAYS, attachPaidState, compareScheduleCards, selectScheduleFocus } from '$lib/scheduledPaid';
import { todayISO } from '$lib/utils';

export function load({ locals }) {
	const userId = locals.user!.id;
	const today = todayISO();
	const seriesRows = getScheduled(userId);
	const seriesIds = seriesRows.map((series) => series.id);
	const paidAt = paidAtByScheduled(userId, seriesIds);
	const matches = matchesByScheduled(userId, seriesIds);
	const windowStart = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
	// Expand from the series start so a paid one-time older than the overdue
	// window still has an occurrence to focus. Upcoming stays "next date on or
	// after today"; that ended series shows its Paid band on All.
	const rows = seriesRows
		.map((series) => {
			let to = addDaysIso(today, 366 * 15);
			if (series.start_date > to) to = series.start_date;
			const from = series.start_date < windowStart ? series.start_date : windowStart;
			const expanded = attachPaidState(expandScheduled(series, from, to), paidAt, today, matches);
			const next = expanded.find((row) => row.date >= today) ?? null;
			return {
				scheduled: next?.scheduled ?? series,
				nextDate: next?.date ?? null,
				focus: selectScheduleFocus(expanded, today)
			};
		})
		.sort(compareScheduleCards);

	return {
		rows,
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId)
	};
}

export const actions = {
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

	'delete-scheduled': deleteScheduledAction
};
