import { audit, packLanding, resolveShareToken } from '$lib/server/advisor';
import { assertAllowed, clearOnSuccess, recordFailure } from '$lib/server/loginThrottle';
import { loadPack } from '$lib/server/pack';
import { json } from '$lib/server/api';

function clientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** True when the caller is a browser navigation, not a zip or JSON client. */
export function _wantsPackForm(request: Request, password: string | null): boolean {
	if (password) return false;
	const accept = request.headers.get('accept') ?? '';
	return accept.includes('text/html');
}

const PACK_PAGE_STYLE = `<style>
	body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
	main { max-width: 28rem; margin: 0 auto; min-height: 60vh; display: flex; flex-direction: column; justify-content: center; gap: 1rem; padding: 1.5rem; }
	h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
	.muted, .error { font-size: 0.875rem; margin: 0; }
	.muted { color: #64748b; }
	.error { color: #dc2626; }
	form { display: flex; flex-direction: column; gap: 0.75rem; }
	label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 500; }
	input { border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font: inherit; }
	button { border: 0; border-radius: 0.5rem; padding: 0.5rem 0.75rem; background: #0d9488; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
</style>`;

function packPage(inner: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Accountant pack</title>
${PACK_PAGE_STYLE}
</head>
<body>
<main>
	<h1>Accountant pack</h1>
	${inner}
</main>
</body>
</html>`;
}

function packFormHtml(error: string | null): string {
	const banner = error
		? `<p class="error">${escapeHtml(error)}</p>`
		: `<p class="muted">This downloads a frozen accountant pack. Enter the link password to get the zip.</p>`;
	return packPage(`${banner}
	<form method="POST">
		<label>Password
			<input name="password" type="password" required autocomplete="current-password" />
		</label>
		<button type="submit">Download</button>
	</form>`);
}

function htmlResponse(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}

function zipResponse(zip: Buffer): Response {
	return new Response(new Uint8Array(zip), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': 'attachment; filename="galene-accountant-pack.zip"',
			'cache-control': 'no-store'
		}
	});
}

function packBucket(token: string | undefined): string {
	return `pack:${token?.slice(0, 12) ?? ''}`;
}

/**
 * Expiring pack link. The token is the secret. Programmatic clients send the
 * password as `?password=` or `x-galene-pack-password` and receive the frozen zip.
 * A browser navigation with no password gets an HTML form instead of JSON.
 */
export function GET({ params, url, request }) {
	const ip = clientIp(request);
	const bucket = packBucket(params.token);
	try {
		assertAllowed(ip, bucket);
	} catch (err) {
		return json(429, { error: err instanceof Error ? err.message : 'Too many attempts.' });
	}
	const password = url.searchParams.get('password') ?? request.headers.get('x-galene-pack-password');
	if (_wantsPackForm(request, password)) {
		const landing = packLanding(params.token ?? '');
		if (landing.expired) {
			return htmlResponse(410, packPage('<p class="muted">This link has expired or was revoked.</p>'));
		}
		return htmlResponse(200, packFormHtml(null));
	}
	const resolved = resolveShareToken(params.token ?? '', password);
	if (!resolved.ok) {
		recordFailure(ip, bucket);
		if (resolved.status === 410) return json(410, { error: 'This link has expired or was revoked.' });
		return json(401, { error: 'Unknown link or wrong password.' });
	}
	if (resolved.row.kind !== 'pack') return json(404, { error: 'Not a pack link.' });
	const zip = loadPack(resolved.scope.userId, resolved.scope.grantId);
	if (!zip) return json(404, { error: 'Pack not found.' });
	clearOnSuccess(ip, bucket);
	audit(resolved.scope.userId, resolved.scope.grantId, 'pack_downloaded', 'link');
	return zipResponse(zip);
}

/** Browser form submit. Wrong passwords stay on the form; the right one downloads the zip. */
export async function POST({ params, request }) {
	const ip = clientIp(request);
	const bucket = packBucket(params.token);
	try {
		assertAllowed(ip, bucket);
	} catch (err) {
		return htmlResponse(429, packPage(`<p class="error">${escapeHtml(err instanceof Error ? err.message : 'Too many attempts.')}</p>`));
	}
	const form = await request.formData();
	const password = String(form.get('password') ?? '');
	const resolved = resolveShareToken(params.token ?? '', password);
	if (!resolved.ok || resolved.row.kind !== 'pack') {
		recordFailure(ip, bucket);
		if (!resolved.ok && resolved.status === 410) {
			return htmlResponse(410, packPage('<p class="muted">This link has expired or was revoked.</p>'));
		}
		if (resolved.ok) {
			return htmlResponse(404, packPage('<p class="muted">This link is not an accountant pack.</p>'));
		}
		return htmlResponse(401, packFormHtml('That password is not valid.'));
	}
	const zip = loadPack(resolved.scope.userId, resolved.scope.grantId);
	if (!zip) {
		return htmlResponse(404, packPage('<p class="muted">Pack not found.</p>'));
	}
	clearOnSuccess(ip, bucket);
	audit(resolved.scope.userId, resolved.scope.grantId, 'pack_downloaded', 'link');
	return zipResponse(zip);
}
