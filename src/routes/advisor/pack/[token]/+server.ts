import { audit, resolveShareToken } from '$lib/server/advisor';
import { assertAllowed, recordFailure } from '$lib/server/loginThrottle';
import { loadPack } from '$lib/server/pack';
import { json } from '$lib/server/api';

function clientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * Expiring pack link. The token is the secret. An optional password is sent as
 * `?password=` or `x-galene-pack-password`. Bytes are the zip frozen at generation.
 */
export function GET({ params, url, request }) {
	const ip = clientIp(request);
	try {
		assertAllowed(ip, `pack:${params.token?.slice(0, 12) ?? ''}`);
	} catch (err) {
		return json(429, { error: err instanceof Error ? err.message : 'Too many attempts.' });
	}
	const password = url.searchParams.get('password') ?? request.headers.get('x-galene-pack-password');
	const resolved = resolveShareToken(params.token ?? '', password);
	if (!resolved.ok) {
		recordFailure(ip, `pack:${params.token?.slice(0, 12) ?? ''}`);
		if (resolved.status === 410) return json(410, { error: 'This link has expired or was revoked.' });
		return json(401, { error: 'Unknown link or wrong password.' });
	}
	if (resolved.row.kind !== 'pack') return json(404, { error: 'Not a pack link.' });
	const zip = loadPack(resolved.scope.userId, resolved.scope.grantId);
	if (!zip) return json(404, { error: 'Pack not found.' });
	audit(resolved.scope.userId, resolved.scope.grantId, 'pack_downloaded', 'link');
	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': 'attachment; filename="galene-accountant-pack.zip"',
			'cache-control': 'no-store'
		}
	});
}
