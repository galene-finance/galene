/**
 * Schedule edit scopes. Occurrences are expanded from the series; they are not
 * materialized as transactions. Temp database only.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledInput } from './finance';

const dir = mkdtempSync(join(tmpdir(), 'galene-sched-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';

const { closeDbForTests, db } = await import('./db');
const { expandScheduled, getOccurrences, getScheduled, saveScheduled, scheduledInputFromForm } = await import(
	'./finance'
);

afterAll(() => {
	closeDbForTests();
	rmSync(dir, { recursive: true, force: true });
});

function uid(): number {
	const existing = db().query('SELECT id FROM users LIMIT 1').get() as { id: number } | null;
	if (existing) return existing.id;
	db().query(`INSERT INTO users (name, email, password_hash) VALUES ('Dev', 'dev-sched@test', 'x')`).run();
	return Number((db().query('SELECT id FROM users').get() as { id: number }).id);
}

function baseInput(over: Partial<ScheduledInput> = {}): ScheduledInput {
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
		untilDate: null,
		forecastBehavior: 'bill',
		tags: [],
		...over
	};
}

function series() {
	return getScheduled(uid()).map((s) => ({
		id: s.id,
		amount: s.amount_cents,
		start: s.start_date,
		until: s.until_date,
		dates: expandScheduled(s, '2026-01-01', '2026-08-01').map((o) => ({
			date: o.date,
			amount: o.scheduled.amount_cents,
			id: o.scheduled.id
		}))
	}));
}

function reset() {
	db().query('DELETE FROM scheduled').run();
}

describe('schedule edit scopes', () => {
	test('until date is inclusive and does not emit the next interval', () => {
		reset();
		saveScheduled(uid(), baseInput({ untilDate: '2026-03-01' }));
		const row = getScheduled(uid())[0];
		expect(getOccurrences(row, '2026-01-01', '2026-06-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
	});

	test('missing scope does not write', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const form = new FormData();
		form.set('id', String(getScheduled(uid())[0].id));
		form.set('name', 'Rent');
		form.set('amount', '250.00');
		form.set('start_date', '2026-01-01');
		form.set('type', 'expense');
		form.set('repeats', '1');
		form.set('repeat_interval', '1');
		form.set('repeat_unit', 'month');
		const parsed = scheduledInputFromForm(uid(), form);
		expect(parsed.error).toBe('Choose how to apply this change.');
		expect(parsed.input).toBeUndefined();
		expect(series()[0].amount).toBe(-10000);
	});

	test('a date that is not an occurrence does not write', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const id = getScheduled(uid())[0].id;
		expect(() =>
			saveScheduled(uid(), baseInput({ id, amountCents: -20000, editScope: 'once', occurrenceDate: '2026-01-15' }))
		).toThrow('That date is not part of this schedule.');
		expect(series()[0].amount).toBe(-10000);
		expect(series()[0].dates.every((d) => d.amount === -10000)).toBe(true);
	});

	test('just this date changes one occurrence', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const id = getScheduled(uid())[0].id;
		saveScheduled(
			uid(),
			baseInput({ id, name: 'Rent adjusted', amountCents: -12000, editScope: 'once', occurrenceDate: '2026-04-01' })
		);
		const rows = series();
		expect(rows).toHaveLength(1);
		expect(rows[0].dates.find((d) => d.date === '2026-04-01')?.amount).toBe(-12000);
		expect(rows[0].dates.find((d) => d.date === '2026-03-01')?.amount).toBe(-10000);
		expect(rows[0].dates.find((d) => d.date === '2026-05-01')?.amount).toBe(-10000);
		expect(getScheduled(uid())[0].amount_cents).toBe(-10000);
	});

	test('this date and everything after keeps earlier occurrences', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const id = getScheduled(uid())[0].id;
		saveScheduled(
			uid(),
			baseInput({
				id,
				amountCents: -15000,
				editScope: 'following',
				occurrenceDate: '2026-06-01',
				repeatInterval: 1,
				repeatUnit: 'week'
			})
		);
		const rows = series();
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(id);
		expect(rows[0].dates.find((d) => d.date === '2026-05-01')?.amount).toBe(-10000);
		expect(rows[0].dates.find((d) => d.date === '2026-06-01')?.amount).toBe(-15000);
		expect(rows[0].dates.find((d) => d.date === '2026-06-08')?.amount).toBe(-15000);
		expect(rows[0].dates.find((d) => d.date === '2026-07-01')).toBeUndefined();
		expect(getScheduled(uid())[0].amount_cents).toBe(-10000);
	});

	test('whole series updates past and future occurrences', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const id = getScheduled(uid())[0].id;
		saveScheduled(uid(), baseInput({ id, amountCents: -8000, editScope: 'all', occurrenceDate: '2026-06-01' }));
		const rows = series();
		expect(rows).toHaveLength(1);
		expect(rows[0].dates.every((d) => d.amount === -8000)).toBe(true);
		expect(rows[0].dates.map((d) => d.date)).toContain('2026-01-01');
		expect(rows[0].dates.map((d) => d.date)).toContain('2026-08-01');
	});

	test('new series ends the old one before this date', () => {
		reset();
		saveScheduled(uid(), baseInput());
		const id = getScheduled(uid())[0].id;
		saveScheduled(
			uid(),
			baseInput({ id, name: 'Rent new', amountCents: -17500, editScope: 'new', occurrenceDate: '2026-06-01' })
		);
		const rows = series();
		expect(rows).toHaveLength(2);
		const oldRow = rows.find((r) => r.id === id)!;
		const created = rows.find((r) => r.id !== id)!;
		expect(oldRow.until).toBe('2026-05-31');
		expect(oldRow.dates.map((d) => d.date)).toEqual([
			'2026-01-01',
			'2026-02-01',
			'2026-03-01',
			'2026-04-01',
			'2026-05-01'
		]);
		expect(oldRow.dates.every((d) => d.amount === -10000)).toBe(true);
		expect(created.start).toBe('2026-06-01');
		expect(created.dates[0]).toEqual({ date: '2026-06-01', amount: -17500, id: created.id });
		expect(created.dates.every((d) => d.amount === -17500)).toBe(true);
		expect(created.dates.map((d) => d.date)).not.toContain('2026-05-01');
	});
});
