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
import { parseAmountToCents } from '$lib/utils';

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
	};
}

export interface ImportPreview {
	id: string;
	userId: number;
	createdAt: number;
	options: ImportCreateOptions;
	rows: ImportPreviewRow[];
	okCount: number;
	errorCount: number;
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
				tagNames
			};
		}
		rows.push(previewRow);
	}

	const id = randomBytes(16).toString('hex');
	const preview: ImportPreview = {
		id,
		userId,
		createdAt: Date.now(),
		options,
		rows,
		okCount: rows.filter((x) => x.status === 'ok').length,
		errorCount: rows.filter((x) => x.status === 'error').length,
		createAccountNames: [...createAccountNames],
		createCategoryNames: [...createCategoryNames],
		createTagNames: [...createTagNames]
	};
	previews.set(id, preview);
	return preview;
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
		if (row.status !== 'ok' || !row.parsed) {
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
			created++;
		} catch {
			failed++;
		}
	}
	previews.delete(id);
	return { created, skipped, failed };
}
