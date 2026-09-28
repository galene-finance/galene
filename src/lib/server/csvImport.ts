/**
 * Manual CSV transaction import (issue #51).
 *
 * Template columns (header row required; order flexible; unknown columns ignored):
 * - date (required) — see parseImportDate() for accepted formats
 * - account (required) — match existing name (case-insensitive), or create if opted in
 * - amount (required) — dollars; negative = expense, positive = income (zero invalid)
 * - merchant, notes — optional text
 * - category — optional; match existing or create if opted in (type from amount sign)
 * - tags — optional; semicolon- or pipe-separated; match existing or create if opted in
 *
 * Preview is held in-process keyed by previewId (single-node deploy). Commit
 * applies only rows that passed validation at preview time.
 */
import { randomBytes } from 'node:crypto';
import { db } from '$lib/server/db';
import {
	getAccounts,
	getCategories,
	getOrCreateAccount,
	getOrCreateCategory,
	getOrCreateTag,
	getTags,
	saveTransaction,
	type TransactionInput
} from '$lib/server/finance';
import { looksLikeOfx, ofxExternalId, parseOfx, type OfxTransaction } from '$lib/server/ofxImport';
import { parseAmountToCents } from '$lib/utils';

/** Manual OFX/QFX imports share the provider+external_id unique index with bank sync. */
export const OFX_IMPORT_PROVIDER = 'ofx';

export const CSV_IMPORT_TEMPLATE = `date,account,amount,merchant,notes,category,tags
2026-01-15,Checking,-12.50,Coffee shop,Morning coffee,Coffee,Fun
01/16/2026,Checking,2500.00,Employer,Paycheck,Salary,
`;

export type ImportRowStatus = 'ok' | 'error';

export interface ImportCreateOptions {
	createAccounts: boolean;
	createCategories: boolean;
	createTags: boolean;
}

export interface ImportPreviewRow {
	line: number;
	date: string;
	/** Normalized YYYY-MM-DD when parse succeeded */
	dateParsed: string | null;
	account: string;
	amount: string;
	merchant: string;
	notes: string;
	category: string;
	tags: string;
	status: ImportRowStatus;
	errors: string[];
	willCreateAccount: boolean;
	willCreateCategory: boolean;
	willCreateTags: string[];
	/** OFX/QFX only: this row matches a transaction already stored or earlier in the file. */
	duplicate?: boolean;
	/** Filled when status is ok */
	parsed?: {
		date: string;
		accountId: number | null;
		accountName: string;
		type: 'expense' | 'income';
		amountCents: number;
		merchant: string | null;
		notes: string | null;
		categoryId: number | null;
		categoryName: string | null;
		tagNames: string[];
		externalId: string | null;
	};
}

export interface ImportPreview {
	id: string;
	userId: number;
	createdAt: number;
	format: 'csv' | 'ofx';
	options: ImportCreateOptions;
	rows: ImportPreviewRow[];
	okCount: number;
	errorCount: number;
	/** Ready rows that already exist (FITID or date+amount+payee). Not imported. */
	skippedCount: number;
	createAccountNames: string[];
	createCategoryNames: string[];
	createTagNames: string[];
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const previews = new Map<string, ImportPreview>();

function prunePreviews() {
	const now = Date.now();
	for (const [id, p] of previews) {
		if (now - p.createdAt > PREVIEW_TTL_MS) previews.delete(id);
	}
}

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let i = 0;
	let inQuotes = false;
	const s = text.replace(/^\uFEFF/, '');
	while (i < s.length) {
		const c = s[i];
		if (inQuotes) {
			if (c === '"') {
				if (s[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			cell += c;
			i++;
			continue;
		}
		if (c === '"') {
			inQuotes = true;
			i++;
			continue;
		}
		if (c === ',') {
			row.push(cell);
			cell = '';
			i++;
			continue;
		}
		if (c === '\n' || c === '\r') {
			if (c === '\r' && s[i + 1] === '\n') i++;
			row.push(cell);
			cell = '';
			if (row.some((x) => x.trim() !== '')) rows.push(row);
			row = [];
			i++;
			continue;
		}
		cell += c;
		i++;
	}
	row.push(cell);
	if (row.some((x) => x.trim() !== '')) rows.push(row);
	return rows;
}

function normHeader(h: string): string {
	return h.trim().toLowerCase().replace(/\s+/g, '_');
}

const ALIASES: Record<string, string> = {
	date: 'date',
	txn_date: 'date',
	transaction_date: 'date',
	account: 'account',
	account_name: 'account',
	amount: 'amount',
	merchant: 'merchant',
	payee: 'merchant',
	description: 'merchant',
	notes: 'notes',
	memo: 'notes',
	category: 'category',
	tags: 'tags',
	tag: 'tags'
};

/**
 * Accepted date formats (normalized to YYYY-MM-DD):
 * - YYYY-MM-DD
 * - YYYY/MM/DD
 * - M/D/YYYY or MM/DD/YYYY (US)
 * - M-D-YYYY or MM-DD-YYYY (US)
 * - M/D/YY or MM/DD/YY (US, 00–69 → 2000–2069, 70–99 → 1970–1999)
 */
export function parseImportDate(raw: string): string | null {
	const s = raw.trim();
	if (!s) return null;

	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
	if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

	m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
	if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

	m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
	if (m) return ymd(Number(m[3]), Number(m[1]), Number(m[2]));

	m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/.exec(s);
	if (m) {
		const yy = Number(m[3]);
		const year = yy <= 69 ? 2000 + yy : 1900 + yy;
		return ymd(year, Number(m[1]), Number(m[2]));
	}

	return null;
}

function ymd(year: number, month: number, day: number): string | null {
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const dt = new Date(Date.UTC(year, month - 1, day));
	if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
		return null;
	}
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function buildImportPreview(
	userId: number,
	csvText: string,
	options: ImportCreateOptions
): ImportPreview | { error: string } {
	prunePreviews();
	const table = parseCsv(csvText);
	if (table.length < 2) return { error: 'CSV needs a header row and at least one data row.' };

	const header = table[0].map(normHeader);
	const col: Partial<Record<string, number>> = {};
	for (let i = 0; i < header.length; i++) {
		const key = ALIASES[header[i]];
		if (key && col[key] == null) col[key] = i;
	}
	if (col.date == null || col.account == null || col.amount == null) {
		return {
			error: 'Header must include date, account, and amount columns (see the downloadable template).'
		};
	}

	const accounts = getAccounts(userId);
	const accountByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]));
	const categories = getCategories(userId);
	const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

