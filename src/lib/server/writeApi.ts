import { createHmac, randomBytes } from 'node:crypto';
import { db } from './db';
import { demoBlockedMessage, isDemoMode } from './demoMode';
import {
	deleteAccount,
	deleteBudget,
	deleteCategory,
	deleteRule,
	deleteScheduled,
	deleteTag,
	deleteTransaction,
	saveAccount,
	saveBudget,
	saveCategory,
	saveRule,
	saveScheduled,
	saveTag,
	saveTransaction,
	saveTransactionSplits
} from './finance';
import type { ApiTokenScope } from './apiTokens';
import { flushDataChanges, registerWebhookDeliver, type DataChangeEvent } from './webhookNotify';
import { conditionMatches } from '../conditionMatch';
import type { AccountType, CategoryType, ForecastBehavior, RepeatUnit, RuleCondition, RuleField, RuleOp } from '$lib/types';

/**
 * Opt-in write API and signed webhooks (ADO-18).
 *
 * The read API and MCP stay read-only. A write succeeds only when the
 * instance toggle is on, the caller is a token with scope `write`, and demo
 * mode is off. Every successful write is audited. Webhooks fire from the shared save path
 * (the app and the write API), once per change.
 */

export const WRITE_RESOURCES = [
	'transaction',
	'category',
	'schedule',
	'account',
	'tag',
	'budget',
	'rule',
	'split'
] as const;
export type WriteResource = (typeof WRITE_RESOURCES)[number];

const RESOURCE_ACTIONS = ['created', 'updated', 'deleted'] as const;

export const WEBHOOK_EVENTS: string[] = [
	...WRITE_RESOURCES.filter((r) => r !== 'split').flatMap((r) =>
		RESOURCE_ACTIONS.map((a) => `${r}.${a}`)
	),
	'split.updated'
];

export const WEBHOOK_FIELDS = [
	'event',
	'resource',
	'action',
	'id',
	'name',
	'amount_cents',
	'date',
	'account_id',
	'category_id',
	'merchant',
	'notes',
	'type'
] as const;
export type WebhookField = (typeof WEBHOOK_FIELDS)[number];

/** Legacy flat filters stored before ADO-50. Read-only; new writes use `conditions`. */
export interface WebhookFilters {
	account_id?: number;
	category_id?: number;
	min_amount_cents?: number;
	max_amount_cents?: number;
	/** Canonical When model. Empty array means the event alone is enough. */
	conditions?: RuleCondition[];
}

export interface WebhookEvent {
	event: string;
	resource: WriteResource;
	action: 'created' | 'updated' | 'deleted';
	id: number;
	name?: string | null;
	amount_cents?: number | null;
	date?: string | null;
	account_id?: number | null;
	category_id?: number | null;
	merchant?: string | null;
	notes?: string | null;
	type?: string | null;
}

export interface WebhookPublic {
	id: number;
	name: string;
	url: string;
	secret_hint: string;
	events: string[];
	filters: WebhookFilters;
	fields: string[];
	enabled: number;
	created_at: string;
}

export interface AuditRow {
	id: number;
	action: string;
	resource: string;
	resource_id: number | null;
	created_at: string;
	token_name: string | null;
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;
let transportForTests: Transport | null = null;

/** Tests inject a transport so delivery never touches the network. */
export function setWebhookTransportForTests(fn: Transport | null) {
	transportForTests = fn;
}

const ROW_ID = 1;

export function isWriteApiEnabled(): boolean {
	if (isDemoMode()) return false;
	const row = db().query('SELECT enabled FROM write_api_config WHERE id = ?').get(ROW_ID) as
		| { enabled: number }
		| undefined;
	return row?.enabled === 1;
}

export function saveWriteApiSettings(enabled: boolean): { ok: true } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: demoBlockedMessage('The write API') };
	const existing = db().query('SELECT id FROM write_api_config WHERE id = ?').get(ROW_ID);
	if (!existing) {
		db().query('INSERT INTO write_api_config (id, enabled) VALUES (?, ?)').run(ROW_ID, enabled ? 1 : 0);
	} else {
		db()
			.query(`UPDATE write_api_config SET enabled = ?, updated_at = datetime('now') WHERE id = ?`)
			.run(enabled ? 1 : 0, ROW_ID);
	}
	return { ok: true };
}

export function listAudit(userId: number, limit = 20): AuditRow[] {
	return db()
		.query(
			`SELECT a.id, a.action, a.resource, a.resource_id, a.created_at, t.name AS token_name
			 FROM api_audit a
			 LEFT JOIN api_tokens t ON t.id = a.token_id
			 WHERE a.user_id = ?
			 ORDER BY a.id DESC
			 LIMIT ?`
		)
		.all(userId, limit) as AuditRow[];
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
}

