import { fail } from '@sveltejs/kit';
import type { Database } from 'bun:sqlite';
import {
	listPickerCandidates,
	occurrenceNeedsSuggestion,
	strongSuggestion,
	MATCH_DATE_WINDOW_DAYS,
	PICKER_DATE_WINDOW_DAYS,
	type ListedCandidate,
	type MatchOccurrence,
	type MatchSuggestionView,
	type MatchTxn
} from '$lib/scheduledMatch';
import { addDaysIso } from '$lib/calendarMobile';
import { paidKey, type OccurrenceMatch } from '$lib/scheduledPaid';
import { db } from './db';
import { loadOwnedOccurrence } from './scheduledPaid';

export type { ListedCandidate, MatchSuggestionView };

const ERR_SERIES = 'Scheduled expectation not found.';
const ERR_TXN = 'Transaction not found.';
const ERR_TXN_TAKEN = 'That transaction is already matched to another occurrence.';
const ERR_OCC_TAKEN = 'This occurrence is already matched to a transaction.';

type TxnRow = {
	id: number;
	date: string;
	amount_cents: number;
	merchant: string | null;
	notes: string | null;
	account_id: number;
	account_name: string | null;
};

function ownedTransaction(userId: number, transactionId: number): TxnRow | null {
	if (!Number.isFinite(transactionId)) return null;
	return (
		(db()
			.query(
				`SELECT t.id, t.date, t.amount_cents, t.merchant, t.notes, t.account_id, a.name AS account_name
				 FROM transactions t
				 LEFT JOIN accounts a ON a.id = t.account_id
				 WHERE t.id = ? AND t.user_id = ?`
			)
			.get(transactionId, userId) as TxnRow | null) ?? null
	);
}

export function matchesByScheduled(userId: number, scheduledIds: number[]): Map<string, OccurrenceMatch> {
	const map = new Map<string, OccurrenceMatch>();
	if (scheduledIds.length === 0) return map;
	const rows = db()
		.query(
			`SELECT m.scheduled_id, m.occurrence_date, m.transaction_id, m.matched_at,
			        t.date, t.amount_cents, t.merchant, t.account_id, a.name AS account_name
			 FROM scheduled_match m
			 JOIN scheduled s ON s.id = m.scheduled_id
			 JOIN transactions t ON t.id = m.transaction_id
			 LEFT JOIN accounts a ON a.id = t.account_id
			 WHERE s.user_id = ? AND m.scheduled_id IN (${scheduledIds.map(() => '?').join(',')})`
		)
		.all(userId, ...scheduledIds) as {
		scheduled_id: number;
		occurrence_date: string;
		transaction_id: number;
		matched_at: string;
		date: string;
		amount_cents: number;
		merchant: string | null;
		account_id: number;
		account_name: string | null;
	}[];
	for (const row of rows) {
		map.set(paidKey(row.scheduled_id, row.occurrence_date), {
			transactionId: row.transaction_id,
			matchedAt: row.matched_at,
			date: row.date,
			amountCents: row.amount_cents,
			merchant: row.merchant,
			accountId: row.account_id,
			accountName: row.account_name
		});
	}
	return map;
}

function matchedIds(userId: number): Set<number> {
	const rows = db()
		.query(
			`SELECT m.transaction_id AS id
			 FROM scheduled_match m
			 JOIN scheduled s ON s.id = m.scheduled_id
			 WHERE s.user_id = ?`
		)
		.all(userId) as { id: number }[];
	return new Set(rows.map((row) => row.id));
}

function dismissedIds(userId: number, scheduledId: number, occurrenceDate: string): Set<number> {
	const rows = db()
		.query(
			`SELECT d.transaction_id AS id
			 FROM scheduled_match_dismissed d
			 JOIN scheduled s ON s.id = d.scheduled_id
			 WHERE s.user_id = ? AND d.scheduled_id = ? AND d.occurrence_date = ?`
		)
		.all(userId, scheduledId, occurrenceDate) as { id: number }[];
	return new Set(rows.map((row) => row.id));
}

