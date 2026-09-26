import {
	beginTotpEnroll,
	backupCodeCounts,
	confirmTotpEnroll,
	disableTotp,
	listMethods,
	totpQrDataUrl
} from '$lib/server/mfa/mfa';
import { oidcSettingsView, saveOidcSettings, testOidcConnection, type OidcMode } from '$lib/server/oidc';
import { getUserRow } from '$lib/server/users';

export function load({ locals, url }) {
	const userId = locals.user!.id;
	const totp = listMethods(userId).find((m) => m.type === 'totp' && m.enabled);
	return {
		totp: totp ? { confirmedAt: totp.confirmed_at } : null,
		backupCodes: backupCodeCounts(userId),
		isAdmin: locals.user!.is_admin === 1,
		oidc: locals.user!.is_admin === 1 ? oidcSettingsView(url.origin) : null
	};
}

export const actions = {
	begin: async ({ locals }) => {
		const user = getUserRow(locals.user!.id)!;
		// The secret and QR are returned once, in this action result, and
		// shown only while enrollment is unfinished.
		return { ok: true, ...(await beginTotpEnroll(user.email)) };
	},

	confirm: async ({ request, locals }) => {
		const form = await request.formData();
		const secret = String(form.get('secret') ?? '');
		const code = String(form.get('code') ?? '');
		const result = confirmTotpEnroll(locals.user!.id, secret, code);
		if (!result.ok) {
			// Keep the enrollment UI up with the same secret (re-rendered QR)
			// so a wrong code doesn't force a re-scan; the secret is only
			// ever shown before confirm.
			const user = getUserRow(locals.user!.id)!;
			return { error: result.error, secret, qrDataUrl: await totpQrDataUrl(secret, user.email) };
		}
		// The backup codes are shown once, here; after this the secret and
		// codes are never returned again.
		return { ok: true, message: 'Two-factor is on.', backupCodes: result.backupCodes };
	},

	'save-oidc': async ({ request, locals }) => {
		if (locals.user!.is_admin !== 1) return { error: 'Only an administrator can change single sign-on.' };
		const form = await request.formData();
		const mode = String(form.get('mode') ?? 'optional') === 'required' ? 'required' : 'optional';
		const result = saveOidcSettings({
			enabled: form.get('enabled') === '1',
			mode: mode as OidcMode,
			issuer: String(form.get('issuer') ?? ''),
			clientId: String(form.get('client_id') ?? ''),
			clientSecret: String(form.get('client_secret') ?? ''),
			scopes: String(form.get('scopes') ?? '')
		});
		if (!result.ok) return { oidcError: result.error };
		return { ok: true, message: 'Single sign-on saved.' };
	},

	'test-oidc': async ({ locals }) => {
		if (locals.user!.is_admin !== 1) return { error: 'Only an administrator can test single sign-on.' };
		const result = await testOidcConnection();
		if (!result.ok) return { oidcError: result.error };
		return { ok: true, message: `Connected to ${result.issuer}.` };
	},

	disable: async ({ request, locals }) => {
		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const code = String(form.get('code') ?? '');
		const result = disableTotp(locals.user!.id, password, code);
		if (!result.ok) return { error: result.error };
		return { ok: true, message: 'Two-factor is off.' };
	}
};