	const existingTags = new Set(getTags(userId).map((t) => t.name.trim().toLowerCase()));

	const rows: ImportPreviewRow[] = [];
	const createAccountNames = new Set<string>();
	const createCategoryNames = new Set<string>();
	const createTagNames = new Set<string>();

	for (let r = 1; r < table.length; r++) {
		const cells = table[r];
		const get = (k: string) => {
			const idx = col[k];
			return idx == null ? '' : String(cells[idx] ?? '').trim();
		};
		const dateRaw = get('date');
		const accountRaw = get('account');
		const amountRaw = get('amount');
		const merchantRaw = get('merchant');
		const notesRaw = get('notes');
		const categoryRaw = get('category');
		const tagsRaw = get('tags');

		const errors: string[] = [];
		const line = r + 1;

		const dateParsed = parseImportDate(dateRaw);
		if (!dateParsed) {
			errors.push(
				'date not recognized (use YYYY-MM-DD, YYYY/MM/DD, or US M/D/YYYY, MM/DD/YYYY, M-D-YYYY, MM-DD-YYYY, or 2-digit year)'
			);
		}

		const amountCents = parseAmountToCents(amountRaw);
		if (amountCents == null || amountCents === 0) {
			errors.push('amount must be a non-zero number (dollars)');
		}
		const type: 'expense' | 'income' =
			amountCents != null && amountCents < 0 ? 'expense' : 'income';

		let accountId: number | null = null;
		let willCreateAccount = false;
		if (!accountRaw) {
			errors.push('account is required');
		} else {
			const account = accountByName.get(accountRaw.toLowerCase());
			if (account) {
				accountId = account.id;
			} else if (options.createAccounts) {
				willCreateAccount = true;
				createAccountNames.add(accountRaw);
			} else {
				errors.push(`no account named "${accountRaw}" (enable Create missing accounts)`);
			}
		}

		let categoryId: number | null = null;
		let willCreateCategory = false;
		if (categoryRaw) {
			const cat = categoryByName.get(categoryRaw.toLowerCase());
			if (cat) {
				categoryId = cat.id;
			} else if (options.createCategories) {
				willCreateCategory = true;
				createCategoryNames.add(categoryRaw);
			} else {
				errors.push(`no category named "${categoryRaw}" (enable Create missing categories)`);
			}
		}

		const tagNames = tagsRaw
			? tagsRaw
					.split(/[;|]/)
					.map((t) => t.trim())
					.filter(Boolean)
			: [];
		const willCreateTags: string[] = [];
		for (const name of tagNames) {
			if (!existingTags.has(name.toLowerCase())) {
				if (options.createTags) {
					willCreateTags.push(name);
					createTagNames.add(name);
				} else {
					errors.push(`no tag named "${name}" (enable Create missing tags)`);
				}
			}
		}

		const status: ImportRowStatus = errors.length ? 'error' : 'ok';
		const previewRow: ImportPreviewRow = {
			line,
			date: dateRaw,
			dateParsed,
			account: accountRaw,
			amount: amountRaw,
			merchant: merchantRaw,
			notes: notesRaw,
			category: categoryRaw,
			tags: tagsRaw,
			status,
			errors,
			willCreateAccount,
			willCreateCategory,
			willCreateTags
		};
		if (status === 'ok' && dateParsed && amountCents != null) {
			previewRow.parsed = {
				date: dateParsed,
				accountId,
				accountName: accountRaw,
				type,
				amountCents: Math.abs(amountCents),
				merchant: merchantRaw || null,
				notes: notesRaw || null,
				categoryId,
				categoryName: categoryRaw || null,
				tagNames,
				externalId: null
			};
		}
		rows.push(previewRow);
	}