function toMatchTxn(row: TxnRow, matched: Set<number>, dismissed: Set<number>): MatchTxn {
	return {
		id: row.id,
		date: row.date,
		amountCents: row.amount_cents,
		merchant: row.merchant,
		description: row.notes,
		accountId: row.account_id,
		matchedElsewhere: matched.has(row.id),
		dismissedForOccurrence: dismissed.has(row.id)
	};
}

function txnsInWindow(userId: number, from: string, to: string, accountId: number | null): TxnRow[] {
	if (accountId != null) {
		return db()
			.query(
				`SELECT t.id, t.date, t.amount_cents, t.merchant, t.notes, t.account_id, a.name AS account_name
				 FROM transactions t
				 LEFT JOIN accounts a ON a.id = t.account_id
				 WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.account_id = ?
				 ORDER BY t.date, t.id`
			)
			.all(userId, from, to, accountId) as TxnRow[];
	}
	return db()
		.query(
			`SELECT t.id, t.date, t.amount_cents, t.merchant, t.notes, t.account_id, a.name AS account_name
			 FROM transactions t
			 LEFT JOIN accounts a ON a.id = t.account_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
			 ORDER BY t.date, t.id`
		)
		.all(userId, from, to) as TxnRow[];
}

function asOccurrence(hit: {
	date: string;
	scheduled: { name: string; amount_cents: number; account_id: number | null };
}): MatchOccurrence {
	return {
		displayDate: hit.date,
		amountCents: hit.scheduled.amount_cents,
		name: hit.scheduled.name,
		accountId: hit.scheduled.account_id
	};
}

/**
 * Suggestions for unpaid occurrences that are overdue or due within 7 days.
 * One query covers the union of those date windows. Does not insert a match.
 */
export function suggestionsByOccurrence(
	userId: number,
	occurrences: {
		date: string;
		occurrenceDate: string;
		paid: boolean;
		scheduled: { id: number; name: string; amount_cents: number; account_id: number | null };
	}[],
	today: string
): Record<string, MatchSuggestionView> {
	const eligible = occurrences.filter((row) => occurrenceNeedsSuggestion(row.date, row.paid, today));
	const out: Record<string, MatchSuggestionView> = {};
	if (eligible.length === 0) return out;
	let from = eligible[0]!.date;
	let to = eligible[0]!.date;
	for (const row of eligible) {
		if (row.date < from) from = row.date;
		if (row.date > to) to = row.date;
	}
	const rows = txnsInWindow(
		userId,
		addDaysIso(from, -MATCH_DATE_WINDOW_DAYS),
		addDaysIso(to, MATCH_DATE_WINDOW_DAYS),
		null
	);
	const matched = matchedIds(userId);
	const names = new Map(rows.map((row) => [row.id, row.account_name]));
	for (const row of eligible) {
		const dismissed = dismissedIds(userId, row.scheduled.id, row.occurrenceDate);
		const suggestion = strongSuggestion(
			asOccurrence(row),
			rows.map((txn) => toMatchTxn(txn, matched, dismissed))
		);
		if (!suggestion) continue;
		out[paidKey(row.scheduled.id, row.occurrenceDate)] = {
			transactionId: suggestion.id,
			date: suggestion.date,
			amountCents: suggestion.amountCents,
			merchant: suggestion.merchant,
			accountId: suggestion.accountId,
			accountName: names.get(suggestion.id) ?? null
		};
	}
	return out;
}

export async function listMatchCandidates(
	userId: number,
	scheduledId: number,
	occurrenceDate: string,
	query: string
): Promise<ListedCandidate[]> {
	const hit = await loadOwnedOccurrence(userId, scheduledId, occurrenceDate);
	const from = addDaysIso(hit.date, -PICKER_DATE_WINDOW_DAYS);
	const to = addDaysIso(hit.date, PICKER_DATE_WINDOW_DAYS);
	const rows = txnsInWindow(userId, from, to, hit.scheduled.account_id);
	const matched = matchedIds(userId);
	const dismissed = dismissedIds(userId, scheduledId, occurrenceDate);
	const names = new Map(rows.map((row) => [row.id, row.account_name]));
	return listPickerCandidates(
		asOccurrence(hit),
		rows.map((txn) => toMatchTxn(txn, matched, dismissed)),
		query
	).map((row) => ({
		id: row.id,
		date: row.date,
		amountCents: row.amountCents,
		merchant: row.merchant,
		accountId: row.accountId,
		accountName: names.get(row.id) ?? null,
		hint: row.hint,
		strong: row.strong
	}));
}

