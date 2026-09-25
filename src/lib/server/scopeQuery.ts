import type { GrantScope } from './advisor';
import { applyGrantScope, getAccounts, getCategories, getTransactions, type TransactionFilters } from './finance';

export function viewerScope(event: { locals: App.Locals }): GrantScope | null {
	return event.locals.viewer?.scope ?? null;
}

export function scopedAccounts(userId: number, scope: GrantScope | null) {
	const accounts = getAccounts(userId);
	if (!scope || scope.accountIds.length === 0) return accounts;
	const allowed = new Set(scope.accountIds);
	return accounts.filter((a) => allowed.has(a.id));
}

export function scopedCategories(userId: number, _scope: GrantScope | null) {
	return getCategories(userId);
}

export function scopedTransactions(userId: number, filters: TransactionFilters, scope: GrantScope | null) {
	const scoped = applyGrantScope(filters, scope);
	if (!scoped) return { items: [], total: 0, pages: 1 };
	return getTransactions(userId, scoped);
}

