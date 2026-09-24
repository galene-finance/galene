import { apiUser, idList, json, unauthorized } from '$lib/server/api';
import { getTransactions } from '$lib/server/finance';
import { parseEmptyFields } from '$lib/server/transactionFilters';
import { parseAmountToCents } from '$lib/utils';

const isDate = (s: string | null) => s != null && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

export function GET(event) {
	const user = apiUser(event);
	if (!user) return unauthorized();
	const p = event.url.searchParams;

	const rawOp = p.get('amount_op') ?? '';
	if (!['', 'eq', 'between', 'gt', 'lt'].includes(rawOp)) {
		return json(400, { error: 'amount_op must be one of: eq, between, gt, lt.' });
	}
	const amountOp = rawOp as '' | 'eq' | 'between' | 'gt' | 'lt';
	const amountFrom = parseAmountToCents(p.get('amount_from') ?? '') ?? null;
	const amountTo = parseAmountToCents(p.get('amount_to') ?? '') ?? null;
	const page = Math.max(1, parseInt(p.get('page') ?? '1', 10) || 1);
	const pageSize = Math.min(100, Math.max(1, parseInt(p.get('page_size') ?? '25', 10) || 25));

	const dateFrom = isDate(p.get('date_from')) ? p.get('date_from')! : null;
	const dateTo = isDate(p.get('date_to')) ? p.get('date_to')! : null;

	const result = getTransactions(user.id, {
		accountIds: idList(p.get('account')),
		categoryIds: idList(p.get('category')),
		tagIds: idList(p.get('tag')),
		emptyFields: parseEmptyFields(p.getAll('empty')),
		amountOp,
		amountFrom,
		amountTo,
		dateFrom,
		dateTo,
		q: p.get('q') ?? '',
		page,
		pageSize
	});
	return json(200, result);
}