/**
 * Link this occurrence to this transaction. Does not delete scheduled_paid and
 * does not write the transaction. Same pair again keeps the original matched_at.
 */
export async function confirmMatch(
	userId: number,
	scheduledId: number,
	occurrenceDate: string,
	transactionId: number,
	nowIso: string
): Promise<{ matchedAt: string }> {
	await loadOwnedOccurrence(userId, scheduledId, occurrenceDate);
	if (!ownedTransaction(userId, transactionId)) throw new Error(ERR_TXN);
	const database = db();
	const byTxn = database
		.query(
			`SELECT m.scheduled_id, m.occurrence_date, m.matched_at
			 FROM scheduled_match m
			 JOIN scheduled s ON s.id = m.scheduled_id
			 WHERE m.transaction_id = ? AND s.user_id = ?`
		)
		.get(transactionId, userId) as
		| { scheduled_id: number; occurrence_date: string; matched_at: string }
		| null;
	if (byTxn) {
		if (byTxn.scheduled_id === scheduledId && byTxn.occurrence_date === occurrenceDate) {
			return { matchedAt: byTxn.matched_at };
		}
		throw new Error(ERR_TXN_TAKEN);
	}
	const byOcc = database
		.query('SELECT transaction_id FROM scheduled_match WHERE scheduled_id = ? AND occurrence_date = ?')
		.get(scheduledId, occurrenceDate) as { transaction_id: number } | null;
	if (byOcc && byOcc.transaction_id !== transactionId) throw new Error(ERR_OCC_TAKEN);
	database.run('BEGIN');
	try {
		database
			.query(
				`INSERT INTO scheduled_match (scheduled_id, occurrence_date, transaction_id, matched_at)
				 VALUES (?, ?, ?, ?)`
			)
			.run(scheduledId, occurrenceDate, transactionId, nowIso);
		database
			.query(
				`DELETE FROM scheduled_match_dismissed
				 WHERE scheduled_id = ? AND occurrence_date = ? AND transaction_id = ?`
			)
			.run(scheduledId, occurrenceDate, transactionId);
		database.run('COMMIT');
	} catch (error) {
		database.run('ROLLBACK');
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('scheduled_match.transaction_id')) throw new Error(ERR_TXN_TAKEN);
		if (message.includes('UNIQUE')) throw new Error(ERR_OCC_TAKEN);
		throw error;
	}
	return { matchedAt: nowIso };
}

/** Drop the match only. A scheduled_paid row, if any, is left alone. */
export async function unmatchOccurrence(userId: number, scheduledId: number, occurrenceDate: string): Promise<void> {
	await loadOwnedOccurrence(userId, scheduledId, occurrenceDate);
	db().query('DELETE FROM scheduled_match WHERE scheduled_id = ? AND occurrence_date = ?').run(scheduledId, occurrenceDate);
}

/** Not this. Idempotent for the same occurrence and transaction. */
export async function dismissMatch(
	userId: number,
	scheduledId: number,
	occurrenceDate: string,
	transactionId: number,
	nowIso: string
): Promise<void> {
	await loadOwnedOccurrence(userId, scheduledId, occurrenceDate);
	if (!ownedTransaction(userId, transactionId)) throw new Error(ERR_TXN);
	db()
		.query(
			`INSERT INTO scheduled_match_dismissed (scheduled_id, occurrence_date, transaction_id, dismissed_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT (scheduled_id, occurrence_date, transaction_id) DO NOTHING`
		)
		.run(scheduledId, occurrenceDate, transactionId, nowIso);
}

/**
 * Pending/orphan fold deletes a transaction id and keeps another. Move the
 * match and dismissals onto the survivor. If the survivor is already matched,
 * the old link is dropped: one transaction can match only one occurrence.
 */
