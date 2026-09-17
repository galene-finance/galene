import { apiUser, json, unauthorized } from '$lib/server/api';

const ENDPOINTS = [
	{ method: 'GET', path: '/api/v1/summary', description: 'Total balance, current-month income and expense, recent transactions, top spending categories.' },
	{ method: 'GET', path: '/api/v1/accounts', description: 'Accounts with their current balances.' },
	{ method: 'GET', path: '/api/v1/transactions', description: 'Transactions with filters (account, category, tag, q, date range, amount) and pagination.' },
	{ method: 'GET', path: '/api/v1/categories', description: 'Expense, income, and transfer categories.' },
	{ method: 'GET', path: '/api/v1/tags', description: 'Tags.' },
	{ method: 'GET', path: '/api/v1/budgets', description: 'Budgets with current-period spend.' },
	{ method: 'GET', path: '/api/v1/scheduled', description: 'Scheduled expectations (bills, income, recurring items).' },
	{ method: 'GET', path: '/api/v1/cashflow', description: 'Forecast vs. actual by category for a range of months.' },
	{ method: 'GET', path: '/api/v1/notifications', description: 'App notifications (sync failures, budget overruns, upcoming bills).' }
];

export function GET(event) {
	if (!apiUser(event)) return unauthorized();
	return json(200, {
		name: 'galene-api',
		version: '1',
		amounts: 'All amounts are integer cents (negative = expense). Dates are YYYY-MM-DD.',
		endpoints: ENDPOINTS
	});
}
