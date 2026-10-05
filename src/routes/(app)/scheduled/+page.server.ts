import {
	deleteScheduled,
	getAccounts,
	getCategories,
	expandScheduled,
	getScheduled,
	getTags,
	saveScheduled,
	scheduledInputFromForm
} from '$lib/server/finance';
import { addDaysIso } from '$lib/calendarMobile';
import { todayISO } from '$lib/utils';
import type { Scheduled } from '$lib/types';

/** Far enough to catch a yearly series and a start date well in the future. */
function nextOccurrence(s: Scheduled, today: string): { date: string; scheduled: Scheduled } | null {
	let to = addDaysIso(today, 366 * 15);
	if (s.start_date > to) to = s.start_date;
	return expandScheduled(s, today, to)[0] ?? null;
}

export function load({ locals }) {
	const userId = locals.user!.id;
	const today = todayISO();
	const rows = getScheduled(userId)
		.map((series) => {
			const next = nextOccurrence(series, today);
			return {
				scheduled: next?.scheduled ?? series,
				nextDate: next?.date ?? null
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

	'delete-scheduled': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteScheduled(locals.user!.id, id);
		return { ok: true };
	}
};