	return storePreview(userId, 'csv', options, rows, createAccountNames, createCategoryNames, createTagNames);
}

function storePreview(
	userId: number,
	format: 'csv' | 'ofx',
	options: ImportCreateOptions,
	rows: ImportPreviewRow[],
	createAccountNames: Set<string>,
	createCategoryNames: Set<string>,
	createTagNames: Set<string>
): ImportPreview {
	const id = randomBytes(16).toString('hex');
	const preview: ImportPreview = {
		id,
		userId,
		createdAt: Date.now(),
		format,
		options,
		rows,
		okCount: rows.filter((x) => x.status === 'ok' && !x.duplicate).length,
		errorCount: rows.filter((x) => x.status === 'error').length,
		skippedCount: rows.filter((x) => x.duplicate).length,
		createAccountNames: [...createAccountNames],
		createCategoryNames: [...createCategoryNames],
		createTagNames: [...createTagNames]
	};
	previews.set(id, preview);
	return preview;
}

interface ExistingTxn {
	date: string;
	amount_cents: number;
	merchant: string | null;
	external_id: string | null;
	account_id: number;
}

function loadExisting(userId: number): ExistingTxn[] {
	return db()
		.query(
			`SELECT date, amount_cents, merchant, external_id, account_id
			 FROM transactions WHERE user_id = ?`
		)
		.all(userId) as ExistingTxn[];
}

function heuristicKey(date: string, signedCents: number, merchant: string, accountKey: string): string {
	return `${accountKey}\u001f${date}\u001f${signedCents}\u001f${merchant.trim().toLowerCase()}`;
}

/**
 * OFX/QFX upload. Account names come from the statement (BANKID + ACCTID) and
 * follow the same create-if-missing rules as CSV. FITID dedupes first; rows
 * without FITID use date + signed amount + payee + account.
 */
export function buildOfxImportPreview(
	userId: number,
	text: string,
	options: ImportCreateOptions
): ImportPreview | { error: string } {
	prunePreviews();
	const parsed = parseOfx(text);
	if (parsed.error && parsed.transactions.length === 0) return { error: parsed.error };

	const accounts = getAccounts(userId);
	const accountByName = new Map(accounts.map((a) => [a.name.trim().toLowerCase(), a]));
	const accountIdToKey = new Map<number, string>();
	for (const account of accounts) {
		accountIdToKey.set(account.id, account.name.trim().toLowerCase());
	}
	const existing = loadExisting(userId);
	const seenFit = new Set(
		existing.map((row) => row.external_id).filter((id): id is string => !!id)
	);
	const seenHeuristic = new Set(
		existing.map((row) =>
			heuristicKey(
				row.date,
				row.amount_cents,
				row.merchant ?? '',
				accountIdToKey.get(row.account_id) ?? String(row.account_id)
			)
		)
	);

	const rows: ImportPreviewRow[] = [];
	const createAccountNames = new Set<string>();

	for (const tx of parsed.transactions) {
		const row = ofxPreviewRow(tx, options, accountByName, seenFit, seenHeuristic);
		if (row.willCreateAccount) createAccountNames.add(row.account);
		rows.push(row);
	}

	return storePreview(userId, 'ofx', options, rows, createAccountNames, new Set(), new Set());
}

