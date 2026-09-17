import { db } from './db';
import {
	categoryAmountInPeriod,
	currentPeriodBounds,
	getBudgets,
	getOccurrences,
	getScheduled
} from './finance';
import { formatMoney } from '$lib/utils';
import type { AppNotification, NotificationKind } from '$lib/types';

/** UTC "YYYY-MM-DD HH:MM:SS" — the same storage format as the rest of the app. */
function nowSql(): string {
	return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Local "YYYY-MM-DD" (matches how period bounds are derived). */
function todayISO(ref: Date): string {
	return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(
		ref.getDate()
	).padStart(2, '0')}`;
}

function addDaysISO(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + days));
	return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
		dt.getUTCDate()
	).padStart(2, '0')}`;
}

function humanDate(iso: string, ref: Date): string {
	if (iso === todayISO(ref)) return 'today';
	if (iso === addDaysISO(todayISO(ref), 1)) return 'tomorrow';
	// Local (not UTC) constructor: the date parts are calendar dates, and
	// formatting UTC midnight in a local timezone would shift the day.
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface NotificationRow {
	id: number;
	kind: NotificationKind;
	title: string;
	body: string;
	link: string | null;
	dedup_key: string | null;
	read_at: string | null;
	created_at: string;
	resolved_at: string | null;
}

function toNotification(row: NotificationRow): AppNotification {
	return {
		id: row.id,
		kind: row.kind,
		title: row.title,
		body: row.body,
		link: row.link,
		read_at: row.read_at,
		created_at: row.created_at,
		resolved_at: row.resolved_at
	};
}

/**
 * Create or refresh a notification. A row with the same (user, dedup_key) is
 * updated in place instead of duplicated, so a condition that keeps recurring
 * stays one live row. A row that had resolved is re-flagged unread when the
 * condition comes back; a row that is merely read stays read.
 */
export function upsertNotification(
	userId: number,
	kind: NotificationKind,
	title: string,
	body: string,
	link: string | null,
	dedupKey: string | null
): void {
	if (dedupKey) {
		const existing = db()
			.query('SELECT id FROM notifications WHERE user_id = ? AND dedup_key = ?')
			.get(userId, dedupKey) as { id: number } | undefined;
		if (existing) {
			db()
				.query(
					`UPDATE notifications
					 SET kind = ?, title = ?, body = ?, link = ?,
					     resolved_at = CASE WHEN resolved_at IS NOT NULL THEN NULL ELSE resolved_at END,
					     read_at = CASE WHEN resolved_at IS NOT NULL THEN NULL ELSE read_at END
					 WHERE id = ?`
				)
				.run(kind, title, body, link, existing.id);
			return;
		}
	}
	db()
		.query('INSERT INTO notifications (user_id, kind, title, body, link, dedup_key) VALUES (?, ?, ?, ?, ?, ?)')
		.run(userId, kind, title, body, link, dedupKey);
}

/** Mark a deduped condition as cleared (stops counting as unread). */
export function resolveNotification(userId: number, dedupKey: string): void {
	db()
		.query(
			`UPDATE notifications SET resolved_at = COALESCE(resolved_at, ?)
			 WHERE user_id = ? AND dedup_key = ? AND resolved_at IS NULL`
		)
		.run(nowSql(), userId, dedupKey);
}

/** Unread, then recent (7 days), newest first. */
export function listNotifications(userId: number, limit = 30): AppNotification[] {
	const rows = db()
		.query(
			`SELECT id, kind, title, body, link, read_at, created_at, resolved_at
			 FROM notifications
			 WHERE user_id = ? AND (read_at IS NULL OR created_at >= datetime('now', '-7 days'))
			 ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC
			 LIMIT ?`
		)
		.all(userId, limit) as NotificationRow[];
	return rows.map(toNotification);
}

/** Unread and still active (not resolved). */
export function unreadCount(userId: number): number {
	const row = db()
		.query('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL AND resolved_at IS NULL')
		.get(userId) as { c: number };
	return row.c;
}

export function markRead(userId: number, id: number): void {
	db()
		.query('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?')
		.run(nowSql(), id, userId);
}

export function markAllRead(userId: number): void {
	db()
		.query('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND read_at IS NULL')
		.run(nowSql(), userId);
}

/**
 * Resolve the kind's live rows whose condition no longer holds. Any row not
 * in `activeKeys` is stale — including rows whose underlying item was edited
 * or deleted, which per-condition resolution would never reach.
 */
function resolveStale(userId: number, kind: NotificationKind, activeKeys: string[]): void {
	const now = nowSql();
	if (activeKeys.length === 0) {
		db()
			.query(
				'UPDATE notifications SET resolved_at = COALESCE(resolved_at, ?) WHERE user_id = ? AND kind = ? AND resolved_at IS NULL'
			)
			.run(now, userId, kind);
	} else {
		db()
			.query(
				`UPDATE notifications SET resolved_at = COALESCE(resolved_at, ?)
				 WHERE user_id = ? AND kind = ? AND resolved_at IS NULL
				   AND dedup_key NOT IN (${activeKeys.map(() => '?').join(',')})`
			)
			.run(now, userId, kind, ...activeKeys);
	}
}

/**
 * Recompute the derived alerts: budget overruns and bills due within the
 * coming days. Called from the scheduler (throttled) and whenever the
 * notification list is opened, so the list is always current.
 */
export function generateComputedAlerts(userId: number, ref: Date = new Date()): void {
	// One live row per (category, period, period start) while the budget is over.
	const activeBudgetKeys: string[] = [];
	for (const b of getBudgets(userId)) {
		const { from, to } = currentPeriodBounds(b.period, ref);
		const key = `budget:${b.category_id}:${b.period}:${from}`;
		const spent = -categoryAmountInPeriod(userId, b.category_id, from, to);
		if (spent > b.limit_cents) {
			activeBudgetKeys.push(key);
			const pct = b.limit_cents > 0 ? Math.round((spent / b.limit_cents) * 100) : 0;
			const periodWord = b.period === 'week' ? 'week' : b.period === 'month' ? 'month' : 'year';
			upsertNotification(
				userId,
				'budget_overrun',
				`Budget over: ${b.category_name}`,
				`Spent ${formatMoney(spent)} of ${formatMoney(b.limit_cents)} this ${periodWord} (${pct}% of the limit).`,
				'/budget',
				key
			);
		}
	}
	resolveStale(userId, 'budget_overrun', activeBudgetKeys);

	// One live row per scheduled occurrence due today through +3 days.
	const activeBillKeys: string[] = [];
	const today = todayISO(ref);
	const windowEnd = addDaysISO(today, 3);
	for (const s of getScheduled(userId)) {
		if (s.forecast_behavior !== 'bill') continue;
		for (const occ of getOccurrences(s, today, windowEnd)) {
			const key = `bill:${s.id}:${occ}`;
			activeBillKeys.push(key);
			const when = humanDate(occ, ref);
			upsertNotification(
				userId,
				'bill_upcoming',
				`Bill due ${when}: ${s.name}`,
				`${formatMoney(s.amount_cents)}${s.account_name ? ` from ${s.account_name}` : ''}.`,
				'/calendar',
				key
			);
		}
	}
	resolveStale(userId, 'bill_upcoming', activeBillKeys);
}

/** A provider sync failed. providerLabel is the display name (e.g. "SimpleFIN"). */
export function notifySyncFailed(
	userId: number,
	providerLabel: string,
	connectionId: number,
	message: string
): void {
	upsertNotification(
		userId,
		'sync_failed',
		`Sync failed: ${providerLabel}`,
		message,
		'/settings/sync',
		`sync:${connectionId}:failed`
	);
}

/** A previously failing provider sync succeeded again. */
export function notifySyncRecovered(userId: number, providerLabel: string, connectionId: number): void {
	upsertNotification(
		userId,
		'sync_recovered',
		`Sync recovered: ${providerLabel}`,
		'The last sync succeeded.',
		'/settings/sync',
		`sync:${connectionId}:recovered`
	);
	resolveNotification(userId, `sync:${connectionId}:failed`);
}
