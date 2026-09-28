import { redirect } from '@sveltejs/kit';
import { createSession, setSessionCookie } from '$lib/server/auth';
import { assertAllowed, clearOnSuccess, recordFailure } from '$lib/server/loginThrottle';
import {
	assertIdToken,
	callbackErrorCopy,
	claimsFromIdToken,
	exchangeCode,
	fetchDiscovery,
	loadOidcConfig,
	mapEmailToUser,
	oidcReady,
	OIDC_CALLBACK_PATH,
	parseUserinfo,
	providerLabel,
	takeOidcState,
	type OidcCallbackError
} from '$lib/server/oidc';

const KNOWN: OidcCallbackError[] = ['access_denied', 'email_mismatch', 'not_provisioned', 'invalid'];

function errorView(code: OidcCallbackError, detail?: string | null) {
	const label = providerLabel(loadOidcConfig().issuer);
	const copy = callbackErrorCopy(code, label);
	return {
		phase: 'error' as const,
		title: copy.title,
		body: code === 'invalid' && detail ? detail : copy.body,
		providerLabel: label
	};
}

/** Exchange the IdP code (when present). Success goes straight home. */
export async function load(event) {
	const { url, cookies } = event;
	const params = url.searchParams;

	const bareError = params.get('error');
	if (bareError && !params.get('code')) {
		const code = (KNOWN.includes(bareError as OidcCallbackError) ? bareError : 'invalid') as OidcCallbackError;
		return errorView(code, params.get('detail'));
	}

	const code = params.get('code') ?? '';
	const state = params.get('state') ?? '';
	// The welcome interstitial is gone. A leftover bookmark should not sit on
	// the empty "Signing you in…" state.
	if (params.get('welcome') === '1' && !code && !state) {
		return errorView('invalid', 'This sign-in link is no longer used. Start again from the sign-in page.');
	}

	if (!code && !state && !bareError) {
		const label = providerLabel(loadOidcConfig().issuer);
		return {
			phase: 'pending' as const,
			title: 'Signing you in…',
			body: `Confirming with ${label} and opening your Galene session.`,
			providerLabel: label
		};
	}

	const ip = event.getClientAddress() ?? 'unknown';
	try {
		assertAllowed(ip);
	} catch (err) {
		return errorView('invalid', (err as Error).message);
	}

	const config = loadOidcConfig();
	if (!oidcReady(config)) return errorView('invalid', 'Single sign-on is not enabled.');

	if (bareError) {
		recordFailure(ip);
		if (bareError === 'access_denied' || bareError === 'consent_required' || bareError === 'login_required') {
			return errorView('access_denied');
		}
		return errorView('invalid', 'The identity provider did not complete sign-in.');
	}

	if (!code || !state) return errorView('invalid', 'The sign-in response was incomplete.');

	const pending = takeOidcState(state);
	if (!pending) {
		recordFailure(ip);
		return errorView('invalid', 'This sign-in attempt has expired. Start again from the sign-in page.');
	}

	const discovery = await fetchDiscovery(config.issuer);
	if ('error' in discovery) {
		recordFailure(ip);
		return errorView('invalid', discovery.error);
	}

	const tokens = await exchangeCode({
		tokenEndpoint: discovery.tokenEndpoint,
		config,
		code,
		redirectUri: `${url.origin}${OIDC_CALLBACK_PATH}`,
		verifier: pending.verifier
	});
	if ('error' in tokens) {
		recordFailure(ip);
		return errorView('invalid', tokens.error);
	}

	let email = '';
	let emailVerified: boolean | null = null;
	if (tokens.idToken) {
		const claims = claimsFromIdToken(tokens.idToken);
		if ('error' in claims) {
			recordFailure(ip);
			return errorView('invalid', claims.error);
		}
		const claimError = assertIdToken(claims, config, pending.nonce);
		if (claimError) {
			recordFailure(ip);
			return errorView('invalid', claimError);
		}
		email = claims.email;
		emailVerified = claims.emailVerified;
	}

	if (!email && tokens.accessToken && discovery.userinfoEndpoint) {
		try {
			const userinfo = await fetch(discovery.userinfoEndpoint, {
				headers: { authorization: `Bearer ${tokens.accessToken}`, accept: 'application/json' },
				redirect: 'error'
			});
			if (userinfo.ok) {
				const parsed = parseUserinfo(await userinfo.json());
				if (!('error' in parsed)) {
					email = parsed.email;
					emailVerified = parsed.emailVerified;
				}
			}
		} catch {
			/* missing email is reported below */
		}
	}

	if (!email) {
		recordFailure(ip);
		return errorView('invalid', 'The identity provider did not return an email.');
	}

	const mapped = mapEmailToUser(email, emailVerified);
	if (!mapped.ok) {
		// Count the IP only. A mismatched IdP email must not lock the password
		// bucket for that address.
		recordFailure(ip);
		return errorView(mapped.error);
	}

	clearOnSuccess(ip, email);
	const session = createSession(mapped.userId, { method: 'oidc', idpLabel: providerLabel(config.issuer) });
	setSessionCookie(cookies, session);
	redirect(303, '/');
}