function ofxPreviewRow(
	tx: OfxTransaction,
	options: ImportCreateOptions,
	accountByName: Map<string, { id: number; name: string }>,
	seenFit: Set<string>,
	seenHeuristic: Set<string>
): ImportPreviewRow {
	const errors: string[] = [];
	if (!tx.date) errors.push('posted date not recognized');
	if (tx.amountCents == null || tx.amountCents === 0) {
		errors.push('amount must be a non-zero number');
	}
	const type: 'expense' | 'income' = tx.amountCents != null && tx.amountCents < 0 ? 'expense' : 'income';

	let accountId: number | null = null;
	let willCreateAccount = false;
	const account = accountByName.get(tx.accountName.toLowerCase());
	if (account) {
		accountId = account.id;
	} else if (options.createAccounts) {
		willCreateAccount = true;
		// Caller collects names after the row is built.
	} else {
		errors.push(`no account named "${tx.accountName}" (enable Create missing accounts)`);
	}

	const externalId = ofxExternalId(tx);
	const signed = tx.amountCents ?? 0;
	const heuristic = tx.date ? heuristicKey(tx.date, signed, tx.merchant, tx.accountKey) : null;

	let duplicate = false;
	if (errors.length === 0) {
		if (externalId && seenFit.has(externalId)) duplicate = true;
		else if (!externalId && heuristic && seenHeuristic.has(heuristic)) duplicate = true;
		if (!duplicate) {
			if (externalId) seenFit.add(externalId);
			if (heuristic) seenHeuristic.add(heuristic);
		}
	}

	const status: ImportRowStatus = errors.length ? 'error' : 'ok';
	const row: ImportPreviewRow = {
		line: tx.line,
		date: tx.dateRaw,
		dateParsed: tx.date,
		account: tx.accountName,
		amount: tx.amountRaw,
		merchant: tx.merchant,
		notes: tx.notes,
		category: '',
		tags: '',
		status,
		errors,
		willCreateAccount,
		willCreateCategory: false,
		willCreateTags: [],
		duplicate
	};
	if (status === 'ok' && tx.date && tx.amountCents != null) {
		row.parsed = {
			date: tx.date,
			accountId,
			accountName: tx.accountName,
			type,
			amountCents: Math.abs(tx.amountCents),
			merchant: tx.merchant || null,
			notes: tx.notes || null,
			categoryId: null,
			categoryName: null,
			tagNames: [],
			externalId
		};
	}
	return row;
}

/** Route a CSV or OFX/QFX upload into the shared preview store. */
export function buildFileImportPreview(
	userId: number,
	text: string,
	filename: string,
	options: ImportCreateOptions
): ImportPreview | { error: string } {
	if (looksLikeOfx(text, filename)) return buildOfxImportPreview(userId, text, options);
	return buildImportPreview(userId, text, options);
}


export function getImportPreview(userId: number, id: string): ImportPreview | null {
	prunePreviews();
	const p = previews.get(id);
	if (!p || p.userId !== userId) return null;
	return p;
}

export function dropImportPreview(userId: number, id: string) {
	const p = previews.get(id);
	if (p && p.userId === userId) previews.delete(id);
}

export function commitImportPreview(
	userId: number,
	id: string
): { error: string } | { created: number; skipped: number; failed: number } {
	const preview = getImportPreview(userId, id);
	if (!preview) return { error: 'Preview expired or not found. Upload the file again.' };

	let created = 0;
	let skipped = 0;
	let failed = 0;
	for (const row of preview.rows) {
		if (row.duplicate || row.status !== 'ok' || !row.parsed) {
			skipped++;
			continue;
		}
		try {
			let accountId = row.parsed.accountId;
			if (accountId == null) {
				if (!preview.options.createAccounts) {
					failed++;
					continue;
				}
				accountId = getOrCreateAccount(userId, row.parsed.accountName);
			}

			if (row.parsed.externalId) {
				const clash = db()
					.query(
						'SELECT id FROM transactions WHERE user_id = ? AND provider = ? AND external_id = ?'
					)
					.get(userId, OFX_IMPORT_PROVIDER, row.parsed.externalId) as { id: number } | undefined;
				if (clash) {
					skipped++;
					continue;
				}
			}

			let categoryId = row.parsed.categoryId;
			if (categoryId == null && row.parsed.categoryName) {
				if (!preview.options.createCategories) {
					failed++;
					continue;
				}
				categoryId = getOrCreateCategory(userId, row.parsed.categoryName, row.parsed.type);
			}

			const tagIds: number[] = [];
			if (preview.options.createTags) {
				for (const name of row.parsed.tagNames) {
					tagIds.push(getOrCreateTag(userId, name));
				}
			} else {
				const byName = new Map(getTags(userId).map((t) => [t.name.trim().toLowerCase(), t.id]));
				for (const name of row.parsed.tagNames) {
					const id = byName.get(name.toLowerCase());
					if (id != null) tagIds.push(id);
				}
			}

			const input: TransactionInput = {
				type: row.parsed.type,
				amountCents: row.parsed.amountCents,
				date: row.parsed.date,
				account: accountId,
				category: categoryId,
				merchant: row.parsed.merchant,
				notes: row.parsed.notes,
				color: null,
				tags: tagIds
			};
			saveTransaction(userId, input);
			if (row.parsed.externalId && input.id) {
				db()
					.query('UPDATE transactions SET provider = ?, external_id = ? WHERE id = ? AND user_id = ?')
					.run(OFX_IMPORT_PROVIDER, row.parsed.externalId, input.id, userId);
			}
			created++;
		} catch {
			failed++;
		}
	}
	previews.delete(id);
	return { created, skipped, failed };
}