export interface WriteCaller {
	userId: number;
	token: { id: number; scope: ApiTokenScope } | null;
}

export async function executeWrite(input: {
	caller: WriteCaller;
	resource: WriteResource;
	method: 'POST' | 'PATCH' | 'DELETE';
	id: number | null;
	body: Record<string, unknown>;
}): Promise<{ status: number; body: unknown }> {
	if (isDemoMode()) {
		return { status: 403, body: { error: demoBlockedMessage('The write API') } };
	}
	if (!isWriteApiEnabled()) {
		return { status: 403, body: { error: 'The write API is off.' } };
	}
	if (!input.caller.token || input.caller.token.scope !== 'write') {
		return {
			status: 403,
			body: { error: 'This token cannot write. Create a token with write scope.' }
		};
	}
	const userId = input.caller.userId;
	const tokenId = input.caller.token.id;
	try {
		const result = applyWrite(userId, input.resource, input.method, input.id, input.body);
		recordAudit(userId, tokenId, result.auditAction, input.resource, result.event.id, {
			before: result.before,
			after: result.after
		});
		await flushDataChanges();
		return { status: 200, body: { id: result.event.id, resource: input.resource, action: result.event.action } };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Write failed.';
		const status = /not found/i.test(message) ? 404 : 400;
		return { status, body: { error: message } };
	}
}

export async function handleWriteRequest(
	event: {
		request: Request;
		locals: { user: { id: number } | null; apiToken?: { id: number; scope: ApiTokenScope } | null };
		params: { id?: string };
	},
	resource: WriteResource
): Promise<Response> {
	if (isDemoMode()) return jsonResponse(403, { error: demoBlockedMessage('The write API') });
	if (!event.locals.user) {
		return jsonResponse(401, {
			error: 'Unauthorized. Authenticate with an API token (Authorization: Bearer <token>).'
		});
	}
	const method = event.request.method;
	if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
		return jsonResponse(405, { error: 'Method not allowed.' });
	}
	let id: number | null = null;
	if (event.params.id) {
		id = parseInt(event.params.id, 10);
		if (!Number.isFinite(id) || id <= 0) return jsonResponse(400, { error: 'Invalid id.' });
	}
	if ((method === 'PATCH' || method === 'DELETE') && resource !== 'split' && id == null) {
		return jsonResponse(400, { error: 'Missing id.' });
	}
	if (method === 'POST' && id != null && resource !== 'split') {
		return jsonResponse(400, { error: 'POST creates a new row. Use PATCH to update.' });
	}
	let body: Record<string, unknown> = {};
	if (method !== 'DELETE') {
		const text = await event.request.text();
		if (text.trim()) {
			try {
				const parsed = JSON.parse(text);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					return jsonResponse(400, { error: 'JSON object required.' });
				}
				body = parsed as Record<string, unknown>;
			} catch {
				return jsonResponse(400, { error: 'Invalid JSON.' });
			}
		}
	}
	const result = await executeWrite({
		caller: {
			userId: event.locals.user.id,
			token: event.locals.apiToken ?? null
		},
		resource,
		method,
		id,
		body
	});
	return jsonResponse(result.status, result.body);
}

