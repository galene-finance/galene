/**
 * OFX preview + confirm (issue #105). Temp database only.
 */
import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'galene-ofx-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';

const { migrate } = await import('./db');
const { buildFileImportPreview, buildImportPreview, commitImportPreview } = await import('./csvImport');

const database = new Database(process.env.GALENE_DB_PATH);
database.exec('PRAGMA foreign_keys = ON;');
migrate(database);

afterEach(() => {
	database.exec('DELETE FROM transactions; DELETE FROM categorization_rules; DELETE FROM categories; DELETE FROM accounts; DELETE FROM users;');
});

const SAMPLE = `<OFX><STMTRS>
<BANKACCTFROM><BANKID>021000021</BANKID><ACCTID>123456789</ACCTID></BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260315</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>coffee-1</FITID><NAME>Coffee shop</NAME><MEMO>Morning</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260316</DTPOSTED><TRNAMT>2500.00</TRNAMT><FITID>pay-1</FITID><NAME>Employer</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>nope</DTPOSTED><TRNAMT>-5.00</TRNAMT><FITID>bad</FITID><NAME>Broken</NAME></STMTTRN>
</BANKTRANLIST>
</STMTRS></OFX>`;

const NO_FIT = `<OFX><STMTRS>
<BANKACCTFROM><ACCTID>Checking</ACCTID></BANKACCTFROM>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260401</DTPOSTED><TRNAMT>-8.00</TRNAMT><NAME>Bakery</NAME></STMTTRN>
</STMTRS></OFX>`;

function user(): number {
	database.query(`INSERT INTO users (name, email, password_hash, is_admin) VALUES ('Dev', 'dev@test', 'x', 1)`).run();
	return Number((database.query('SELECT id FROM users').get() as { id: number }).id);
}

const off = { createAccounts: false, createCategories: false, createTags: false };
const createAcct = { createAccounts: true, createCategories: false, createTags: false };

describe('OFX import preview', () => {
	test('unknown account is an error until create-if-missing is on', () => {
		const userId = user();
		const blocked = buildFileImportPreview(userId, SAMPLE, 'bank.ofx', off);
		expect('error' in blocked).toBe(false);
		if ('error' in blocked) return;
		expect(blocked.format).toBe('ofx');
		expect(blocked.okCount).toBe(0);
		expect(blocked.errorCount).toBe(3);
		expect(blocked.createAccountNames).toEqual([]);
		expect(blocked.rows[0].errors.join(' ')).toMatch(/no account named/);

		const open = buildFileImportPreview(userId, SAMPLE, 'bank.ofx', createAcct);
		if ('error' in open) throw new Error(open.error);
		expect(open.okCount).toBe(2);
		expect(open.errorCount).toBe(1);
		expect(open.skippedCount).toBe(0);
		expect(open.createAccountNames).toEqual(['021000021 123456789']);
		expect(open.rows[0].parsed?.type).toBe('expense');
		expect(open.rows[0].parsed?.amountCents).toBe(1250);
		expect(open.rows[1].parsed?.type).toBe('income');
		expect(open.rows[2].status).toBe('error');
	});

	test('confirm writes FITID rows and a second preview skips them', () => {
		const userId = user();
		const first = buildFileImportPreview(userId, SAMPLE, 'bank.ofx', createAcct);
		if ('error' in first) throw new Error(first.error);
		const committed = commitImportPreview(userId, first.id);
		expect(committed).toEqual({ created: 2, skipped: 1, failed: 0 });

		const rows = database
			.query('SELECT date, amount_cents, merchant, provider, external_id FROM transactions ORDER BY date')
			.all() as { date: string; amount_cents: number; merchant: string; provider: string; external_id: string }[];
		expect(rows).toEqual([
			{
				date: '2026-03-15',
				amount_cents: -1250,
				merchant: 'Coffee shop',
				provider: 'ofx',
				external_id: '021000021 123456789\u001fcoffee-1'
			},
			{
				date: '2026-03-16',
				amount_cents: 250000,
				merchant: 'Employer',
				provider: 'ofx',
				external_id: '021000021 123456789\u001fpay-1'
			}
		]);

		const again = buildFileImportPreview(userId, SAMPLE, 'bank.qfx', createAcct);
		if ('error' in again) throw new Error(again.error);
		expect(again.skippedCount).toBe(2);
		expect(again.okCount).toBe(0);
		expect(again.rows.filter((row) => row.duplicate)).toHaveLength(2);
		const second = commitImportPreview(userId, again.id);
		expect(second).toEqual({ created: 0, skipped: 3, failed: 0 });
		expect((database.query('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(2);
	});

	test('rows without FITID dedupe on date, amount, payee, and account', () => {
		const userId = user();
		const first = buildFileImportPreview(userId, NO_FIT, 'stmt.ofx', createAcct);
		if ('error' in first) throw new Error(first.error);
		expect(commitImportPreview(userId, first.id)).toMatchObject({ created: 1 });
		const again = buildFileImportPreview(userId, NO_FIT, 'stmt.ofx', createAcct);
		if ('error' in again) throw new Error(again.error);
		expect(again.skippedCount).toBe(1);
		expect(again.okCount).toBe(0);
	});

	test('an existing account name matches without creating another', () => {
		const userId = user();
		database.query(`INSERT INTO accounts (user_id, name, type) VALUES (?, 'Checking', 'bank')`).run(userId);
		const preview = buildFileImportPreview(userId, NO_FIT, 'stmt.qfx', off);
		if ('error' in preview) throw new Error(preview.error);
		expect(preview.okCount).toBe(1);
		expect(preview.createAccountNames).toEqual([]);
		expect(preview.rows[0].willCreateAccount).toBe(false);
	});

	test('categorization rules run on confirmed OFX rows', () => {
		const userId = user();
		database.query(`INSERT INTO categories (user_id, name, type) VALUES (?, 'Coffee', 'expense')`).run(userId);
		const categoryId = Number((database.query('SELECT id FROM categories').get() as { id: number }).id);
		database
			.query(
				`INSERT INTO categorization_rules (user_id, name, conditions, category_id, priority, enabled)
				 VALUES (?, 'Coffee shops', ?, ?, 0, 1)`
			)
			.run(userId, JSON.stringify([{ field: 'merchant', op: 'contains', value: 'coffee' }]), categoryId);

		const preview = buildFileImportPreview(userId, SAMPLE, 'bank.ofx', createAcct);
		if ('error' in preview) throw new Error(preview.error);
		commitImportPreview(userId, preview.id);
		const coffee = database
			.query(`SELECT category_id FROM transactions WHERE merchant = 'Coffee shop'`)
			.get() as { category_id: number };
		expect(coffee.category_id).toBe(categoryId);
	});

	test('CSV preview still requires the template columns', () => {
		const userId = user();
		const csv = buildImportPreview(
			userId,
			'date,account,amount,merchant\n2026-01-15,Checking,-12.50,Cafe\n',
			createAcct
		);
		expect('error' in csv).toBe(false);
		if ('error' in csv) return;
		expect(csv.format).toBe('csv');
		expect(csv.okCount).toBe(1);
		expect(csv.rows[0].parsed?.externalId).toBeNull();

		const missing = buildFileImportPreview(userId, 'hello\n', 'notes.csv', off);
		expect(missing).toEqual({ error: 'CSV needs a header row and at least one data row.' });
	});

	test('a bad file is a file-level error and does not invent rows', () => {
		const userId = user();
		expect(buildFileImportPreview(userId, 'not a statement', 'bank.ofx', createAcct)).toEqual({
			error: 'This file is not an OFX or QFX statement.'
		});
	});
});
