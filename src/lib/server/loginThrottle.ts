import { db } from './db';

/**
 * Login rate limiting (issue #19). Progressive lockout for failed sign-in
 * attempts, tracked per IP and per email in the `auth_throttle` table.
 *
 * This is in-app enforcement: a reverse-proxy rate limit (nginx fail2ban,
 * Cloudflare, etc.) is complementary, not a substitute — this module is what
 * protects a deployment with no proxy in front. A CAPTCHA after N failures
 * is a possible follow-up and is not implemented.
 *
 * Semantics: failures accumulate in a rolling window (WINDOW_MS). Crossing a
 * threshold sets `locked_until`; while locked, assertAllowed throws a generic
 * message that never reveals whether the email exists. A successful login
 * clears both buckets. Stale rows (window elapsed and no active lock) are
 * deleted lazily on each access, so the table stays small without a cron.
 */

/** A failure window: counts reset once it elapses without a new failure. */
const WINDOW_MS = 15 * 60 * 1000;

/** Progressive lockout: [failures in window, lock duration in ms]. */
const LOCK_STEPS: Array<[number, number]> = [
	[5, 30 * 1000],
	[8, 2 * 60 * 1000],
	[12, 15 * 60 * 1000]
];

type Bucket = 'ip' | 'email';

interface ThrottleRow {
	fail_count: number;
	window_started_at: string;
	locked_until: string | null;
}

function nowIso(): string {
	return new Date().toISOString();
}

/** Delete rows whose window has elapsed and which hold no active lock. */
function cleanupStale(): void {
	const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
	db()
		.query('DELETE FROM auth_throttle WHERE window_started_at < ? AND (locked_until IS NULL OR locked_until <= ?)')
		.run(cutoff, nowIso());
}

function lockDurationMs(failCount: number): number | null {
	let ms: number | null = null;
	for (const [threshold, duration] of LOCK_STEPS) {
		if (failCount >= threshold) ms = duration;
	}
	return ms;
}

function buckets(ip: string, email?: string): Array<[Bucket, string]> {
	const out: Array<[Bucket, string]> = [['ip', ip]];
	if (email) out.push(['email', email]);
	return out;
}

/**
 * Throw if the given IP or email is currently locked out. The message is
 * deliberately generic — it must not reveal whether an email exists.
 */
export function assertAllowed(ip: string, email?: string): void {
	cleanupStale();
	const now = Date.now();
	for (const [bucket, key] of buckets(ip, email)) {
		const row = db()
			.query('SELECT fail_count, window_started_at, locked_until FROM auth_throttle WHERE bucket = ? AND key = ?')
			.get(bucket, key) as ThrottleRow | undefined;
		if (row?.locked_until && Date.parse(row.locked_until) > now) {
			const seconds = Math.max(1, Math.ceil((Date.parse(row.locked_until) - now) / 1000));
			throw new Error(`Too many attempts. Try again in ${seconds} seconds.`);
		}
	}
}

/**
 * Record a failed attempt for the IP and (optionally) email buckets. The
 * window resets after WINDOW_MS without activity, so an old failure streak
 * doesn't keep a user locked forever.
 */
export function recordFailure(ip: string, email?: string): void {
	cleanupStale();
	const now = Date.now();
	const nowStr = nowIso();
	for (const [bucket, key] of buckets(ip, email)) {
		const row = db()
			.query('SELECT fail_count, window_started_at FROM auth_throttle WHERE bucket = ? AND key = ?')
			.get(bucket, key) as { fail_count: number; window_started_at: string } | null | undefined;
		let failCount: number;
		let windowStartedAt: string;
		if (row != null && now - Date.parse(row.window_started_at) < WINDOW_MS) {
			failCount = row.fail_count + 1;
			windowStartedAt = row.window_started_at;
		} else {
			failCount = 1;
			windowStartedAt = nowStr;
		}
		const lockMs = lockDurationMs(failCount);
		const lockedUntil = lockMs !== null ? new Date(now + lockMs).toISOString() : null;
		db()
			.query(
				`INSERT INTO auth_throttle (bucket, key, fail_count, window_started_at, locked_until)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT (bucket, key) DO UPDATE SET
					fail_count = excluded.fail_count,
					window_started_at = excluded.window_started_at,
					locked_until = excluded.locked_until`
			)
			.run(bucket, key, failCount, windowStartedAt, lockedUntil);
	}
}

/** A successful login (or signup) clears both buckets for the caller. */
export function clearOnSuccess(ip: string, email?: string): void {
	for (const [bucket, key] of buckets(ip, email)) {
		db().query('DELETE FROM auth_throttle WHERE bucket = ? AND key = ?').run(bucket, key);
	}
}
