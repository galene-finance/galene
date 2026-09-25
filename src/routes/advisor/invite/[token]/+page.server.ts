import { fail, redirect } from '@sveltejs/kit';
import { acceptViewerInvite, inviteLanding } from '$lib/server/advisor';
import { setSessionCookie } from '$lib/server/auth';
import { assertAllowed, clearOnSuccess, recordFailure } from '$lib/server/loginThrottle';

function clientIp(request: Request): string {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function load({ params }) {
	// Peek the grant without the password so a protected invite can still show the form.
	return inviteLanding(params.token ?? '');
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
		const accepted = acceptViewerInvite(params.token ?? '', password);
		if (!accepted.ok) {
			recordFailure(ip, bucket);
			return fail(accepted.status, { error: accepted.error });
		}
		clearOnSuccess(ip, bucket);
		setSessionCookie(cookies, accepted.session);
		redirect(303, '/transactions');
	}
};
