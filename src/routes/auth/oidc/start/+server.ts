import { error, redirect } from '@sveltejs/kit';
import { assertAllowed, recordFailure } from '$lib/server/loginThrottle';
import { authorizeUrl, fetchDiscovery, loadOidcConfig, oidcReady, OIDC_CALLBACK_PATH, pkceChallengeFor, rememberOidcState } from '$lib/server/oidc';

/** Begin app-native OIDC. Stores PKCE + nonce, then redirects to the IdP. */
export async function GET(event) {
	if (event.locals.user) redirect(303, '/');
	const ip = event.getClientAddress() ?? 'unknown';
	try {
		assertAllowed(ip);
	} catch (err) {
		const message = (err as Error).message;
		redirect(303, `/auth/oidc/callback?error=invalid&detail=${encodeURIComponent(message)}`);
	}
	const config = loadOidcConfig();
	if (!oidcReady(config)) {
		error(404, 'Single sign-on is not enabled.');
	}
	const discovery = await fetchDiscovery(config.issuer);
	if ('error' in discovery) {
		recordFailure(ip);
		redirect(303, `/auth/oidc/callback?error=invalid&detail=${encodeURIComponent(discovery.error)}`);
	}
	const { state, nonce, verifier } = rememberOidcState();
	const challenge = pkceChallengeFor(verifier);
	const redirectUri = `${event.url.origin}${OIDC_CALLBACK_PATH}`;
	redirect(303, authorizeUrl({ discovery, config, redirectUri, state, nonce, challenge }));
}
