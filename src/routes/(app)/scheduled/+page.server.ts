import { deleteScheduledAction } from '$lib/server/scheduledDeleteAction';
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
import { OVERDUE_LOOKBACK_DAYS, attachPaidState, selectScheduleFocus } from '$lib/scheduledPaid';
import { todayISO } from '$lib/utils';

export function load({ locals }) {
	const userId = locals.user!.id;
	const today = todayISO();
	const seriesRows = getScheduled(userId);
	const paidAt = paidAtByScheduled(
		userId,
		seriesRows.map((series) => series.id)
	);
	const windowStart = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
	const rows = seriesRows
		.map((series) => {
			let to = addDaysIso(today, 366 * 15);
			if (series.start_date > to) to = series.start_date;
			const expanded = attachPaidState(expandScheduled(series, windowStart, to), paidAt, today);
			const next = expanded.find((row) => row.date >= today) ?? null;
			return {
				scheduled: next?.scheduled ?? series,
				nextDate: next?.date ?? null,
				focus: selectScheduleFocus(expanded, today)
			};
		})
		.sort((a, b) => {
			if (a.nextDate && b.nextDate) {
				return a.nextDate.localeCompare(b.nextDate) || a.scheduled.name.localeCompare(b.scheduled.name);
			}
			if (a.nextDate) return -1;
			if (b.nextDate) return 1;
			return a.scheduled.name.localeCompare(b.scheduled.name);
		});

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
