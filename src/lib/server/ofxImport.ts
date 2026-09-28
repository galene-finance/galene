/**
 * OFX / QFX statement parser (issue #105).
 *
 * Focused SGML/XML reader for bank and credit-card STMTTRN blocks.
 * Investment positions, securities, and 401k lots are ignored.
 * QFX is the same grammar with a different extension.
 */
import { parseAmountToCents } from '$lib/utils';

export interface OfxTransaction {
	/** 1-based source line of the STMTTRN open tag */
	line: number;
	fitId: string | null;
	/** YYYY-MM-DD when DTPOSTED parsed */
	date: string | null;
	dateRaw: string;
	/** Signed cents: expense negative, income positive. Null when TRNAMT is unusable. */
	amountCents: number | null;
	amountRaw: string;
	merchant: string;
	notes: string;
	/** Account label from BANKID + ACCTID, or ACCTID alone */
	accountName: string;
	accountKey: string;
	trntype: string;
}

export interface OfxParseResult {
	transactions: OfxTransaction[];
	/** File-level problem. Partial transactions may still be present. */
	error: string | null;
}

function decodeEntities(value: string): string {
	return value
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'");
}

/** OFX DTPOSTED / DTUSER: YYYYMMDD or YYYYMMDDHHMMSS[.fff][tz]. */
export function parseOfxDate(raw: string): string | null {
	const digits = raw.trim().replace(/[^0-9]/g, '');
	if (digits.length < 8) return null;
	const year = Number(digits.slice(0, 4));
	const month = Number(digits.slice(4, 6));
	const day = Number(digits.slice(6, 8));
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const dt = new Date(Date.UTC(year, month - 1, day));
	if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
		return null;
	}
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === '\n') line++;
	}
	return line;
}

interface Slice {
	start: number;
	end: number;
	bodyStart: number;
	bodyEnd: number;
}

function findSlices(text: string, tagName: string): Slice[] {
	const name = tagName.toUpperCase();
	const out: Slice[] = [];
	const openRe = new RegExp(`<${name}(?:\\s[^>]*)?>`, 'gi');
	const closeRe = new RegExp(`</${name}\\s*>`, 'gi');
	let match: RegExpExecArray | null;
	while ((match = openRe.exec(text))) {
		const openEnd = match.index + match[0].length;
		closeRe.lastIndex = openEnd;
		const close = closeRe.exec(text);
		if (!close) {
			out.push({ start: match.index, end: text.length, bodyStart: openEnd, bodyEnd: text.length });
			break;
		}
		out.push({ start: match.index, end: close.index + close[0].length, bodyStart: openEnd, bodyEnd: close.index });
		openRe.lastIndex = close.index + close[0].length;
	}
	return out;
}

/** SGML tag value: `<NAME>value` until the next tag or newline. */
function tagValue(block: string, tagName: string): string {
	const re = new RegExp(`<${tagName}>([^<\\r\\n]*)`, 'i');
	const match = re.exec(block);
	return match ? decodeEntities(match[1].trim()) : '';
}

function accountLabel(stmtrs: string, fallbackIndex: number): { name: string; key: string } {
	const from = stmtrs.search(/<(BANKACCTFROM|CCACCTFROM)\b/i);
	const chunk = from >= 0 ? stmtrs.slice(from, from + 800) : '';
	const bankId = tagValue(chunk, 'BANKID');
	const acctId = tagValue(chunk, 'ACCTID');
	const parts = [bankId, acctId].filter(Boolean);
	if (parts.length === 0) {
		const name = `OFX account ${fallbackIndex}`;
		return { name, key: name.toLowerCase() };
	}
	const name = parts.join(' ');
	return { name, key: name.toLowerCase() };
}

function merchantOf(name: string, memo: string, trntype: string): { merchant: string; notes: string } {
	const payee = name.trim();
	const note = memo.trim();
	if (payee) return { merchant: payee, notes: note };
	if (note) return { merchant: note, notes: '' };
	return { merchant: trntype.trim(), notes: '' };
}

/**
 * Parse an OFX 1.x (SGML) or OFX 2.x (XML) bank/credit statement.
 * Returns a calm file-level error when the body has no statement transactions.
 */
export function parseOfx(text: string): OfxParseResult {
	const body = text.replace(/^\uFEFF/, '');
	if (!/<OFX[\s>]/i.test(body) && !/<STMTTRN[\s>]/i.test(body)) {
		return { transactions: [], error: 'This file is not an OFX or QFX statement.' };
	}

	const responses = findSlices(body, 'STMTRS').concat(findSlices(body, 'CCSTMTRS'));
	const scopes = responses.length
		? responses.map((slice, index) => ({
				text: body.slice(slice.bodyStart, slice.bodyEnd),
				base: slice.bodyStart,
				accountIndex: index + 1
			}))
		: [{ text: body, base: 0, accountIndex: 1 }];

	const transactions: OfxTransaction[] = [];
	for (const scope of scopes) {
		const account = accountLabel(scope.text, scope.accountIndex);
		const rows = findSlices(scope.text, 'STMTTRN');
		for (const row of rows) {
			const block = scope.text.slice(row.bodyStart, row.bodyEnd);
			const amountRaw = tagValue(block, 'TRNAMT');
			const dateRaw = tagValue(block, 'DTPOSTED') || tagValue(block, 'DTUSER');
			const name = tagValue(block, 'NAME');
			const memo = tagValue(block, 'MEMO');
			const fitId = tagValue(block, 'FITID');
			const trntype = tagValue(block, 'TRNTYPE');
			const payee = merchantOf(name, memo, trntype);
			const amountCents = amountRaw ? parseAmountToCents(amountRaw) : null;
			transactions.push({
				line: lineAt(body, scope.base + row.start),
				fitId: fitId || null,
				date: dateRaw ? parseOfxDate(dateRaw) : null,
				dateRaw,
				amountCents,
				amountRaw,
				merchant: payee.merchant,
				notes: payee.notes,
				accountName: account.name,
				accountKey: account.key,
				trntype
			});
		}
	}

	if (transactions.length === 0) {
		if (/<(INVSTMTRS|SECLIST|INVPOS)\b/i.test(body)) {
			return {
				transactions: [],
				error: 'This file has investment data, which this import does not read. Export a bank or credit-card statement instead.'
			};
		}
		return {
			transactions: [],
			error: 'No bank or credit-card transactions found in this file.'
		};
	}

	return { transactions, error: null };
}

/** Stable dedupe key: FITID scoped to the statement account when both exist. */
export function ofxExternalId(tx: Pick<OfxTransaction, 'fitId' | 'accountKey'>): string | null {
	if (!tx.fitId) return null;
	return `${tx.accountKey}\u001f${tx.fitId}`;
}

/** True when the text looks like OFX/QFX rather than CSV. */
export function looksLikeOfx(text: string, filename = ''): boolean {
	const name = filename.trim().toLowerCase();
	if (name.endsWith('.ofx') || name.endsWith('.qfx')) return true;
	const head = text.slice(0, 4000);
	return /<OFX[\s>]/i.test(head) || /OFXHEADER:/i.test(head) || /<STMTTRN[\s>]/i.test(head);
}