export function carryMatchLinks(database: Database, fromTxnId: number, toTxnId: number) {
	if (!Number.isFinite(fromTxnId) || !Number.isFinite(toTxnId) || fromTxnId === toTxnId) return;
	const targetMatched = database
		.query('SELECT 1 AS o FROM scheduled_match WHERE transaction_id = ?')
		.get(toTxnId) as { o: number } | null;
	if (targetMatched) {
		database.query('DELETE FROM scheduled_match WHERE transaction_id = ?').run(fromTxnId);
	} else {
		database
			.query('UPDATE scheduled_match SET transaction_id = ? WHERE transaction_id = ?')
			.run(toTxnId, fromTxnId);
	}
	const dismissed = database
		.query(
			'SELECT id, scheduled_id, occurrence_date FROM scheduled_match_dismissed WHERE transaction_id = ?'
		)
		.all(fromTxnId) as { id: number; scheduled_id: number; occurrence_date: string }[];
	for (const row of dismissed) {
		const clash = database
			.query(
				`SELECT 1 AS o FROM scheduled_match_dismissed
				 WHERE scheduled_id = ? AND occurrence_date = ? AND transaction_id = ?`
			)
			.get(row.scheduled_id, row.occurrence_date, toTxnId) as { o: number } | null;
		if (clash) database.query('DELETE FROM scheduled_match_dismissed WHERE id = ?').run(row.id);
		else database.query('UPDATE scheduled_match_dismissed SET transaction_id = ? WHERE id = ?').run(toTxnId, row.id);
	}
}

function userIdOf(locals: App.Locals): number | null {
	return locals.user?.id ?? null;
}

async function formFields(request: Request): Promise<{
	id: number;
	occurrenceDate: string;
	transactionId: number;
	q: string;
}> {
	const form = await request.formData();
	return {
		id: parseInt(String(form.get('id') ?? ''), 10),
		occurrenceDate: String(form.get('occurrence_date') ?? '').trim(),
		transactionId: parseInt(String(form.get('transaction_id') ?? ''), 10),
		q: String(form.get('q') ?? '')
	};
}

function actionError(error: unknown) {
	return fail(400, { error: error instanceof Error ? error.message : 'Could not update.' });
}

/** Calendar form actions. Demo mode is allowed, the same way mark paid is. */
export async function matchConfirmAction({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<{ ok: true } | ReturnType<typeof fail>> {
	const userId = userIdOf(locals);
	if (userId == null) return fail(400, { error: ERR_SERIES });
	const fields = await formFields(request);
	try {
		await confirmMatch(userId, fields.id, fields.occurrenceDate, fields.transactionId, new Date().toISOString());
		return { ok: true };
	} catch (error) {
		return actionError(error);
	}
}

export async function matchUnmatchAction({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<{ ok: true } | ReturnType<typeof fail>> {
	const userId = userIdOf(locals);
	if (userId == null) return fail(400, { error: ERR_SERIES });
	const fields = await formFields(request);
	try {
		await unmatchOccurrence(userId, fields.id, fields.occurrenceDate);
		return { ok: true };
	} catch (error) {
		return actionError(error);
	}
}

export async function matchDismissAction({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<{ ok: true } | ReturnType<typeof fail>> {
	const userId = userIdOf(locals);
	if (userId == null) return fail(400, { error: ERR_SERIES });
	const fields = await formFields(request);
	try {
		await dismissMatch(userId, fields.id, fields.occurrenceDate, fields.transactionId, new Date().toISOString());
		return { ok: true };
	} catch (error) {
		return actionError(error);
	}
}

export async function matchCandidatesAction({
	request,
	locals
}: {
	request: Request;
	locals: App.Locals;
}): Promise<{ candidates: ListedCandidate[] } | ReturnType<typeof fail>> {
	const userId = userIdOf(locals);
	if (userId == null) return fail(400, { error: ERR_SERIES });
	const fields = await formFields(request);
	try {
		const candidates = await listMatchCandidates(userId, fields.id, fields.occurrenceDate, fields.q);
		return { candidates };
	} catch (error) {
		return actionError(error);
	}
}
