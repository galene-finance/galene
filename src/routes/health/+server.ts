import { json } from '$lib/server/api';
import { databaseReady } from '$lib/server/health';

// Unauthenticated readiness probe. 200 only after the database opens.
// A missing or wrong secret key exits at startup, so this is not reached;
// any later failure to read the database is 503.
export function GET() {
	const ready = databaseReady();
	return json(ready.ok ? 200 : 503, ready);
}
