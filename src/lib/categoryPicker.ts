import type { Category } from '$lib/types';

export type CategoryPickerItem = { value: string; label: string };

/**
 * Combobox items for categorizing (issue #17).
 * All non-transfer categories (no type filter), then transfers with a badge.
 */
export function categoryPickerItems(
	categories: Category[],
	opts?: { includeNone?: boolean; noneLabel?: string; includeTransfers?: boolean }
): CategoryPickerItem[] {
	const includeTransfers = opts?.includeTransfers !== false;
	const normal = categories
		.filter((c) => c.type !== 'transfer')
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((c) => ({ value: String(c.id), label: c.name }));
	const transfers = includeTransfers
		? categories
				.filter((c) => c.type === 'transfer')
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((c) => ({ value: String(c.id), label: `${c.name} (transfer)` }))
		: [];
	const items = [...normal, ...transfers];
	if (opts?.includeNone) {
		return [{ value: '', label: opts.noneLabel ?? 'No category' }, ...items];
	}
	return items;
}
