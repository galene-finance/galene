/**
 * Schedule delete scopes (once / following / all). Only scheduled_* rows change;
 * transactions are never touched. Temp database only.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledInput } from './finance';

const dir = mkdtempSync(join(tmpdir(), 'galene-sched-del-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';

const { closeDbForTests, db } = await import('./db');
const { deleteScheduledScoped, getOccurrences, getScheduled, saveScheduled, scheduledDeleteFromForm } = await import(
	'./finance'
);

afterAll(() => {
	closeDbForTests();
	rmSync(dir, { recursive: true, force: true });
});

function uid(): number {
	const existing = db().query('SELECT id FROM users LIMIT 1').get() as { id: number } | null;
	if (existing) return existing.id;
	db().query(`INSERT INTO users (name, email, password_hash) VALUES ('Dev', 'dev-del@test', 'x')`).run();
	return Number((db().query('SELECT id FROM users').get() as { id: number }).id);
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

function dates(): string[] | null {
	const row = getScheduled(uid())[0];
	return row ? getOccurrences(row, '2026-01-01', '2026-12-31') : null;
}

describe('schedule delete scopes', () => {
	test('this date only skips one occurrence and keeps the series', () => {
		const id = reset();
		expect(deleteScheduledScoped(uid(), id, 'once', '2026-03-01').removed).toBe('occurrence');
		expect(dates()).toEqual(['2026-01-01', '2026-02-01', '2026-04-01', '2026-05-01', '2026-06-01']);
	});

	test('this date only on the first and last dates', () => {
		const id = reset();
		deleteScheduledScoped(uid(), id, 'once', '2026-01-01');
		deleteScheduledScoped(uid(), id, 'once', '2026-06-01');
		expect(dates()).toEqual(['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
	});

	test('skipping every remaining date removes the series', () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ untilDate: '2026-02-01' }));
		const id = getScheduled(uid())[0].id;
		deleteScheduledScoped(uid(), id, 'once', '2026-01-01');
		expect(deleteScheduledScoped(uid(), id, 'once', '2026-02-01').removed).toBe('series');
		expect(getScheduled(uid())).toHaveLength(0);
	});

	test('this and following ends the series before that date', () => {
		const id = reset();
		expect(deleteScheduledScoped(uid(), id, 'following', '2026-04-01').removed).toBe('following');
		expect(dates()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
	});

	test('this and following on the first date deletes everything', () => {
		const id = reset();
		expect(deleteScheduledScoped(uid(), id, 'following', '2026-01-01').removed).toBe('series');
		expect(getScheduled(uid())).toHaveLength(0);
	});

	test('all deletes the series', () => {
		const id = reset();
		expect(deleteScheduledScoped(uid(), id, 'all', '2026-03-01').removed).toBe('series');
		expect(getScheduled(uid())).toHaveLength(0);
	});

	test('a non-recurring item is deleted whatever the scope', () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ repeats: false, repeatInterval: null, repeatUnit: null, untilDate: null }));
		const row = getScheduled(uid())[0];
		expect(row.recurring).toBe(false);
		expect(deleteScheduledScoped(uid(), row.id, 'once', '2026-01-01').removed).toBe('series');
		expect(getScheduled(uid())).toHaveLength(0);
	});

	test('a date outside the series does not write', () => {
		const id = reset();
		expect(() => deleteScheduledScoped(uid(), id, 'once', '2026-03-15')).toThrow('That date is not part of this schedule.');
		expect(dates()).toHaveLength(6);
	});

	test('an edit to the whole series keeps a skipped date skipped', () => {
		const id = reset();
		deleteScheduledScoped(uid(), id, 'once', '2026-03-01');
		saveScheduled(uid(), input({ id, amountCents: -20000, editScope: 'all', occurrenceDate: '2026-01-01' }));
		expect(dates()).not.toContain('2026-03-01');
		expect(dates()).toHaveLength(5);
	});

	test('posted and matched transactions are not touched by any scope', () => {
		const user = uid();
		db().query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Checking', 'bank')`).run(user);
		const account = Number((db().query('SELECT max(id) AS id FROM accounts').get() as { id: number }).id);
		db()
			.query(`INSERT INTO transactions (user_id, account_id, date, amount_cents, merchant) VALUES (?, ?, '2026-03-01', -10000, 'Rent')`)
			.run(user, account);
		const snapshot = () => JSON.stringify(db().query('SELECT * FROM transactions ORDER BY id').all());
		const before = snapshot();
		let id = reset();
		deleteScheduledScoped(user, id, 'once', '2026-03-01');
		deleteScheduledScoped(user, id, 'following', '2026-02-01');
		id = reset();
		deleteScheduledScoped(user, id, 'all');
		expect(snapshot()).toBe(before);
	});

	test('form parser defaults to all and rejects bad input', () => {
		const id = reset();
		const form = new FormData();
		form.set('id', String(id));
		expect(scheduledDeleteFromForm(uid(), form)).toEqual({ id, scope: 'all', occurrenceDate: null });
		form.set('delete_scope', 'everything');
		expect(scheduledDeleteFromForm(uid(), form).error).toBe('Choose what to delete.');
		form.set('delete_scope', 'once');
		form.set('occurrence_date', '03/01/2026');
		expect(scheduledDeleteFromForm(uid(), form).error).toBe('Enter a valid occurrence date.');
		form.set('id', '999999');
		expect(scheduledDeleteFromForm(uid(), form).error).toBe('Scheduled expectation not found.');
	});
});
