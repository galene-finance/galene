import { fail } from '@sveltejs/kit';
import { demoBlockedMessage, isDemoMode } from './demoMode';
import { deleteScheduledScoped, scheduledDeleteFromForm } from './finance';

/** The `delete-scheduled` form action shared by Calendar and Scheduled. Demo mode blocks it like the write API. */
export async function deleteScheduledAction({ request, locals }: { request: Request; locals: App.Locals }) {
	if (isDemoMode()) return fail(403, { error: demoBlockedMessage('Deleting scheduled items') });
	const form = await request.formData();
	const parsed = scheduledDeleteFromForm(locals.user!.id, form);
	if (parsed.error || parsed.id == null) return fail(400, { error: parsed.error ?? 'Scheduled expectation not found.' });
	try {
		const result = deleteScheduledScoped(locals.user!.id, parsed.id, parsed.scope, parsed.occurrenceDate);
		return { ok: true, removed: result.removed };
	} catch (error) {
		return fail(400, { error: error instanceof Error ? error.message : 'Could not delete.' });
	}
}
