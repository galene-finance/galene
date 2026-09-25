import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { db } from './db';
import type { Transaction } from '$lib/types';
import { audit, type GrantScope } from './advisor';

function packVersion(): { version: string; commit: string | null } {
	try {
		const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
			version?: string;
		};
		return { version: pkg.version ?? '0', commit: process.env.VITE_GIT_COMMIT || null };
	} catch {
		return { version: '0', commit: null };
	}
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function dosDate(d: Date): { time: number; date: number } {
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
	const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	return { time, date };
}

/** Store uncompressed text files in a zip. No external archive dependency. */
export function zipStore(files: { name: string; data: Buffer }[]): Buffer {
	const parts: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	const now = dosDate(new Date());
	for (const file of files) {
		const name = Buffer.from(file.name, 'utf8');
		const raw = file.data;
		const compressed = deflateRawSync(raw);
		const useDeflate = compressed.length < raw.length;
		const payload = useDeflate ? compressed : raw;
		const crc = crc32(raw);
		const local = Buffer.alloc(30 + name.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(useDeflate ? 8 : 0, 8);
		local.writeUInt16LE(now.time, 10);
		local.writeUInt16LE(now.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(payload.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		name.copy(local, 30);
		parts.push(local, payload);

		const cen = Buffer.alloc(46 + name.length);
		cen.writeUInt32LE(0x02014b50, 0);
		cen.writeUInt16LE(20, 4);
		cen.writeUInt16LE(20, 6);
		cen.writeUInt16LE(0, 8);
		cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
		cen.writeUInt16LE(now.time, 12);
		cen.writeUInt16LE(now.date, 14);
		cen.writeUInt32LE(crc, 16);
		cen.writeUInt32LE(payload.length, 20);
		cen.writeUInt32LE(raw.length, 24);
		cen.writeUInt16LE(name.length, 28);
		cen.writeUInt16LE(0, 30);
		cen.writeUInt16LE(0, 32);
		cen.writeUInt16LE(0, 34);
		cen.writeUInt16LE(0, 36);
		cen.writeUInt32LE(0, 38);
		cen.writeUInt32LE(offset, 42);
		name.copy(cen, 46);
		central.push(cen);
		offset += local.length + payload.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);
	return Buffer.concat([...parts, centralBuf, end]);
}

function cents(n: number): string {
	const sign = n < 0 ? '-' : '';
	const abs = Math.abs(n);
	return `${sign}${(abs / 100).toFixed(2)}`;
}

interface PackTxn extends Transaction {
	account_name: string;
	category_name: string | null;
}

/**
 * Balances are the ledger through `dateTo` (end of the grant range), not
 * "as of generation time". Transactions dated after dateTo are excluded.
 */
export function buildPackFiles(scope: GrantScope, generatedAt: string): { name: string; data: Buffer }[] {
	const accountClause =
		scope.accountIds.length > 0 ? ` AND t.account_id IN (${scope.accountIds.map(() => '?').join(',')})` : '';
	const accountParams = scope.accountIds;
	const txns = db()
		.query(
			`SELECT t.id, t.account_id, t.category_id, t.date, t.amount_cents, t.merchant, t.notes, t.color,
			        a.name AS account_name, c.name AS category_name
			 FROM transactions t
			 JOIN accounts a ON a.id = t.account_id
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?${accountClause}
			 ORDER BY t.date, t.id`
		)
		.all(scope.userId, scope.dateFrom, scope.dateTo, ...accountParams) as PackTxn[];

	const accountFilter =
		scope.accountIds.length > 0 ? ` AND a.id IN (${scope.accountIds.map(() => '?').join(',')})` : '';
	const accounts = db()
		.query(
			`SELECT a.id, a.name, a.type,
			        COALESCE(a.opening_balance_cents, 0) + COALESCE((
			          SELECT SUM(t.amount_cents) FROM transactions t
			          WHERE t.account_id = a.id AND t.user_id = a.user_id
			            AND t.date <= ?
			            AND (a.opening_as_of IS NULL OR t.date >= a.opening_as_of)
			        ), 0) AS balance_cents
			 FROM accounts a
			 WHERE a.user_id = ?${accountFilter}
			 ORDER BY a.name`
		)
		.all(scope.dateTo, scope.userId, ...scope.accountIds) as {
		id: number;
		name: string;
		type: string;
		balance_cents: number;
	}[];

	const rollup = db()
		.query(
			`SELECT COALESCE(c.name, 'Uncategorized') AS category,
			        COALESCE(c.type, '') AS type,
			        COALESCE(SUM(t.amount_cents), 0) AS amount_cents,
			        COUNT(*) AS n
			 FROM transactions t
			 LEFT JOIN categories c ON c.id = t.category_id
			 WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?${accountClause}
			 GROUP BY c.id
			 ORDER BY amount_cents`
		)
		.all(scope.userId, scope.dateFrom, scope.dateTo, ...accountParams) as {
		category: string;
		type: string;
		amount_cents: number;
		n: number;
	}[];

	const csv = transactionsToPackCsv(txns);
	const accountsCsv = [
		'name,type,balance_as_of_range_end',
		...accounts.map((a) => `${csvCell(a.name)},${csvCell(a.type)},${cents(Math.round(a.balance_cents))}`)
	].join('\n') + '\n';

	const rows = rollup
		.map(
			(r) =>
				`<tr><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.type || '—')}</td><td>${r.n}</td><td>${cents(Math.round(r.amount_cents))}</td></tr>`
		)
		.join('');
	const summary = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Accountant pack ${escapeHtml(scope.dateFrom)} – ${escapeHtml(scope.dateTo)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}</style>
</head><body>
<h1>Category summary</h1>
<p>Range ${escapeHtml(scope.dateFrom)} through ${escapeHtml(scope.dateTo)}. Account balances in accounts.csv are the ledger through the end of this range.</p>
<table><thead><tr><th>Category</th><th>Type</th><th>Count</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>
`;

	const manifest = {
		generated_at: generatedAt,
		range: { from: scope.dateFrom, to: scope.dateTo },
		account_ids: scope.accountIds,
		balances: 'ledger through date_to (end of range), not generation time',
		app_version: packVersion().version,
		commit: packVersion().commit,
		files: ['transactions.csv', 'accounts.csv', 'summary.html', 'manifest.json']
	};

	return [
		{ name: 'transactions.csv', data: Buffer.from(csv, 'utf8') },
		{ name: 'accounts.csv', data: Buffer.from(accountsCsv, 'utf8') },
		{ name: 'summary.html', data: Buffer.from(summary, 'utf8') },
		{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') }
	];
}

export function buildPackZip(scope: GrantScope, generatedAt: string): Buffer {
	return zipStore(buildPackFiles(scope, generatedAt));
}

function csvField(value: string): string {
	if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function transactionsToPackCsv(rows: PackTxn[]): string {
	const header = 'date,account,amount,merchant,notes,category';
	const lines = rows.map((t) =>
		[
			csvField(t.date),
			csvField(t.account_name ?? ''),
			csvField(cents(t.amount_cents)),
			csvField(t.merchant ?? ''),
			csvField(t.notes ?? ''),
			csvField(t.category_name ?? '')
		].join(',')
	);
	return [header, ...lines].join('\n') + '\n';
}

function csvCell(value: string): string {
	if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
	return value;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function savePack(scope: GrantScope, zip: Buffer) {
	db()
		.query(
			`INSERT INTO advisor_packs (grant_id, user_id, zip) VALUES (?, ?, ?)
			 ON CONFLICT(grant_id) DO UPDATE SET zip = excluded.zip, created_at = datetime('now')`
		)
		.run(scope.grantId, scope.userId, zip);
	audit(scope.userId, scope.grantId, 'pack_generated');
}

export function loadPack(userId: number, grantId: number): Buffer | null {
	const row = db()
		.query('SELECT zip FROM advisor_packs WHERE user_id = ? AND grant_id = ?')
		.get(userId, grantId) as { zip: Uint8Array } | null;
	if (!row) return null;
	return Buffer.from(row.zip);
}
