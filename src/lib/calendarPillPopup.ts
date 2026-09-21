import type { RepeatUnit, Scheduled, Transaction } from '$lib/types';
import { formatDate, formatMoney } from '$lib/utils';

export type PillPopupRow = { label: string; value: string };

function present(value: string | null | undefined): string | null {
	const v = value?.trim();
	return v ? v : null;
}

function push(rows: PillPopupRow[], label: string, value: string | null | undefined) {
	const v = present(value);
	if (v) rows.push({ label, value: v });
}

export function formatRepeat(
	interval: number | null | undefined,
	unit: RepeatUnit | null | undefined
): string | null {
	if (interval == null || interval <= 0 || !unit) return null;
	const names: Record<RepeatUnit, [string, string]> = {
		day: ['day', 'days'],
		week: ['week', 'weeks'],
		month: ['month', 'months'],
		year: ['year', 'years']
	};
	const pair = names[unit];
	if (!pair) return null;
	const [one, many] = pair;
	return interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;
}

function categoryValue(t: Transaction): string | null {
	if (t.splits && t.splits.length > 0) {
		return t.splits
			.map((s) => {
				const name = present(s.category_name) ?? 'Split';
				return `${name} ${formatMoney(s.amount_cents)}`;
			})
			.join(', ');
	}
	return present(t.category_name);
}

export function transactionPillRows(t: Transaction): PillPopupRow[] {
	const rows: PillPopupRow[] = [];
	push(rows, 'Name', t.merchant ?? t.category_name ?? 'Transaction');
	push(rows, 'Amount', formatMoney(t.amount_cents));
	push(rows, 'Start', formatDate(t.date));
	push(rows, 'Notes', t.notes);
	push(rows, 'Tags', t.tags?.length ? t.tags.join(', ') : null);
	push(rows, 'Account', t.account_name);
	push(rows, 'Category', categoryValue(t));
	return rows;
}

export function scheduledPillRows(s: Scheduled): PillPopupRow[] {
	const rows: PillPopupRow[] = [];
	push(rows, 'Name', s.name);
	push(rows, 'Amount', formatMoney(s.amount_cents));
	push(rows, 'Start', formatDate(s.start_date));
	push(rows, 'Until', s.until_date ? formatDate(s.until_date) : null);
	push(rows, 'Repeat', formatRepeat(s.repeat_interval, s.repeat_unit));
	push(rows, 'Notes', s.notes);
	push(rows, 'Tags', s.tags?.length ? s.tags.join(', ') : null);
	push(rows, 'Account', s.account_name);
	push(rows, 'Category', s.category_name);
	return rows;
}

export function popupPosition(rect: {
	top: number;
	bottom: number;
	left: number;
	width: number;
}, viewport: { width: number; height: number } = { width: 1280, height: 800 }): { top: number; left: number } {
	const popupWidth = 224;
	const gap = 6;
	const margin = 8;
	let left = rect.left;
	if (left + popupWidth > viewport.width - margin) left = viewport.width - popupWidth - margin;
	if (left < margin) left = margin;
	const spaceBelow = viewport.height - rect.bottom;
	const top = spaceBelow < 160 ? Math.max(margin, rect.top - 160 - gap) : rect.bottom + gap;
	return { top, left };
}
