import type { Category, CategoryType } from '$lib/types';

export type CategoryPickerItem = { value: string; label: string };

/**
 * Combobox items for categorizing a txn of `preferredType`.
 * Matching type first (plain name), then opposite type with a badge,
 * then transfers with a badge. Transfers keep current labeling.
 */
export function categoryPickerItems(
	categories: Category[],
	preferredType: 'expense' | 'income',
	opts?: { includeNone?: boolean; noneLabel?: string }
): CategoryPickerItem[] {
	const opposite: CategoryType = preferredType === 'income' ? 'expense' : 'income';
	const match = categories
		.filter((c) => c.type === preferredType)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((c) => ({ value: String(c.id), label: c.name }));
	const other = categories
		.filter((c) => c.type === opposite)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((c) => ({ value: String(c.id), label: `${c.name} (${c.type})` }));
	const transfers = categories
		.filter((c) => c.type === 'transfer')
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((c) => ({ value: String(c.id), label: `${c.name} (transfer)` }));
	const items = [...match, ...other, ...transfers];
	if (opts?.includeNone) {
		return [{ value: '', label: opts.noneLabel ?? 'No category' }, ...items];
	}
	return items;
}

/** Same-name category under the other non-transfer type, if any. */
export function findOppositeTypeCategory(
	categories: Category[],
	name: string,
	preferredType: 'expense' | 'income'
): Category | undefined {
	const trimmed = name.trim().toLowerCase();
	if (!trimmed) return undefined;
	const opposite: CategoryType = preferredType === 'income' ? 'expense' : 'income';
	return categories.find((c) => c.type === opposite && c.name.trim().toLowerCase() === trimmed);
}
