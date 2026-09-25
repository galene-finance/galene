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

/** Preferred options-list height before the visible viewport clips it (18rem). */
export const OPTIONS_MAX_PX = 288;

/** One option row, including the list's border and padding. */
export const OPTIONS_MIN_PX = 48;

export type VisualViewportBox = {
	height: number;
	offsetTop: number;
	offsetLeft: number;
	width: number;
};

export type AnchorBox = { top: number; bottom: number; left: number; width: number };

export type OptionsPanelBox = {
	top: number;
	left: number;
	width: number;
	maxHeight: number;
};

/**
 * Place the portaled options list inside the visual viewport.
 *
 * iOS Safari keeps `position: fixed` in the visual viewport while
 * `getBoundingClientRect` stays in the layout viewport. When the keyboard
 * opens, floating-ui's available height collapses to a few pixels and the
 * list renders as an empty strip. This measures both viewports directly.
 */
export function optionsPanelBox(
	anchor: AnchorBox,
	viewport: VisualViewportBox,
	gap = 4,
	maxHeight = OPTIONS_MAX_PX
): OptionsPanelBox {
	const visibleTop = viewport.offsetTop;
	const visibleBottom = viewport.offsetTop + viewport.height;
	const spaceBelow = visibleBottom - anchor.bottom - gap;
	const spaceAbove = anchor.top - visibleTop - gap;
	const placeBelow = spaceBelow >= OPTIONS_MIN_PX || spaceBelow >= spaceAbove;
	const available = Math.max(0, placeBelow ? spaceBelow : spaceAbove);
	const height = Math.min(maxHeight, available);
	const top = placeBelow
		? anchor.bottom + gap - visibleTop
		: Math.max(0, anchor.top - gap - height - visibleTop);
	const width = Math.max(0, Math.min(anchor.width, viewport.width));
	const left = Math.min(
		Math.max(0, anchor.left - viewport.offsetLeft),
		Math.max(0, viewport.width - width)
	);
	return { top, left, width, maxHeight: height };
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
