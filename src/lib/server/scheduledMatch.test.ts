/**
 * Match links for scheduled occurrences. Temp database only.
 * Suggesting a transaction never inserts a row.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { paidKey } from '$lib/scheduledPaid';
import { todayISO } from '$lib/utils';
import type { ScheduledInput, TransactionInput } from './finance';

const dir = mkdtempSync(join(tmpdir(), 'galene-match-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
delete process.env.GALENE_DEMO;

const { closeDbForTests, db } = await import('./db');
const { expandScheduled, deleteScheduledScoped, deleteTransaction, getScheduled, saveAccount, saveScheduled, saveTransaction } =
	await import('./finance');
const { setOccurrencePaid } = await import('./scheduledPaid');
const {
	carryMatchLinks,
	confirmMatch,
	dismissMatch,
	listMatchCandidates,
	matchConfirmAction,
	suggestionsByOccurrence,
	unmatchOccurrence
} = await import('./scheduledMatch');
const { guardDemoMode } = await import('./demoGuard');

afterAll(() => {
	delete process.env.GALENE_DEMO;
	closeDbForTests();
	rmSync(dir, { recursive: true, force: true });
});

const today = todayISO();

function uid(email = 'dev-match@test'): number {
	const existing = db().query('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | null;
	if (existing) return existing.id;
	db().query(`INSERT INTO users (name, email, password_hash) VALUES ('Dev', ?, 'x')`).run(email);
	return Number((db().query('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id);
}

function account(): number {
	saveAccount(uid(), null, { name: 'Checking', type: 'bank', color: null });
	return (db().query('SELECT id FROM accounts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(uid()) as { id: number })
		.id;
}

function seriesInput(over: Partial<ScheduledInput> = {}): ScheduledInput {
	return {
		name: 'Rent',
		amountCents: -10000,
		startDate: '2026-01-01',
		account: null,
		category: null,
		notes: null,
		color: null,
		repeats: true,
		repeatInterval: 1,
		repeatUnit: 'month',
		untilDate: '2026-06-01',
		forecastBehavior: 'bill',
		tags: [],
		...over
	};
}

function resetSeries(over: Partial<ScheduledInput> = {}): number {
	db().query('DELETE FROM scheduled').run();
	saveScheduled(uid(), seriesInput(over));
	return getScheduled(uid())[0].id;
}

function addTxn(accountId: number, over: Partial<TransactionInput> = {}): number {
	const input: TransactionInput = {
		type: 'expense',
		amountCents: 10000,
		date: today,
		account: accountId,
		category: null,
		merchant: 'Rent',
		notes: null,
		color: null,
		tags: [],
		...over
	};
	saveTransaction(uid(), input);
	return input.id!;
}

function matchRows(): { scheduled_id: number; occurrence_date: string; transaction_id: number }[] {
	return db()
		.query(
			'SELECT scheduled_id, occurrence_date, transaction_id FROM scheduled_match ORDER BY scheduled_id, occurrence_date'
		)
		.all() as { scheduled_id: number; occurrence_date: string; transaction_id: number }[];
}

function dismissRows(): { scheduled_id: number; occurrence_date: string; transaction_id: number }[] {
	return db()
		.query(
			'SELECT scheduled_id, occurrence_date, transaction_id FROM scheduled_match_dismissed ORDER BY scheduled_id, occurrence_date, transaction_id'
		)
		.all() as { scheduled_id: number; occurrence_date: string; transaction_id: number }[];
}

describe('confirm, dismiss, and unmatch', () => {
	test('a suggestion is not stored until confirm', async () => {
		const acct = account();
		const id = resetSeries({ startDate: today, repeats: false, repeatInterval: null, repeatUnit: null, untilDate: null, account: acct });
		const txn = addTxn(acct);
		const series = getScheduled(uid())[0];
		const hit = expandScheduled(series, today, today)[0];
		expect(hit?.occurrenceDate).toBe(today);
		const suggestions = suggestionsByOccurrence(uid(), [{ ...hit!, paid: false }], today);
		expect(suggestions[paidKey(id, today)]?.transactionId).toBe(txn);
		expect(matchRows()).toHaveLength(0);

		const first = await confirmMatch(uid(), id, today, txn, '2026-11-10T15:00:00.000Z');
		expect(first.matchedAt).toBe('2026-11-10T15:00:00.000Z');
		const again = await confirmMatch(uid(), id, today, txn, '2026-12-01T15:00:00.000Z');
		expect(again.matchedAt).toBe('2026-11-10T15:00:00.000Z');
		expect(matchRows()).toEqual([{ scheduled_id: id, occurrence_date: today, transaction_id: txn }]);
	});

	test('one transaction matches one occurrence, and one occurrence has one match', async () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const txn = addTxn(acct, { date: '2026-02-01' });
		const other = addTxn(acct, { date: '2026-03-01', merchant: 'Other' });
		await confirmMatch(uid(), id, '2026-02-01', txn, '2026-02-02T00:00:00.000Z');
		await expect(confirmMatch(uid(), id, '2026-03-01', txn, '2026-03-02T00:00:00.000Z')).rejects.toThrow(
			'already matched to another occurrence'
		);
		await expect(confirmMatch(uid(), id, '2026-02-01', other, '2026-02-03T00:00:00.000Z')).rejects.toThrow(
			'already matched to a transaction'
		);
		expect(matchRows()).toHaveLength(1);
	});

	test('mark paid is refused while matched, and unmatch leaves a manual paid row alone', async () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const txn = addTxn(acct, { date: '2026-01-01' });
		await setOccurrencePaid(uid(), id, '2026-01-01', true, '2026-01-02T00:00:00.000Z');
		await confirmMatch(uid(), id, '2026-01-01', txn, '2026-01-03T00:00:00.000Z');
		await expect(setOccurrencePaid(uid(), id, '2026-01-01', false, '2026-01-04T00:00:00.000Z')).rejects.toThrow(
			'Unmatch this occurrence before changing Mark paid.'
		);
		await unmatchOccurrence(uid(), id, '2026-01-01');
		expect(matchRows()).toHaveLength(0);
		const paid = db()
			.query('SELECT paid_at FROM scheduled_paid WHERE scheduled_id = ? AND occurrence_date = ?')
			.get(id, '2026-01-01') as { paid_at: string };
		expect(paid.paid_at).toBe('2026-01-02T00:00:00.000Z');
	});

	test('not this is remembered, and that transaction is not suggested again', async () => {
		const acct = account();
		const id = resetSeries({
			startDate: today,
			repeats: false,
			repeatInterval: null,
			repeatUnit: null,
			untilDate: null,
			account: acct
		});
		const txn = addTxn(acct);
		const series = getScheduled(uid())[0];
		const hit = expandScheduled(series, today, today)[0]!;
		await dismissMatch(uid(), id, today, txn, '2026-11-10T16:00:00.000Z');
		await dismissMatch(uid(), id, today, txn, '2026-11-10T17:00:00.000Z');
		expect(dismissRows()).toHaveLength(1);
		const suggestions = suggestionsByOccurrence(uid(), [{ ...hit, paid: false }], today);
		expect(suggestions[paidKey(id, today)]).toBeUndefined();
		const listed = await listMatchCandidates(uid(), id, today, '');
		expect(listed.map((row) => row.id)).toContain(txn);
		expect(matchRows()).toHaveLength(0);
	});

	test('a moved occurrence is keyed by the original date', async () => {
		const acct = account();
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), seriesInput({ untilDate: null, account: acct }));
		const id = getScheduled(uid())[0].id;
		saveScheduled(uid(), seriesInput({ id, startDate: '2026-11-07', untilDate: null, account: acct, editScope: 'once', occurrenceDate: '2026-11-01' }));
		const txn = addTxn(acct, { date: '2026-11-07' });
		await expect(confirmMatch(uid(), id, '2026-11-07', txn, '2026-11-08T00:00:00.000Z')).rejects.toThrow(
			'not part of this schedule'
		);
		await confirmMatch(uid(), id, '2026-11-01', txn, '2026-11-08T00:00:00.000Z');
		expect(matchRows()).toEqual([{ scheduled_id: id, occurrence_date: '2026-11-01', transaction_id: txn }]);
	});

	test('deleting the transaction drops the match and the dismissal', async () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const txn = addTxn(acct, { date: '2026-02-01' });
		const other = addTxn(acct, { date: '2026-02-02', merchant: 'Elsewhere' });
		await confirmMatch(uid(), id, '2026-02-01', txn, '2026-02-02T00:00:00.000Z');
		await dismissMatch(uid(), id, '2026-03-01', other, '2026-03-02T00:00:00.000Z');
		deleteTransaction(uid(), txn);
		deleteTransaction(uid(), other);
		expect(matchRows()).toHaveLength(0);
		expect(dismissRows()).toHaveLength(0);
	});

	test('delete once, delete following, and delete series drop links the way paid rows do', async () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const jan = addTxn(acct, { date: '2026-01-01', merchant: 'Jan' });
		const feb = addTxn(acct, { date: '2026-02-01', merchant: 'Feb' });
		const apr = addTxn(acct, { date: '2026-04-01', merchant: 'Apr' });
		await confirmMatch(uid(), id, '2026-01-01', jan, '2026-01-02T00:00:00.000Z');
		await dismissMatch(uid(), id, '2026-02-01', feb, '2026-02-02T00:00:00.000Z');
		await confirmMatch(uid(), id, '2026-04-01', apr, '2026-04-02T00:00:00.000Z');
		deleteScheduledScoped(uid(), id, 'once', '2026-02-01');
		expect(dismissRows()).toHaveLength(0);
		expect(matchRows().map((row) => row.occurrence_date)).toEqual(['2026-01-01', '2026-04-01']);
		deleteScheduledScoped(uid(), id, 'following', '2026-04-01');
		expect(matchRows().map((row) => row.occurrence_date)).toEqual(['2026-01-01']);
		deleteScheduledScoped(uid(), id, 'all');
		expect(matchRows()).toHaveLength(0);
	});

	test('a split keeps earlier links and moves later ones that still occur', async () => {
		const acct = account();
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), seriesInput({ untilDate: null, account: acct }));
		const oldId = getScheduled(uid())[0].id;
		const jan = addTxn(acct, { date: '2026-01-01' });
		const mar = addTxn(acct, { date: '2026-03-01', merchant: 'March rent' });
		const may = addTxn(acct, { date: '2026-05-01', merchant: 'May rent' });
		await confirmMatch(uid(), oldId, '2026-01-01', jan, '2026-01-02T00:00:00.000Z');
		await confirmMatch(uid(), oldId, '2026-03-01', mar, '2026-03-02T00:00:00.000Z');
		await dismissMatch(uid(), oldId, '2026-05-01', may, '2026-05-02T00:00:00.000Z');
		const newId = saveScheduled(
			uid(),
			seriesInput({
				id: oldId,
				startDate: '2026-03-01',
				untilDate: null,
				amountCents: -12000,
				account: acct,
				editScope: 'new',
				occurrenceDate: '2026-03-01'
			})
		);
		expect(newId).not.toBe(oldId);
		expect(matchRows().filter((row) => row.scheduled_id === oldId).map((row) => row.occurrence_date)).toEqual(['2026-01-01']);
		expect(matchRows().filter((row) => row.scheduled_id === newId).map((row) => row.occurrence_date)).toEqual(['2026-03-01']);
		expect(dismissRows().filter((row) => row.scheduled_id === newId).map((row) => row.occurrence_date)).toEqual(['2026-05-01']);
		expect(dismissRows().filter((row) => row.scheduled_id === oldId)).toHaveLength(0);
	});

	test('folding a transaction carries the match unless the survivor is already matched', () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const pending = addTxn(acct, { date: '2026-02-01', merchant: 'Pending rent' });
		const posted = addTxn(acct, { date: '2026-02-02', merchant: 'Posted rent' });
		db()
			.query(
				`INSERT INTO scheduled_match (scheduled_id, occurrence_date, transaction_id, matched_at)
				 VALUES (?, '2026-02-01', ?, '2026-02-02T00:00:00.000Z')`
			)
			.run(id, pending);
		carryMatchLinks(db(), pending, posted);
		expect(matchRows()).toEqual([{ scheduled_id: id, occurrence_date: '2026-02-01', transaction_id: posted }]);

		const other = addTxn(acct, { date: '2026-03-01', merchant: 'Other pending' });
		db()
			.query(
				`INSERT INTO scheduled_match (scheduled_id, occurrence_date, transaction_id, matched_at)
				 VALUES (?, '2026-03-01', ?, '2026-03-02T00:00:00.000Z')`
			)
			.run(id, other);
		carryMatchLinks(db(), other, posted);
		expect(matchRows().map((row) => row.transaction_id)).toEqual([posted]);
		expect(matchRows()).toHaveLength(1);
	});
});

describe('match action in demo mode', () => {
	test('demo mode allows confirm and the demo guard does not block it', async () => {
		const acct = account();
		const id = resetSeries({ account: acct });
		const txn = addTxn(acct, { date: '2026-04-01' });
		const form = new FormData();
		form.set('id', String(id));
		form.set('occurrence_date', '2026-04-01');
		form.set('transaction_id', String(txn));
		process.env.GALENE_DEMO = '1';
		try {
			expect(() =>
				guardDemoMode({
					route: { id: '/(app)/calendar' },
					request: new Request('http://localhost/calendar?/match-confirm', { method: 'POST' }),
					url: new URL('http://localhost/calendar?/match-confirm')
				} as RequestEvent)
			).not.toThrow();
			const result = await matchConfirmAction({
				request: new Request('http://localhost/calendar?/match-confirm', { method: 'POST', body: form }),
				locals: { user: { id: uid() } } as App.Locals
			});
			expect(result).toEqual({ ok: true });
			expect(matchRows()).toEqual([{ scheduled_id: id, occurrence_date: '2026-04-01', transaction_id: txn }]);
		} finally {
			delete process.env.GALENE_DEMO;
		}
	});
});
