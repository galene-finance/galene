import { fail } from '@sveltejs/kit';
import { isIsoDate } from '$lib/scheduledPaid';
import { db } from './db';

export function paidAtByScheduled(userId: number, scheduledIds: number[]): Map<string, string> {
	const map = new Map<string, string>();
	if (scheduledIds.length === 0) return map;
	const rows = db()
		.query(
			`SELECT p.scheduled_id, p.occurrence_date, p.paid_at
			 FROM scheduled_paid p
			 JOIN scheduled s ON s.id = p.scheduled_id
			 WHERE s.user_id = ? AND p.scheduled_id IN (${scheduledIds.map(() => '?').join(',')})`
		)
		.all(userId, ...scheduledIds) as { scheduled_id: number; occurrence_date: string; paid_at: string }[];
	for (const row of rows) map.set(`${row.scheduled_id}|${row.occurrence_date}`, row.paid_at);
	return map;
}

/**
 * Mark or clear one occurrence. Does not insert a transaction.
 * Re-marking keeps the original paid_at. The date must be the occurrence
 * identity (the series date), not a moved display date.
 */
/** Series date, not a moved display date. Throws the same messages as mark-paid. */
export async function loadOwnedOccurrence(userId: number, scheduledId: number, occurrenceDate: string) {
	if (!Number.isFinite(scheduledId)) throw new Error('Scheduled expectation not found.');
	if (!isIsoDate(occurrenceDate)) throw new Error('Enter a valid occurrence date.');
	const { expandScheduled, getScheduled } = await import('./finance');
	const series = getScheduled(userId).find((row) => row.id === scheduledId);
	if (!series) throw new Error('Scheduled expectation not found.');
	const hit = expandScheduled(series, series.start_date, '9999-12-31').find(
		(row) => row.occurrenceDate === occurrenceDate
	);
	if (!hit) throw new Error('That date is not part of this schedule.');
	return hit;
}

export async function setOccurrencePaid(
	userId: number,
	scheduledId: number,
	occurrenceDate: string,
	paid: boolean,
	nowIso: string
): Promise<{ paid: boolean; paidAt: string | null }> {
	await loadOwnedOccurrence(userId, scheduledId, occurrenceDate);

	const database = db();
	if (!paid) {
		database
			.query('DELETE FROM scheduled_paid WHERE scheduled_id = ? AND occurrence_date = ?')
			.run(scheduledId, occurrenceDate);
		return { paid: false, paidAt: null };
	}
	database
		.query(
			`INSERT INTO scheduled_paid (scheduled_id, occurrence_date, paid_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT (scheduled_id, occurrence_date) DO NOTHING`
		)
		.run(scheduledId, occurrenceDate, nowIso);
	const row = database
		.query('SELECT paid_at FROM scheduled_paid WHERE scheduled_id = ? AND occurrence_date = ?')
		.get(scheduledId, occurrenceDate) as { paid_at: string };
	return { paid: true, paidAt: row.paid_at };
}

/** Calendar form action. Demo mode is allowed; this does not touch transactions. */
export async function setPaidAction({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<{ ok: true } | ReturnType<typeof fail>> {
	const userId = locals.user?.id;
	if (userId == null) return fail(400, { error: 'Scheduled expectation not found.' });
	const form = await request.formData();
	const id = parseInt(String(form.get('id') ?? ''), 10);
	const occurrenceDate = String(form.get('occurrence_date') ?? '').trim();
	const paidRaw = String(form.get('paid') ?? '');
	if (paidRaw !== 'on' && paidRaw !== 'off') return fail(400, { error: 'Choose whether this occurrence is paid.' });
	try {
		await setOccurrencePaid(userId, id, occurrenceDate, paidRaw === 'on', new Date().toISOString());
		return { ok: true };
	} catch (error) {
		return fail(400, { error: error instanceof Error ? error.message : 'Could not update.' });
	}
}
