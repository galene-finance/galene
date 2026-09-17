import type {
	AccountType,
	DashboardFilters,
	DashboardWidget,
	DashboardWidgetType,
	NotificationKind
} from './types';
import { ACCOUNT_TYPES } from './types';

/** Settings key under which the per-user dashboard layout JSON is stored. */
export const DASHBOARD_SETTING_KEY = 'dashboard_layout';

/** Max number of widgets a layout can hold. */
export const DASHBOARD_MAX_WIDGETS = 12;

/** 12-column grid geometry (must match the inline grid styles in DashboardGrid). */
export const GRID_COLUMNS = 12;
export const GRID_GAP = 16; // px, matches the grid's `gap`
export const GRID_ROW = 96; // px, matches the grid's `grid-auto-rows`

/**
 * The widget catalog: one entry per widget type. `filters` lists which filter
 * dimensions the type supports — the filter dialog only renders those, and
 * sanitizeFilters only keeps them.
 */
export interface WidgetCatalogEntry {
	type: DashboardWidgetType;
	label: string;
	description: string;
	/** Default size in grid cells (12-column grid). */
	w: number;
	h: number;
	filters: {
		accountIds?: boolean;
		categoryIds?: boolean;
		tagIds?: boolean;
		accountType?: boolean;
		period?: boolean;
		kinds?: boolean;
		unreadOnly?: boolean;
		days?: boolean;
		months?: boolean;
		limit?: boolean;
	};
}

export const WIDGET_CATALOG: Record<DashboardWidgetType, WidgetCatalogEntry> = {
	balances: {
		type: 'balances',
		label: 'Accounts & balances',
		description: 'Every account with its running balance and the total.',
		w: 4,
		h: 4,
		filters: { accountType: true, accountIds: true }
	},
	recent: {
		type: 'recent',
		label: 'Recent transactions',
		description: 'Your latest transactions, newest first.',
		w: 6,
		h: 5,
		filters: { accountIds: true, categoryIds: true, tagIds: true, limit: true }
	},
	upcoming: {
		type: 'upcoming',
		label: 'Upcoming scheduled',
		description: 'Scheduled payments and income coming due in the coming days.',
		w: 6,
		h: 5,
		filters: { accountIds: true, categoryIds: true, days: true }
	},
	budgets: {
		type: 'budgets',
		label: 'Budgets',
		description: 'Each budget with how much of the current period is spent.',
		w: 4,
		h: 4,
		filters: { period: true, categoryIds: true }
	},
	month: {
		type: 'month',
		label: 'This month',
		description: 'Income, spending and net for the current month, with last month for comparison.',
		w: 4,
		h: 2,
		filters: { accountIds: true, categoryIds: true, tagIds: true }
	},
	notifications: {
		type: 'notifications',
		label: 'Notifications',
		description: 'Alerts from budgets, sync and upcoming bills.',
		w: 4,
		h: 4,
		filters: { kinds: true, unreadOnly: true }
	},
	trends: {
		type: 'trends',
		label: 'Spending trends',
		description: 'Monthly spending as a bar chart.',
		w: 8,
		h: 4,
		filters: { categoryIds: true, months: true }
	}
};

/** Catalog in the order the add-widget dialog lists it. */
export const WIDGET_CATALOG_LIST: WidgetCatalogEntry[] = [
	WIDGET_CATALOG.month,
	WIDGET_CATALOG.balances,
	WIDGET_CATALOG.budgets,
	WIDGET_CATALOG.recent,
	WIDGET_CATALOG.upcoming,
	WIDGET_CATALOG.trends,
	WIDGET_CATALOG.notifications
];

/** Preset sizes offered by the per-widget size menu. */
export const DASHBOARD_SIZE_PRESETS = [
	{ id: 's', label: 'Small (4×2)', w: 4, h: 2 },
	{ id: 'm', label: 'Medium (6×3)', w: 6, h: 3 },
	{ id: 'l', label: 'Large (8×4)', w: 8, h: 4 },
	{ id: 'xl', label: 'Extra large (12×5)', w: 12, h: 5 }
] as const;