function recordAudit(
	userId: number,
	tokenId: number,
	action: string,
	resource: string,
	resourceId: number,
	detail: unknown
) {
	db()
		.query(
			`INSERT INTO api_audit (user_id, token_id, action, resource, resource_id, detail)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
		.run(userId, tokenId, action, resource, resourceId, JSON.stringify(detail));
}

interface Applied {
	auditAction: 'create' | 'update' | 'delete';
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
	event: WebhookEvent;
}

function applyWrite(
	userId: number,
	resource: WriteResource,
	method: 'POST' | 'PATCH' | 'DELETE',
	id: number | null,
	body: Record<string, unknown>
): Applied {
	if (resource === 'split') {
		if (method === 'DELETE') throw new Error('Use an empty splits array to clear splits.');
		if (id == null) throw new Error('Missing transaction id.');
		return applySplit(userId, id, body);
	}
	if (method === 'POST') return applyCreate(userId, resource, body);
	if (id == null) throw new Error('Missing id.');
	if (method === 'DELETE') return applyDelete(userId, resource, id, body);
	return applyUpdate(userId, resource, id, body);
}

function applyCreate(userId: number, resource: WriteResource, body: Record<string, unknown>): Applied {
	if (resource === 'transaction') {
		const input = transactionInput(userId, body, null);
		saveTransaction(userId, input);
		const id = input.id!;
		const after = mustSnapshot('transactions', userId, id);
		return done('create', 'transaction', 'created', null, after);
	}
	if (resource === 'category') {
		const data = categoryInput(userId, body);
		saveCategory(userId, null, data);
		const id = newestId('categories', userId);
		return done('create', 'category', 'created', null, mustSnapshot('categories', userId, id));
	}
	if (resource === 'schedule') {
		const input = scheduleInput(userId, body, null);
		saveScheduled(userId, input);
		const id = input.id!;
		return done('create', 'schedule', 'created', null, mustSnapshot('scheduled', userId, id));
	}
	if (resource === 'account') {
		const data = accountInput(body);
		saveAccount(userId, null, data);
		const id = newestId('accounts', userId);
		return done('create', 'account', 'created', null, mustSnapshot('accounts', userId, id));
	}
	if (resource === 'tag') {
		const name = requiredString(body.name, 'Enter a name.');
		saveTag(userId, null, name);
		const row = db()
			.query('SELECT id FROM tags WHERE user_id = ? AND name = ? ORDER BY id DESC LIMIT 1')
			.get(userId, name) as { id: number };
		return done('create', 'tag', 'created', null, mustSnapshot('tags', userId, row.id));
	}
	if (resource === 'budget') {
		const data = budgetInput(userId, body);
		saveBudget(userId, null, data);
		const row = db()
			.query('SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND period = ?')
			.get(userId, data.categoryId, data.period) as { id: number };
		return done('create', 'budget', 'created', null, mustSnapshot('budgets', userId, row.id));
	}
	if (resource === 'rule') {
		const data = ruleInput(userId, body);
		const id = saveRule(userId, null, data);
		return done('create', 'rule', 'created', null, mustSnapshot('categorization_rules', userId, id));
	}
	throw new Error('Unsupported resource.');
}

function applyUpdate(userId: number, resource: WriteResource, id: number, body: Record<string, unknown>): Applied {
	if (resource === 'transaction') {
		const before = mustSnapshot('transactions', userId, id);
		const input = transactionInput(userId, body, id);
		saveTransaction(userId, input);
		return done('update', 'transaction', 'updated', before, mustSnapshot('transactions', userId, id));
	}
	if (resource === 'category') {
		const before = mustSnapshot('categories', userId, id);
		saveCategory(userId, id, categoryInput(userId, body));
		return done('update', 'category', 'updated', before, mustSnapshot('categories', userId, id));
	}
	if (resource === 'schedule') {
		const before = mustSnapshot('scheduled', userId, id);
		const input = scheduleInput(userId, body, id);
		saveScheduled(userId, input);
		const afterId = input.id ?? id;
		return done('update', 'schedule', 'updated', before, mustSnapshot('scheduled', userId, afterId));
	}
	if (resource === 'account') {
		const before = mustSnapshot('accounts', userId, id);
		saveAccount(userId, id, accountInput(body));
		return done('update', 'account', 'updated', before, mustSnapshot('accounts', userId, id));
	}
	if (resource === 'tag') {
		const before = mustSnapshot('tags', userId, id);
		saveTag(userId, id, requiredString(body.name, 'Enter a name.'));
		return done('update', 'tag', 'updated', before, mustSnapshot('tags', userId, id));
	}
	if (resource === 'budget') {
		const before = mustSnapshot('budgets', userId, id);
		saveBudget(userId, id, budgetInput(userId, body));
		return done('update', 'budget', 'updated', before, mustSnapshot('budgets', userId, id));
	}
	if (resource === 'rule') {
		const before = mustSnapshot('categorization_rules', userId, id);
		saveRule(userId, id, ruleInput(userId, body));
		return done('update', 'rule', 'updated', before, mustSnapshot('categorization_rules', userId, id));
	}
	throw new Error('Unsupported resource.');
}

function applyDelete(userId: number, resource: WriteResource, id: number, body: Record<string, unknown>): Applied {
	if (resource === 'transaction') {
		const before = mustSnapshot('transactions', userId, id);
		deleteTransaction(userId, id);
		return done('delete', 'transaction', 'deleted', before, null, id);
	}
	if (resource === 'category') {
		const before = mustSnapshot('categories', userId, id);
		const reassign = optionalId(body.reassign_to);
		deleteCategory(userId, id, reassign);
		return done('delete', 'category', 'deleted', before, null, id);
	}
	if (resource === 'schedule') {
		const before = mustSnapshot('scheduled', userId, id);
		deleteScheduled(userId, id);
		return done('delete', 'schedule', 'deleted', before, null, id);
	}
	if (resource === 'account') {
		const before = mustSnapshot('accounts', userId, id);
		const reassign = optionalId(body.reassign_to);
		if (reassign == null) throw new Error('Choose another account to move transactions to.');
		deleteAccount(userId, id, reassign);
		return done('delete', 'account', 'deleted', before, null, id);
	}
	if (resource === 'tag') {
		const before = mustSnapshot('tags', userId, id);
		deleteTag(userId, id);
		return done('delete', 'tag', 'deleted', before, null, id);
	}
	if (resource === 'budget') {
		const before = mustSnapshot('budgets', userId, id);
		deleteBudget(userId, id);
		return done('delete', 'budget', 'deleted', before, null, id);
	}
	if (resource === 'rule') {
		const before = mustSnapshot('categorization_rules', userId, id);
		deleteRule(userId, id);
		return done('delete', 'rule', 'deleted', before, null, id);
	}
	throw new Error('Unsupported resource.');
}

function applySplit(userId: number, txId: number, body: Record<string, unknown>): Applied {
	const beforeTx = mustSnapshot('transactions', userId, txId);
	const raw = body.splits;
	if (!Array.isArray(raw)) throw new Error('splits must be an array.');
	if (raw.length === 0) {
		db().query('DELETE FROM transaction_splits WHERE transaction_id = ?').run(txId);
		const after = mustSnapshot('transactions', userId, txId);
		return done('update', 'split', 'updated', beforeTx, after, txId);
	}
	const splits = raw.map((item) => {
		if (!item || typeof item !== 'object') throw new Error('Each split needs a category and amount.');
		const row = item as Record<string, unknown>;
		const categoryId = optionalId(row.category_id);
		if (categoryId == null || !owns('categories', userId, categoryId)) throw new Error('Select a valid category.');
		const amount = integer(row.amount_cents, 'Enter a split amount in cents.');
		if (amount <= 0) throw new Error('Split amounts must be positive cents.');
		return { categoryId, amountCents: amount };
	});
	saveTransactionSplits(userId, txId, splits);
	const after = mustSnapshot('transactions', userId, txId);
	return done('update', 'split', 'updated', beforeTx, after, txId);
}

function done(
	auditAction: Applied['auditAction'],
	resource: WriteResource,
	action: WebhookEvent['action'],
	before: Record<string, unknown> | null,
	after: Record<string, unknown> | null,
	deletedId?: number
): Applied {
	const source = after ?? before;
	if (!source) throw new Error('Nothing to record.');
	const id = deletedId ?? num(source.id);
	const event: WebhookEvent = {
		event: `${resource}.${action}`,
		resource,
		action,
		id
	};
	if (source.name !== undefined) event.name = source.name as string | null;
	if (source.merchant !== undefined) event.merchant = source.merchant as string | null;
	if (source.amount_cents !== undefined) event.amount_cents = num(source.amount_cents);
	if (source.date !== undefined) event.date = (source.date as string | null) ?? null;
	if (source.start_date !== undefined) event.date = source.start_date as string;
	if (source.account_id !== undefined) event.account_id = source.account_id as number | null;
	if (source.category_id !== undefined) event.category_id = source.category_id as number | null;
	if (source.notes !== undefined) event.notes = source.notes as string | null;
	if (source.type !== undefined) event.type = source.type as string | null;
	return { auditAction, before, after, event };
}

const SNAPSHOTS: Record<string, string> = {
	transactions:
		'SELECT id, account_id, category_id, date, amount_cents, merchant, notes, color FROM transactions WHERE id = ? AND user_id = ?',
	categories: 'SELECT id, name, type, parent_id, color FROM categories WHERE id = ? AND user_id = ?',
	scheduled:
		'SELECT id, name, account_id, category_id, amount_cents, start_date, notes, color FROM scheduled WHERE id = ? AND user_id = ?',
	accounts: 'SELECT id, name, type, color FROM accounts WHERE id = ? AND user_id = ?',
	tags: 'SELECT id, name FROM tags WHERE id = ? AND user_id = ?',
	budgets: 'SELECT id, category_id, period, limit_cents FROM budgets WHERE id = ? AND user_id = ?',
	categorization_rules:
		'SELECT id, name, category_id, conditions FROM categorization_rules WHERE id = ? AND user_id = ?'
};

function mustSnapshot(table: keyof typeof SNAPSHOTS, userId: number, id: number): Record<string, unknown> {
	const row = db().query(SNAPSHOTS[table]).get(id, userId) as Record<string, unknown> | null;
	if (!row) throw new Error('Not found.');
	return row;
}

function owns(table: 'accounts' | 'categories' | 'tags', userId: number, id: number): boolean {
	return !!db().query(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);
}

function newestId(table: string, userId: number): number {
	const row = db().query(`SELECT id FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 1`).get(userId) as {
		id: number;
	};
	return row.id;
}

function transactionInput(userId: number, body: Record<string, unknown>, id: number | null) {
	const amount = integer(body.amount_cents, 'Enter a non-zero amount in cents.');
	if (amount === 0) throw new Error('Enter a non-zero amount in cents.');
	const date = requiredString(body.date, 'Enter a valid date.');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid date.');
	const account = optionalId(body.account_id);
	if (account == null || !owns('accounts', userId, account)) throw new Error('Select a valid account.');
	const category = optionalId(body.category_id);
	if (category != null && !owns('categories', userId, category)) throw new Error('Select a valid category.');
	const tagIds = idList(body.tag_ids).filter((tagId) => owns('tags', userId, tagId));
	return {
		id: id ?? undefined,
		type: (amount < 0 ? 'expense' : 'income') as 'expense' | 'income',
		amountCents: Math.abs(amount),
		date,
		account,
		category,
		merchant: optionalString(body.merchant),
		notes: optionalString(body.notes),
		color: optionalString(body.color),
		tags: tagIds
	};
}

function categoryInput(userId: number, body: Record<string, unknown>) {
	const name = requiredString(body.name, 'Enter a name.');
	const type = requiredString(body.type, 'Enter a category type.') as CategoryType;
	if (type !== 'expense' && type !== 'income' && type !== 'transfer') throw new Error('Unknown category type.');
	const parent = optionalId(body.parent_id);
	if (parent != null && !owns('categories', userId, parent)) throw new Error('Select a valid parent category.');
	return { name, type, parent_id: parent, color: optionalString(body.color) };
}

function accountInput(body: Record<string, unknown>) {
	const name = requiredString(body.name, 'Enter a name.');
	const type = requiredString(body.type, 'Enter an account type.') as AccountType;
	if (!['bank', 'credit', 'cash', 'investment', 'other'].includes(type)) throw new Error('Unknown account type.');
	const data: {
		name: string;
		type: AccountType;
		color: string | null;
		opening_balance_cents?: number | null;
		opening_as_of?: string | null;
	} = { name, type, color: optionalString(body.color) };
	if (body.opening_balance_cents !== undefined || body.opening_as_of !== undefined) {
		data.opening_balance_cents =
			body.opening_balance_cents == null ? null : integer(body.opening_balance_cents, 'Invalid opening balance.');
		const asOf = body.opening_as_of == null ? null : requiredString(body.opening_as_of, 'Enter an as-of date.');
		if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('Enter an as-of date.');
		data.opening_as_of = asOf;
	}
	return data;
}

function scheduleInput(userId: number, body: Record<string, unknown>, id: number | null) {
	const name = requiredString(body.name, 'Enter a name.');
	const amount = integer(body.amount_cents, 'Enter an amount in cents.');
	if (amount === 0) throw new Error('Enter a non-zero amount in cents.');
	const startDate = requiredString(body.start_date, 'Enter a start date.');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Enter a start date.');
	const account = optionalId(body.account_id);
	if (account != null && !owns('accounts', userId, account)) throw new Error('Select a valid account.');
	const category = optionalId(body.category_id);
	if (category != null && !owns('categories', userId, category)) throw new Error('Select a valid category.');
	const repeatUnit = optionalString(body.repeat_unit) as RepeatUnit | null;
	if (repeatUnit && !['day', 'week', 'month', 'year'].includes(repeatUnit)) throw new Error('Unknown repeat unit.');
	const repeats = repeatUnit != null;
	const until = optionalString(body.until_date);
	if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error('Enter an end date.');
	const forecast = (optionalString(body.forecast_behavior) ?? 'bill') as ForecastBehavior;
	if (forecast !== 'bill' && forecast !== 'spread') throw new Error('Unknown forecast behavior.');
	const scopeRaw = optionalString(body.edit_scope);
	if (scopeRaw && !['once', 'following', 'all', 'new'].includes(scopeRaw)) {
		throw new Error('Choose how to apply this change.');
	}
	const occurrence = optionalString(body.occurrence_date);
	if (occurrence && !/^\d{4}-\d{2}-\d{2}$/.test(occurrence)) throw new Error('Enter a valid occurrence date.');
	return {
		id: id ?? undefined,
		name,
		amountCents: amount,
		startDate,
		account,
		category,
		notes: optionalString(body.notes),
		color: optionalString(body.color),
		repeats,
		repeatInterval: repeats ? Math.max(1, integer(body.repeat_interval ?? 1, 'Invalid repeat interval.')) : null,
		repeatUnit,
		untilDate: until,
		forecastBehavior: forecast,
		tags: idList(body.tag_ids).filter((tagId) => owns('tags', userId, tagId)),
		editScope: id && scopeRaw ? (scopeRaw as 'once' | 'following' | 'all' | 'new') : undefined,
		occurrenceDate: occurrence
	};
}

function budgetInput(userId: number, body: Record<string, unknown>) {
	const categoryId = optionalId(body.category_id);
	if (categoryId == null || !owns('categories', userId, categoryId)) throw new Error('Select a valid category.');
	const period = requiredString(body.period, 'Enter a period.');
	if (period !== 'week' && period !== 'month' && period !== 'year') throw new Error('Unknown budget period.');
	const limitCents = integer(body.limit_cents, 'Enter a limit in cents.');
	if (limitCents < 0) throw new Error('Limit cannot be negative.');
	return { categoryId, period: period as 'week' | 'month' | 'year', limitCents };
}

function ruleInput(userId: number, body: Record<string, unknown>) {
	const name = requiredString(body.name, 'Enter a name.');
	const categoryId = optionalId(body.category_id);
	if (categoryId == null || !owns('categories', userId, categoryId)) throw new Error('Select a valid category.');
	if (!Array.isArray(body.conditions) || body.conditions.length === 0) throw new Error('Add at least one condition.');
	const fields = new Set(['merchant', 'amount', 'account']);
	const ops = new Set(['contains', 'equals', 'gt', 'lt', 'between']);
	const conditions: RuleCondition[] = body.conditions.map((item) => {
		if (!item || typeof item !== 'object') throw new Error('Invalid condition.');
		const row = item as Record<string, unknown>;
		const field = String(row.field ?? '');
		const op = String(row.op ?? '');
		if (!fields.has(field) || !ops.has(op)) throw new Error('Invalid condition.');
		if (typeof row.value !== 'string' && typeof row.value !== 'number') throw new Error('Invalid condition.');
		const condition: RuleCondition = { field: field as RuleField, op: op as RuleOp, value: row.value };
		if (row.value2 !== undefined) {
			if (typeof row.value2 !== 'string' && typeof row.value2 !== 'number') throw new Error('Invalid condition.');
			condition.value2 = row.value2;
		}
		return condition;
	});
	return { name, conditions, categoryId };
}

function requiredString(value: unknown, message: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(message);
	return value.trim();
}

function optionalString(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value !== 'string') throw new Error('Expected text.');
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function integer(value: unknown, message: string): number {
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
	throw new Error(message);
}

function optionalId(value: unknown): number | null {
	if (value == null || value === '') return null;
	const n = integer(value, 'Invalid id.');
	if (n <= 0) throw new Error('Invalid id.');
	return n;
}

function idList(value: unknown): number[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw new Error('Expected a list of ids.');
	return value.map((item) => {
		const n = integer(item, 'Invalid id.');
		if (n <= 0) throw new Error('Invalid id.');
		return n;
	});
}

function num(value: unknown): number {
	return typeof value === 'number' ? value : Number(value);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export function httpsWebhookUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new Error('Enter a valid HTTPS URL.');
	}
	if (url.protocol !== 'https:') throw new Error('Webhook URLs must be HTTPS. Unsigned and non-HTTPS URLs are not allowed.');
	if (url.username || url.password) throw new Error('Webhook URLs cannot include credentials.');
	return url.toString();
}

const CONDITION_FIELDS = new Set<RuleField>(['merchant', 'amount', 'account', 'category']);
const CONDITION_OPS: Record<RuleField, RuleOp[]> = {
	merchant: ['contains', 'equals'],
	amount: ['equals', 'gt', 'lt', 'between'],
	account: ['equals'],
	category: ['equals']
};

function normalizeCondition(raw: unknown, index: number): RuleCondition {
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`Condition ${index + 1} is invalid.`);
	}
	const src = raw as Record<string, unknown>;
	const field = String(src.field ?? '') as RuleField;
	if (!CONDITION_FIELDS.has(field)) throw new Error(`Condition ${index + 1} has an unknown field.`);
	const op = String(src.op ?? '') as RuleOp;
	if (!CONDITION_OPS[field].includes(op)) throw new Error(`Condition ${index + 1} has an unknown operator.`);
	if (field === 'amount') {
		const value = integer(src.value, `Condition ${index + 1} needs an amount in cents.`);
		if (op === 'between') {
			const value2 = integer(src.value2, `Condition ${index + 1} needs a maximum amount.`);
			if (value2 < value) throw new Error(`Condition ${index + 1}: the max must be at least the min.`);
			return { field, op, value, value2 };
		}
		return { field, op, value };
	}
	if (field === 'account' || field === 'category') {
		const id = optionalId(src.value);
		if (id == null) throw new Error(`Condition ${index + 1} needs a value.`);
		return { field, op, value: id };
	}
	const value = requiredString(src.value, `Condition ${index + 1} needs a value.`);
	return { field, op, value };
}

/**
 * Editor view of a pre-ADO-50 flat filter. Matching of an unsaved row still uses the
 * original signed min/max. Account → Is, category → Is, both bounds → Between,
 * min only → More than, max only → Less than. Amount values stay in cents.
 */
export function legacyFiltersToConditions(flat: WebhookFilters): RuleCondition[] {
	const conditions: RuleCondition[] = [];
	if (flat.account_id != null) conditions.push({ field: 'account', op: 'equals', value: flat.account_id });
	if (flat.category_id != null) conditions.push({ field: 'category', op: 'equals', value: flat.category_id });
	const min = flat.min_amount_cents;
	const max = flat.max_amount_cents;
	if (min != null && max != null) {
		const lo = Math.min(Math.abs(min), Math.abs(max));
		const hi = Math.max(Math.abs(min), Math.abs(max));
		conditions.push({ field: 'amount', op: 'between', value: lo, value2: hi });
	} else if (min != null) {
		conditions.push({ field: 'amount', op: 'gt', value: Math.abs(min) });
	} else if (max != null) {
		conditions.push({ field: 'amount', op: 'lt', value: Math.abs(max) });
	}
	return conditions;
}

/**
 * Accept either `{ conditions }` or the old flat keys.
 * Stored shape is always `{ conditions }` so a later save drops the flat keys.
 */
export function normalizeFilters(raw: unknown): WebhookFilters {
	if (raw == null) return { conditions: [] };
	if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Filters must be an object.');
	const src = raw as Record<string, unknown>;
	const allowed = new Set(['account_id', 'category_id', 'min_amount_cents', 'max_amount_cents', 'conditions']);
	for (const key of Object.keys(src)) {
		if (!allowed.has(key)) throw new Error(`Unknown filter "${key}".`);
	}
	if (Array.isArray(src.conditions)) {
		return { conditions: src.conditions.map((item, i) => normalizeCondition(item, i)) };
	}
	const flat: WebhookFilters = {};
	if (src.account_id != null && src.account_id !== '') flat.account_id = optionalId(src.account_id) ?? undefined;
	if (src.category_id != null && src.category_id !== '') flat.category_id = optionalId(src.category_id) ?? undefined;
	if (src.min_amount_cents != null && src.min_amount_cents !== '') {
		flat.min_amount_cents = integer(src.min_amount_cents, 'Invalid minimum amount.');
	}
	if (src.max_amount_cents != null && src.max_amount_cents !== '') {
		flat.max_amount_cents = integer(src.max_amount_cents, 'Invalid maximum amount.');
	}
	return { conditions: legacyFiltersToConditions(flat) };
}

/** Read path: old rows stay flat until rewritten; new rows already have `conditions`. */
export function filtersAsConditions(filters: WebhookFilters): RuleCondition[] {
	if (Array.isArray(filters.conditions)) return filters.conditions;
	return legacyFiltersToConditions(filters);
}

export function normalizeEvents(raw: unknown): string[] {
	if (!Array.isArray(raw) || raw.length === 0) throw new Error('Choose at least one event.');
	const allowed = new Set(WEBHOOK_EVENTS);
	const events = [...new Set(raw.map((item) => String(item)))];
	for (const event of events) {
		if (!allowed.has(event)) throw new Error(`Unknown event "${event}".`);
	}
	return events;
}

export function normalizeFields(raw: unknown): string[] {
	if (!Array.isArray(raw) || raw.length === 0) throw new Error('Choose at least one payload field.');
	const allowed = new Set<string>(WEBHOOK_FIELDS);
	const fields = [...new Set(raw.map((item) => String(item)))];
	for (const field of fields) {
		if (!allowed.has(field)) throw new Error(`Unknown field "${field}".`);
	}
	return fields;
}

/** Keep only selected fields. Unselected keys are omitted, not sent as null. */
export function projectPayload(event: WebhookEvent, fields: string[]): Record<string, unknown> {
	const full = event as unknown as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(full, field) && full[field] !== undefined) {
			out[field] = full[field];
		}
	}
	return out;
}

/**
 * New `conditions` compare amount with Math.abs, same as rules, so "More than 25.00"
 * matches a $40 expense. Rows that still store the old flat keys (no `conditions` array)
 * keep the original signed, inclusive min/max check until they are saved again.
 */
export function webhookMatches(filters: WebhookFilters, events: string[], event: WebhookEvent): boolean {
	if (!events.includes(event.event)) return false;
	if (!Array.isArray(filters.conditions)) {
		if (filters.account_id != null && event.account_id !== filters.account_id) return false;
		if (filters.category_id != null && event.category_id !== filters.category_id) return false;
		if (filters.min_amount_cents != null || filters.max_amount_cents != null) {
			if (event.amount_cents == null) return false;
			if (filters.min_amount_cents != null && event.amount_cents < filters.min_amount_cents) return false;
			if (filters.max_amount_cents != null && event.amount_cents > filters.max_amount_cents) return false;
		}
		return true;
	}
	if (filters.conditions.length === 0) return true;
	return filters.conditions.every((c) => conditionMatches(c, event));
}

export function signWebhookBody(secret: string, body: string): string {
	return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

interface WebhookRow {
	id: number;
	user_id: number;
	name: string;
	url: string;
	secret: string;
	secret_hint: string;
	events: string;
	filters: string;
	fields: string;
	enabled: number;
	created_at: string;
}

function toPublic(row: WebhookRow): WebhookPublic {
	const stored = JSON.parse(row.filters) as WebhookFilters;
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		secret_hint: row.secret_hint,
		events: JSON.parse(row.events) as string[],
		filters: { conditions: filtersAsConditions(stored) },
		fields: JSON.parse(row.fields) as string[],
		enabled: row.enabled,
		created_at: row.created_at
	};
}

export function listWebhooks(userId: number): WebhookPublic[] {
	const rows = db()
		.query(
			`SELECT id, user_id, name, url, secret, secret_hint, events, filters, fields, enabled, created_at
			 FROM webhooks WHERE user_id = ? ORDER BY id`
		)
		.all(userId) as WebhookRow[];
	return rows.map(toPublic);
}

function newSecret(): { secret: string; hint: string } {
	const secret = 'whsec_' + randomBytes(24).toString('hex');
	return { secret, hint: secret.slice(-4) };
}

export function createWebhook(
	userId: number,
	input: { name: string; url: string; events: unknown; filters: unknown; fields: unknown; enabled?: boolean }
): { ok: true; webhook: WebhookPublic; secret: string } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: demoBlockedMessage('Webhooks') };
	try {
		const name = requiredString(input.name, 'Enter a name.');
		const url = httpsWebhookUrl(input.url);
		const events = normalizeEvents(input.events);
		const filters = normalizeFilters(input.filters);
		const fields = normalizeFields(input.fields);
		const enabled = input.enabled === false ? 0 : 1;
		const { secret, hint } = newSecret();
		const result = db()
			.query(
				`INSERT INTO webhooks (user_id, name, url, secret, secret_hint, events, filters, fields, enabled)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				userId,
				name,
				url,
				secret,
				hint,
				JSON.stringify(events),
				JSON.stringify(filters),
				JSON.stringify(fields),
				enabled
			);
		const row = db()
			.query(
				`SELECT id, user_id, name, url, secret, secret_hint, events, filters, fields, enabled, created_at
				 FROM webhooks WHERE id = ?`
			)
			.get(Number(result.lastInsertRowid)) as WebhookRow;
		return { ok: true, webhook: toPublic(row), secret };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Could not create webhook.' };
	}
}

