export const CREATE_VALUE = '__create__';

export type MultiComboboxItem = { value: string; label: string };

export function pillLabel(
	value: string,
	items: readonly MultiComboboxItem[],
	lastCreated: string
): string {
	if (value === CREATE_VALUE) return lastCreated || value;
	return items.find((i) => i.value === value)?.label ?? value;
}

export function selectedPills(
	values: readonly string[],
	items: readonly MultiComboboxItem[],
	lastCreated: string
): { value: string; label: string }[] {
	return values.map((value) => ({ value, label: pillLabel(value, items, lastCreated) }));
}

export function removeValue(values: readonly string[], target: string): string[] {
	return values.filter((v) => v !== target);
}

export function removeLastPill(values: readonly string[]): string[] {
	if (values.length === 0) return [];
	return values.slice(0, -1);
}

export function shouldRemoveLastOnBackspace(search: string, values: readonly string[]): boolean {
	return search === '' && values.length > 0;
}

/** Dropdown options: search match, minus values already shown as pills. */
export function availableItems(
	items: readonly MultiComboboxItem[],
	values: readonly string[],
	search: string
): MultiComboboxItem[] {
	const selected = new Set(values);
	const q = search.trim().toLowerCase();
	return items.filter((i) => {
		if (selected.has(i.value)) return false;
		if (q === '') return true;
		return i.label.toLowerCase().includes(q);
	});
}
