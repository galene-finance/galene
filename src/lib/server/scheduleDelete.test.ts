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
const { deleteScheduledAction } = await import('./scheduledDeleteAction');

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

	test('a non-recurring item: no scope or its own date deletes it; another date is refused', () => {
		const oneTime = () => {
			db().query('DELETE FROM scheduled').run();
			saveScheduled(uid(), input({ repeats: false, repeatInterval: null, repeatUnit: null, untilDate: null }));
			return getScheduled(uid())[0];
		};
		let row = oneTime();
		expect(row.recurring).toBe(false);
		expect(() => deleteScheduledScoped(uid(), row.id, 'once', '2026-02-01')).toThrow('That date is not part of this schedule.');
		expect(getScheduled(uid())).toHaveLength(1);
		expect(deleteScheduledScoped(uid(), row.id, 'once', '2026-01-01').removed).toBe('series');
		row = oneTime();
		expect(deleteScheduledScoped(uid(), row.id, undefined).removed).toBe('series');
		expect(getScheduled(uid())).toHaveLength(0);
	});

	test('a recurring item needs a valid scope, and once/following need a date', () => {
		const id = reset();
		expect(() => deleteScheduledScoped(uid(), id, undefined)).toThrow('scope is required');
		expect(() => deleteScheduledScoped(uid(), id, '')).toThrow('scope must be once, following, or all.');
		expect(() => deleteScheduledScoped(uid(), id, 'everything')).toThrow('scope must be once, following, or all.');
		expect(() => deleteScheduledScoped(uid(), id, 'once')).toThrow('occurrence_date is required');
		expect(() => deleteScheduledScoped(uid(), id, 'following', null)).toThrow('occurrence_date is required');
		expect(() => deleteScheduledScoped(uid(), id, 'all', '2026-03-15')).toThrow('That date is not part of this schedule.');
		expect(dates()).toHaveLength(6);
	});

	test('splitting with edit scope new moves later skips to the new series (QA repro)', () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ startDate: '2026-10-25', repeatUnit: 'week', untilDate: null }));
		const oldId = getScheduled(uid())[0].id;
		deleteScheduledScoped(uid(), oldId, 'once', '2026-11-08');
		deleteScheduledScoped(uid(), oldId, 'once', '2026-11-29');
		const newId = saveScheduled(
			uid(),
			input({ id: oldId, startDate: '2026-11-22', repeatUnit: 'week', untilDate: null, amountCents: -12000, editScope: 'new', occurrenceDate: '2026-11-22' })
		);
		expect(newId).not.toBe(oldId);
		const occ = (sid: number) => {
			const row = getScheduled(uid()).find((r) => r.id === sid)!;
			return getOccurrences(row, '2026-10-01', '2026-12-31');
		};
		expect(occ(oldId)).toEqual(['2026-10-25', '2026-11-01', '2026-11-15']);
		expect(occ(newId)).toEqual(['2026-11-22', '2026-12-06', '2026-12-13', '2026-12-20', '2026-12-27']);
		const skips = db()
			.query('SELECT scheduled_id, occurrence_date FROM scheduled_exceptions WHERE skipped = 1 ORDER BY occurrence_date')
			.all();
		expect(skips).toEqual([
			{ scheduled_id: oldId, occurrence_date: '2026-11-08' },
			{ scheduled_id: newId, occurrence_date: '2026-11-29' }
		]);
	});

	test('a split carries a one-off override after the split date, not the edited date', () => {
		db().query('DELETE FROM scheduled').run();
		saveScheduled(uid(), input({ startDate: '2026-10-25', repeatUnit: 'week', untilDate: '2026-12-13' }));
		const oldId = getScheduled(uid())[0].id;
		saveScheduled(uid(), input({ id: oldId, startDate: '2026-11-22', repeatUnit: 'week', untilDate: '2026-12-13', amountCents: -1, editScope: 'once', occurrenceDate: '2026-11-22' }));
		saveScheduled(uid(), input({ id: oldId, startDate: '2026-12-06', repeatUnit: 'week', untilDate: '2026-12-13', amountCents: -2, editScope: 'once', occurrenceDate: '2026-12-06' }));
		const newId = saveScheduled(
			uid(),
			input({ id: oldId, startDate: '2026-11-22', repeatUnit: 'week', untilDate: '2026-12-13', amountCents: -500, editScope: 'new', occurrenceDate: '2026-11-22' })
		);
		const rows = db()
			.query('SELECT scheduled_id, occurrence_date, amount_cents FROM scheduled_exceptions ORDER BY occurrence_date')
			.all();
		expect(rows).toEqual([{ scheduled_id: newId, occurrence_date: '2026-12-06', amount_cents: -2 }]);
	});

	test('the delete form action is refused in demo mode and writes nothing', async () => {
		const id = reset();
		const form = new FormData();
		form.set('id', String(id));
		form.set('delete_scope', 'all');
		const request = new Request('http://localhost/scheduled?/delete-scheduled', { method: 'POST', body: form });
		process.env.GALENE_DEMO = '1';
		try {
			const result = (await deleteScheduledAction({ request, locals: { user: { id: uid() } } as App.Locals })) as { status?: number };
			expect(result.status).toBe(403);
		} finally {
			delete process.env.GALENE_DEMO;
		}
		expect(dates()).toHaveLength(6);
		const again = new Request('http://localhost/scheduled?/delete-scheduled', { method: 'POST', body: form });
		expect(await deleteScheduledAction({ request: again, locals: { user: { id: uid() } } as App.Locals })).toEqual({ ok: true, removed: 'series' });
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

	test('form parser passes scope through and rejects bad input', () => {
		const id = reset();
		const form = new FormData();
		form.set('id', String(id));
		expect(scheduledDeleteFromForm(uid(), form)).toEqual({ id, scope: undefined, occurrenceDate: null });
		form.set('delete_scope', '');
		expect(scheduledDeleteFromForm(uid(), form).scope).toBe('');
		form.set('delete_scope', 'once');
		form.set('occurrence_date', '03/01/2026');
		expect(scheduledDeleteFromForm(uid(), form).error).toBe('Enter a valid occurrence date.');
		form.set('id', '999999');
		expect(scheduledDeleteFromForm(uid(), form).error).toBe('Scheduled expectation not found.');
	});
});
