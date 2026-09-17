import { json } from '$lib/server/api';
import { versionInfo } from '$lib/version';

// Deliberately unauthenticated (like the /api/v1 healthcheck): it discloses
// only the version, and it's the endpoint for monitoring, scripts, and
// "which version am I running?" checks.
export function GET() {
	return json(200, versionInfo());
}
