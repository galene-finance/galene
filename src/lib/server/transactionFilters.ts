import { parseAmountToCents } from '$lib/utils';
import type { TransactionFilters } from '$lib/server/finance';

const PAGE_SIZES = [25, 50, 75, 100];

export function parseTransactionFilters(url: URL, defaultPageSize: number): TransactionFilters {
	const num = (v: string | null) => {
		if (!v) return null;
		const n = parseInt(v, 10);
		return Number.isFinite(n) ? n : null;
	};
	const op = url.searchParams.get('amount_op') ?? '';
	const pageSizeParam = num(url.searchParams.get('page_size'));
	return {
		accountIds: url.searchParams.getAll('account').map(num).filter((n): n is number => n !== null),
		categoryIds: url.searchParams.getAll('category').map(num).filter((n): n is number => n !== null),
		tagIds: url.searchParams.getAll('tag').map(num).filter((n): n is number => n !== null),
		amountOp: (['eq', 'between', 'gt', 'lt'].includes(op) ? op : '') as TransactionFilters['amountOp'],
		amountFrom: parseAmountToCents(url.searchParams.get('amount_from') ?? ''),
		amountTo: parseAmountToCents(url.searchParams.get('amount_to') ?? ''),
		dateFrom: url.searchParams.get('date_from') || null,
		dateTo: url.searchParams.get('date_to') || null,
		q: url.searchParams.get('q') ?? '',
		page: Math.max(1, num(url.searchParams.get('page')) ?? 1),
		pageSize: PAGE_SIZES.includes(pageSizeParam ?? -1) ? pageSizeParam! : defaultPageSize
	};
}

/** Same GET filters as the Transactions list, but every matching row (not one page). */
export function parseExportFilters(url: URL): TransactionFilters {
	return { ...parseTransactionFilters(url, 25), page: 1, pageSize: 1_000_000 };
}
