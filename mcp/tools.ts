import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

function ok(data: unknown) {
	return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
	return {
		content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
		isError: true
	};
}

export function createGaleneServer(base: string, token: string, version: string) {
	async function get(path: string, params?: Record<string, string | undefined>): Promise<unknown> {
		const url = new URL(path, base);
		for (const [k, v] of Object.entries(params ?? {})) {
			if (v !== undefined && v !== '') url.searchParams.set(k, v);
		}
		const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
		const text = await res.text();
		if (!res.ok) throw new Error(`Galene API ${res.status}: ${text.slice(0, 300)}`);
		return JSON.parse(text);
	}

	const server = new McpServer({ name: 'galene', version });

	server.tool(
		'galene_version',
		'Which Galene server version is running: app version, git commit, and build date. Call it when you need to know what the server is running.',
		{},
		async () => {
			try {
				return ok(await get('/version'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_summary',
		'Overall financial snapshot: total balance, current-month income and expense, recent transactions, top spending categories. Amounts are integer cents.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/summary'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_accounts',
		'All accounts with their current balances (integer cents). Use the ids here to filter galene_transactions.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/accounts'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_transactions',
		'Search transactions. All filters are optional; combine freely. Returns up to `limit` most recent matches (newest first). Amounts are integer cents (negative = expense).',
		{
			date_from: z.string().optional().describe('Start date, YYYY-MM-DD (inclusive).'),
			date_to: z.string().optional().describe('End date, YYYY-MM-DD (inclusive).'),
			account: z
				.string()
				.optional()
				.describe('Comma-separated account ids from galene_accounts.'),
			category: z.string().optional().describe('Comma-separated category ids from galene_categories.'),
			q: z.string().optional().describe('Text to match in the merchant or notes.'),
			limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50).')
		},
		async (args) => {
			try {
				return ok(
					await get('/api/v1/transactions', {
						date_from: args.date_from,
						date_to: args.date_to,
						account: args.account,
						category: args.category,
						q: args.q,
						page_size: args.limit ? String(args.limit) : '50'
					})
				);
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_budgets',
		'Budgets (per-category week/month/year limits) with spend in the current period. spent_cents exceeds limit_cents when the budget is over.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/budgets'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_scheduled',
		'Scheduled expectations: recurring bills, income, and one-off planned items, with their amounts, categories, and repeat rules.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/scheduled'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_categories',
		'Expense and income categories. Use the ids here to filter galene_transactions.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/categories'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	server.tool(
		'galene_notifications',
		'App notifications: sync failures/recoveries, budget overruns, and bills due within the next few days, plus the unread count.',
		{},
		async () => {
			try {
				return ok(await get('/api/v1/notifications'));
			} catch (err) {
				return fail(err);
			}
		}
	);

	return server;
}
