import { fail, redirect } from '@sveltejs/kit';
import { audit, createViewerSession, resolveShareToken } from '$lib/server/advisor';
import { setSessionCookie } from '$lib/server/auth';
import { assertAllowed, clearOnSuccess, recordFailure } from '$lib/server/loginThrottle';

function clientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function load({ params }) {
	const resolved = resolveShareToken(params.token ?? '', null);
	// A passworded invite still renders the form; the token itself is the secret.
	if (!resolved.ok && resolved.status === 410) {
		return { expired: true, needsPassword: false, label: '' };
	}
	if (!resolved.ok || resolved.row.kind !== 'viewer') {
		return { expired: true, needsPassword: false, label: '' };
	}
	return {
		expired: false,
		needsPassword: !!resolved.row.password_hash,
		label: ''
	};
}

export const actions = {
	default: async ({ params, request, cookies }) => {
		const ip = clientIp(request);
		const bucket = `invite:${(params.token ?? '').slice(0, 12)}`;
		try {
			assertAllowed(ip, bucket);
		} catch (err) {
			return fail(429, { error: err instanceof Error ? err.message : 'Too many attempts.' });
		}
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const resolved = resolveShareToken(params.token ?? '', password);
		if (!resolved.ok || resolved.row.kind !== 'viewer') {
			recordFailure(ip, bucket);
			if (resolved.ok) return fail(404, { error: 'This link is not an advisor invite.' });
			if (resolved.status === 410) return fail(410, { error: 'This invite has expired or was revoked.' });
			return fail(401, { error: 'That link or password is not valid.' });
		}
		clearOnSuccess(ip, bucket);
		const session = createViewerSession(resolved.row.id, resolved.row.user_id, resolved.row.expires_at);
		setSessionCookie(cookies, session);
		audit(resolved.scope.userId, resolved.scope.grantId, 'viewer_login');
		redirect(303, '/transactions');
	}
};
