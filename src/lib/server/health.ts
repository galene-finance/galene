import { db } from './db';

/**
 * Readiness probe. Opens the database (and therefore the secret-key check)
 * and runs a trivial query. The error string is not returned: startup logs
 * already carry the clear message, and this body must not include stored values.
 */
export function databaseReady(): { ok: true } | { ok: false } {
	try {
		db().query('SELECT 1 AS ok').get();
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Galene will not start.';
		console.error(message);
		return { ok: false };
	}
}
