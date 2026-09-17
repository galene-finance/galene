import { db } from './db';
import { dbTime, syncNow } from './sync';
import { generateComputedAlerts } from './notifications';

const TICK_MS = 60_000;
/** A failed auto-sync retries no sooner than an hour later. */
const FAILURE_BACKOFF_MINUTES = 60;
/** Derived alerts (budget overruns, upcoming bills) are recomputed at most this often. */
const ALERTS_INTERVAL_MS = 5 * 60 * 1000;
let lastAlertsAt = 0;

/** Connections with a sync currently running, keyed by "userId:provider". */
const inFlight = new Set<string>();

// globalThis so a dev-mode module re-evaluation can't start a second loop.
const g = globalThis as unknown as { __galeneSyncScheduler?: boolean };

/**
 * Periodically syncs provider connections that have an auto-sync interval.
 * Started once per process (from the server hooks); every minute it fires
 * the connections whose next_sync_at has passed, one at a time per
 * connection, and reschedules them.
 */
export function startSyncScheduler(): void {
	if (g.__galeneSyncScheduler) return;
	g.__galeneSyncScheduler = true;
	setInterval(() => {
		void tick().catch(() => {});
	}, TICK_MS);
}

async function tick(): Promise<void> {
	const rows = db()
		.query(
			`SELECT id, user_id, provider, sync_interval_minutes
			 FROM connections
			 WHERE sync_interval_minutes IS NOT NULL
			   AND next_sync_at IS NOT NULL
			   AND next_sync_at <= ?
			 ORDER BY next_sync_at`
		)
		.all(dbTime(new Date())) as {
		id: number;
		user_id: number;
		provider: string;
		sync_interval_minutes: number;
	}[];

	for (const row of rows) {
		const key = `${row.user_id}:${row.provider}`;
		if (inFlight.has(key)) continue;
		inFlight.add(key);
		void (async () => {
			try {
				const result = await syncNow(row.user_id, row.provider);
				const delay = 'error' in result
					? Math.max(row.sync_interval_minutes, FAILURE_BACKOFF_MINUTES)
					: row.sync_interval_minutes;
				db()
					.query('UPDATE connections SET next_sync_at = ? WHERE id = ?')
					.run(dbTime(new Date(Date.now() + delay * 60000)), row.id);
			} finally {
				inFlight.delete(key);
			}
		})();
	}

	// Keep derived alerts (budget overruns, upcoming bills) fresh so the
	// notification badge stays current between page loads.
	if (Date.now() - lastAlertsAt >= ALERTS_INTERVAL_MS) {
		lastAlertsAt = Date.now();
		const users = db()
			.query('SELECT DISTINCT user_id FROM (SELECT user_id FROM budgets UNION SELECT user_id FROM scheduled)')
			.all() as { user_id: number }[];
		for (const { user_id } of users) {
			try {
				generateComputedAlerts(user_id);
			} catch {
				// One user's failure must not stop the rest.
			}
		}
	}
}