const NOTIFICATION_KINDS: NotificationKind[] = ['sync_failed', 'sync_recovered', 'budget_overrun', 'bill_upcoming'];

/** Clamp a value to an integer in [min, max]; non-finite input yields the fallback (min by default). */
export function clampInt(v: unknown, min: number, max: number, fallback = min): number {
	const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
	if (Number.isNaN(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/** A fresh widget id (client-generated; the server keeps it as-is when it looks sane). */
export function genWidgetId(): string {
	return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Deterministic 12-column first-fit compactor: walks widgets in array order,
 * placing each at the first free (x, y) — y ascending, then x ascending —
 * where its w×h box fits. Both client and server run it, so the result is
 * stable across the round trip.
 */
export function compactLayout(widgets: DashboardWidget[]): DashboardWidget[] {
	const taken = new Set<string>();
	const out: DashboardWidget[] = [];
	for (const w of widgets) {
		const width = clampInt(w.w, 1, GRID_COLUMNS);
		const height = clampInt(w.h, 1, 12);
		let placed = false;
		for (let y = 0; y < 200 && !placed; y++) {
			for (let x = 0; x + width <= GRID_COLUMNS; x++) {
				let fits = true;
				for (let dy = 0; dy < height && fits; dy++) {
					for (let dx = 0; dx < width; dx++) {
						if (taken.has(`${x + dx},${y + dy}`)) {
							fits = false;
							break;
						}
					}
				}
				if (!fits) continue;
				for (let dy = 0; dy < height; dy++) {
					for (let dx = 0; dx < width; dx++) taken.add(`${x + dx},${y + dy}`);
				}
				out.push({ ...w, x, y, w: width, h: height });
				placed = true;
				break;
			}
		}
		// A width ≤ 12 box always fits in a fresh row, so this is unreachable;
		// keep a deterministic fallback rather than dropping the widget.
		if (!placed) out.push({ ...w, x: 0, y: 200, w: width, h: height });
	}
	return out;
}

/**
 * Move `draggedId` to just before (or after) `targetId` and recompact. Pure:
 * returns a new array, never mutates the input. A null target moves the
 * widget to the end; unknown ids leave the order unchanged.
 */
export function reorderLayout(
	list: DashboardWidget[],
	draggedId: string,
	targetId: string | null,
	before: boolean
): DashboardWidget[] {
	const out = [...list];
	const from = out.findIndex((w) => w.id === draggedId);
	if (from < 0) return compactLayout(out);
	const [dragged] = out.splice(from, 1);
	if (targetId !== null) {
		const to = out.findIndex((w) => w.id === targetId);
		if (to >= 0) {
			out.splice(before ? to : to + 1, 0, dragged);
			return compactLayout(out);
		}
	}
	out.push(dragged);
	return compactLayout(out);
}

/** The default layout a new user gets (also the "reset to default" target). */
export const DEFAULT_WIDGETS: DashboardWidget[] = [
	{ id: 'month', type: 'month', x: 0, y: 0, w: 4, h: 2, filters: {} },
	{ id: 'balances', type: 'balances', x: 0, y: 0, w: 4, h: 4, filters: {} },
	{ id: 'budgets', type: 'budgets', x: 0, y: 0, w: 4, h: 4, filters: {} },
	{ id: 'recent', type: 'recent', x: 0, y: 0, w: 6, h: 5, filters: { limit: 10 } },
	{ id: 'upcoming', type: 'upcoming', x: 0, y: 0, w: 6, h: 5, filters: { days: 14 } },
	{ id: 'trends', type: 'trends', x: 0, y: 0, w: 8, h: 4, filters: { months: 6 } },
	{ id: 'notifications', type: 'notifications', x: 0, y: 0, w: 4, h: 4, filters: {} }
];

export const DEFAULT_LAYOUT: DashboardWidget[] = compactLayout(DEFAULT_WIDGETS);

/**
 * Sanitize an untrusted filters object (from a saved layout or a client
 * request) down to what the widget type supports. Numeric knobs fall back
 * to the type's default when absent or invalid.
 */
export function sanitizeFilters(unknown: unknown, type: DashboardWidgetType): DashboardFilters {
	const entry = WIDGET_CATALOG[type];
	const raw = (typeof unknown === 'object' && unknown !== null ? unknown : {}) as Record<string, unknown>;
	const out: DashboardFilters = {};

	const idList = (key: string): number[] | undefined => {
		const v = raw[key];
		if (!Array.isArray(v)) return undefined;
		const ids = new Set<number>();
		for (const x of v) {
			if (typeof x === 'number' && Number.isFinite(x) && x > 0) ids.add(Math.round(x));
		}
		return ids.size ? [...ids].sort((a, b) => a - b) : undefined;
	};

	if (entry.filters.accountIds) out.accountIds = idList('accountIds');
	if (entry.filters.categoryIds) out.categoryIds = idList('categoryIds');
	if (entry.filters.tagIds) out.tagIds = idList('tagIds');
	if (entry.filters.accountType) {
		const v = raw.accountType;
		if (typeof v === 'string' && (ACCOUNT_TYPES as string[]).includes(v)) out.accountType = v as AccountType;
	}
	if (entry.filters.period) {
		const v = raw.period;
		if (v === 'week' || v === 'month' || v === 'year') out.period = v;
	}
	if (entry.filters.kinds) {
		const v = raw.kinds;
		if (Array.isArray(v)) {
			const kinds = new Set<NotificationKind>();
			for (const k of v) {
				if (typeof k === 'string' && (NOTIFICATION_KINDS as string[]).includes(k)) kinds.add(k as NotificationKind);
			}
			if (kinds.size) out.kinds = [...kinds];
		}
	}
	if (entry.filters.unreadOnly) {
		if (typeof raw.unreadOnly === 'boolean') out.unreadOnly = raw.unreadOnly;
	}
	if (entry.filters.days) out.days = clampInt(raw.days, 1, 365, 14);
	if (entry.filters.months) out.months = clampInt(raw.months, 1, 24, 6);
	if (entry.filters.limit) out.limit = clampInt(raw.limit, 1, 100, 10);
	return out;
}

/**
 * Sanitize an untrusted layout (parsed settings JSON or a client request)
 * into a valid one: at most DASHBOARD_MAX_WIDGETS widgets, known types,
 * clamped sizes, unique sane ids, per-type filters, compacted positions.
 */
export function sanitizeLayout(unknown: unknown): DashboardWidget[] {
	if (!Array.isArray(unknown)) return [];
	const seen = new Set<string>();
	const out: DashboardWidget[] = [];
	for (const w of unknown.slice(0, DASHBOARD_MAX_WIDGETS)) {
		if (typeof w !== 'object' || w === null) continue;
		const raw = w as Record<string, unknown>;
		const type = raw.type;
		if (typeof type !== 'string' || !(type in WIDGET_CATALOG)) continue;
		const widgetType = type as DashboardWidgetType;
		let id = typeof raw.id === 'string' ? raw.id.replace(/[^\w-]/g, '').slice(0, 40) : '';
		if (!id || seen.has(id)) id = genWidgetId();
		while (seen.has(id)) id = genWidgetId();
		seen.add(id);
		out.push({
			id,
			type: widgetType,
			x: 0,
			y: 0,
			w: clampInt(raw.w, 1, GRID_COLUMNS),
			h: clampInt(raw.h, 1, 12),
			filters: sanitizeFilters(raw.filters, widgetType)
		});
	}
	return compactLayout(out);
}
