/**
 * Manual paid flags on scheduled occurrences. Temp database only.
 * Marking paid does not insert a transaction.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import type { ScheduledInput } from './finance';

const dir = mkdtempSync(join(tmpdir(), 'galene-paid-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
delete process.env.GALENE_DEMO;

const { closeDbForTests, db } = await import('./db');
const { expandScheduled, getScheduled, saveScheduled, deleteScheduledScoped } = await import('./finance');
const { setOccurrencePaid, setPaidAction } = await import('./scheduledPaid');
const { guardDemoMode } = await import('./demoGuard');

afterAll(() => {
	delete process.env.GALENE_DEMO;
	closeDbForTests();
	rmSync(dir, { recursive: true, force: true });
});

function uid(email = 'dev-paid@test'): number {
	const existing = db().query('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | null;
	if (existing) return existing.id;
	db().query(`INSERT INTO users (name, email, password_hash) VALUES ('Dev', ?, 'x')`).run(email);
	return Number((db().query('SELECT id FROM users WHERE email = ?').get(email) as { id: number }).id);
}

function input(over: Partial<ScheduledInput> = {}): ScheduledInput {
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

function reset(): number {
	db().query('DELETE FROM scheduled').run();
	saveScheduled(uid(), input());
	return getScheduled(uid())[0].id;
}

function paidRows(): { scheduled_id: number; occurrence_date: string; paid_at: string }[] {
	return db()
		.query('SELECT scheduled_id, occurrence_date, paid_at FROM scheduled_paid ORDER BY scheduled_id, occurrence_date')
		.all() as { scheduled_id: number; occurrence_date: string; paid_at: string }[];
}

function txnCount(): number {
	return (db().query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;
}

describe('setOccurrencePaid', () => {
	test('marks one occurrence and leaves the others alone', async () => {
		const id = reset();
		const before = txnCount();
		const first = await setOccurrencePaid(uid(), id, '2026-02-01', true, '2026-02-02T15:00:00.000Z');
		expect(first).toEqual({ paid: true, paidAt: '2026-02-02T15:00:00.000Z' });
		await setOccurrencePaid(uid(), id, '2026-03-01', true, '2026-03-02T15:00:00.000Z');
		expect(paidRows().map((row) => row.occurrence_date)).toEqual(['2026-02-01', '2026-03-01']);
		await setOccurrencePaid(uid(), id, '2026-02-01', false, '2026-02-03T15:00:00.000Z');
		expect(paidRows()).toEqual([
			{ scheduled_id: id, occurrence_date: '2026-03-01', paid_at: '2026-03-02T15:00:00.000Z' }
		]);
		expect(txnCount()).toBe(before);
	});

	test('re-marking keeps the original paid_at', async () => {
		const id = reset();
		await setOccurrencePaid(uid(), id, '2026-01-01', true, '2026-01-02T09:12:00.000Z');
		const again = await setOccurrencePaid(uid(), id, '2026-01-01', true, '2026-04-01T09:12:00.000Z');
		expect(again.paidAt).toBe('2026-01-02T09:12:00.000Z');
		expect(paidRows()).toHaveLength(1);
	});

	test('rejects another user, a bad date, and a date that is not an occurrence', async () => {
		const id = reset();
		const other = uid('other-paid@test');
		await expect(setOccurrencePaid(other, id, '2026-01-01', true, '2026-01-02T00:00:00.000Z')).rejects.toThrow(
			'Scheduled expectation not found.'
		);
		await expect(setOccurrencePaid(uid(), id, '03/01/2026', true, '2026-01-02T00:00:00.000Z')).rejects.toThrow(
			'Enter a valid occurrence date.'
		);
		await expect(setOccurrencePaid(uid(), id, '2026-03-15', true, '2026-01-02T00:00:00.000Z')).rejects.toThrow(
			'That date is not part of this schedule.'
		);
		expect(paidRows()).toHaveLength(0);
		expect(txnCount()).toBe(0);
	});

	test('a moved occurrence is keyed by the original date, not the display date', async () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ untilDate: null }));
		const id = getScheduled(uid())[0].id;
		saveScheduled(
			uid(),
			input({
				id,
				startDate: '2026-11-07',
				untilDate: null,
				editScope: 'once',
				occurrenceDate: '2026-11-01'
			})
		);
		const series = getScheduled(uid())[0];
		const moved = expandScheduled(series, '2026-11-01', '2026-11-30').find((row) => row.occurrenceDate === '2026-11-01');
		expect(moved?.date).toBe('2026-11-07');
		await setOccurrencePaid(uid(), id, '2026-11-01', true, '2026-11-08T12:00:00.000Z');
		await expect(setOccurrencePaid(uid(), id, '2026-11-07', true, '2026-11-08T12:00:00.000Z')).rejects.toThrow(
			'That date is not part of this schedule.'
		);
		expect(paidRows()).toEqual([
			{ scheduled_id: id, occurrence_date: '2026-11-01', paid_at: '2026-11-08T12:00:00.000Z' }
		]);
	});

	test('deleting a series cascades paid rows', async () => {
		const id = reset();
		await setOccurrencePaid(uid(), id, '2026-01-01', true, '2026-01-02T00:00:00.000Z');
		deleteScheduledScoped(uid(), id, 'all');
		expect(paidRows()).toHaveLength(0);
	});

	test('delete once and delete following drop paid rows for removed dates only', async () => {
		const id = reset();
		await setOccurrencePaid(uid(), id, '2026-01-01', true, '2026-01-02T00:00:00.000Z');
		await setOccurrencePaid(uid(), id, '2026-02-01', true, '2026-02-02T00:00:00.000Z');
		await setOccurrencePaid(uid(), id, '2026-04-01', true, '2026-04-02T00:00:00.000Z');
		deleteScheduledScoped(uid(), id, 'once', '2026-02-01');
		expect(paidRows().map((row) => row.occurrence_date)).toEqual(['2026-01-01', '2026-04-01']);
		deleteScheduledScoped(uid(), id, 'following', '2026-04-01');
		expect(paidRows().map((row) => row.occurrence_date)).toEqual(['2026-01-01']);
	});

	test('a split keeps earlier paid rows and moves later ones that still occur', async () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ untilDate: null }));
		const oldId = getScheduled(uid())[0].id;
		await setOccurrencePaid(uid(), oldId, '2026-01-01', true, '2026-01-02T00:00:00.000Z');
		await setOccurrencePaid(uid(), oldId, '2026-03-01', true, '2026-03-02T00:00:00.000Z');
		await setOccurrencePaid(uid(), oldId, '2026-05-01', true, '2026-05-02T00:00:00.000Z');
		const newId = saveScheduled(
			uid(),
			input({
				id: oldId,
				startDate: '2026-03-01',
				untilDate: null,
				amountCents: -12000,
				editScope: 'new',
				occurrenceDate: '2026-03-01'
			})
		);
		expect(newId).not.toBe(oldId);
		const rows = paidRows();
		expect(rows.filter((row) => row.scheduled_id === oldId).map((row) => row.occurrence_date)).toEqual(['2026-01-01']);
		expect(rows.filter((row) => row.scheduled_id === newId).map((row) => row.occurrence_date)).toEqual([
			'2026-03-01',
			'2026-05-01'
		]);
	});
});

describe('set-paid action', () => {
	test('rejects a non-occurrence with 400 and writes nothing', async () => {
		const id = reset();
		const form = new FormData();
		form.set('id', String(id));
		form.set('occurrence_date', '2026-03-15');
		form.set('paid', 'on');
		const result = await setPaidAction({
			request: new Request('http://localhost/calendar?/set-paid', { method: 'POST', body: form }),
			locals: { user: { id: uid() } } as App.Locals
		});
		expect(result).toMatchObject({ status: 400, data: { error: 'That date is not part of this schedule.' } });
		expect(paidRows()).toHaveLength(0);
	});

	test('demo mode allows the action and the demo guard does not block it', async () => {
		const id = reset();
		const form = new FormData();
		form.set('id', String(id));
		form.set('occurrence_date', '2026-04-01');
		form.set('paid', 'on');
		process.env.GALENE_DEMO = '1';
		try {
			expect(() =>
				guardDemoMode({
					route: { id: '/(app)/calendar' },
					request: new Request('http://localhost/calendar?/set-paid', { method: 'POST' }),
					url: new URL('http://localhost/calendar?/set-paid')
				} as RequestEvent)
			).not.toThrow();
			const result = await setPaidAction({
				request: new Request('http://localhost/calendar?/set-paid', { method: 'POST', body: form }),
				locals: { user: { id: uid() } } as App.Locals
			});
			expect(result).toEqual({ ok: true });
			expect(paidRows().map((row) => row.occurrence_date)).toEqual(['2026-04-01']);
			expect(txnCount()).toBe(0);
		} finally {
			delete process.env.GALENE_DEMO;
		}
	});
});