export function deleteWebhook(userId: number, id: number) {
	if (isDemoMode()) throw new Error(demoBlockedMessage('Webhooks'));
	db().query('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId);
}

export function updateWebhook(
	userId: number,
	id: number,
	input: { name: string; url: string; events: unknown; filters: unknown; fields: unknown; enabled: boolean }
): { ok: true } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: demoBlockedMessage('Webhooks') };
	const existing = db().query('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
	if (!existing) return { ok: false, error: 'Webhook not found.' };
	try {
		const name = requiredString(input.name, 'Enter a name.');
		const url = httpsWebhookUrl(input.url);
		const events = normalizeEvents(input.events);
		const filters = normalizeFilters(input.filters);
		const fields = normalizeFields(input.fields);
		db()
			.query(
				`UPDATE webhooks SET name = ?, url = ?, events = ?, filters = ?, fields = ?, enabled = ? WHERE id = ? AND user_id = ?`
			)
			.run(
				name,
				url,
				JSON.stringify(events),
				JSON.stringify(filters),
				JSON.stringify(fields),
				input.enabled ? 1 : 0,
				id,
				userId
			);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : 'Could not update webhook.' };
	}
}

export function rotateWebhookSecret(
	userId: number,
	id: number
): { ok: true; secret: string } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: demoBlockedMessage('Webhooks') };
	const existing = db().query('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
	if (!existing) return { ok: false, error: 'Webhook not found.' };
	const { secret, hint } = newSecret();
	db().query('UPDATE webhooks SET secret = ?, secret_hint = ? WHERE id = ? AND user_id = ?').run(secret, hint, id, userId);
	return { ok: true, secret };
}

export async function dispatchWebhooks(userId: number, event: WebhookEvent | DataChangeEvent) {
	const rows = db()
		.query(
			`SELECT id, user_id, name, url, secret, secret_hint, events, filters, fields, enabled, created_at
			 FROM webhooks WHERE user_id = ? AND enabled = 1`
		)
		.all(userId) as WebhookRow[];
	for (const row of rows) {
		const events = JSON.parse(row.events) as string[];
		const filters = JSON.parse(row.filters) as WebhookFilters;
		const hookEvent = event as WebhookEvent;
		if (!webhookMatches(filters, events, hookEvent)) continue;
		const payload = projectPayload(hookEvent, JSON.parse(row.fields) as string[]);
		const body = JSON.stringify(payload);
		const signature = signWebhookBody(row.secret, body);
		const send = transportForTests ?? fetch;
		try {
			await send(row.url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-galene-signature': signature
				},
				body
			});
		} catch {
			// A receiver failure does not roll back the write.
		}
	}
}

registerWebhookDeliver(dispatchWebhooks);
