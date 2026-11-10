import { json } from '@sveltejs/kit';
import { listMatchCandidates } from '$lib/server/scheduledMatch';
import type { RequestHandler } from './$types';

/** Picker candidates. JSON so the popover can load them without a navigation. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user?.id;
	if (userId == null) return json({ error: 'Scheduled expectation not found.' }, { status: 400 });
	const form = await request.formData();
	const id = parseInt(String(form.get('id') ?? ''), 10);
	const occurrenceDate = String(form.get('occurrence_date') ?? '').trim();
	const q = String(form.get('q') ?? '');
	try {
		const candidates = await listMatchCandidates(userId, id, occurrenceDate, q);
		return json({ candidates });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not update.';
		return json({ error: message }, { status: 400 });
	}
};
