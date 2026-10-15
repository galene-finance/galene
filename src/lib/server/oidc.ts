import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { demoBlockedMessage, isDemoMode } from './demoMode';
import { assertAllowed, clearOnSuccess, recordFailure } from './loginThrottle';

/**
 * Household app-native OIDC (issue #98). Authentik (or any generic OIDC IdP)
 * is the identity provider only: Galene redirects the browser, then the
 * callback creates the existing galene_session cookie. No reverse-proxy
 * forward-auth and no IdP logout.
 *
 * Precedence: a non-empty GALENE_OIDC_* env var overrides the matching
 * Settings field. GALENE_OIDC_ENABLED / GALENE_OIDC_MODE override when set.
 * Client secret from the environment is never written back into the database.
 */

export const OIDC_CALLBACK_PATH = '/auth/oidc/callback';
export const DEFAULT_OIDC_SCOPES = 'openid profile email';
const STATE_TTL_MS = 10 * 60 * 1000;

export type OidcMode = 'optional' | 'required';

export interface OidcConfig {
	enabled: boolean;
	mode: OidcMode;
	issuer: string;
	clientId: string;
	clientSecret: string;
	scopes: string;
	/** True when the secret came from the environment (Settings must not echo it). */
	secretFromEnv: boolean;
	enabledFromEnv: boolean;
	modeFromEnv: boolean;
}

export interface OidcDiscovery {
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	userinfoEndpoint: string | null;
	jwksUri: string | null;
}

export type OidcCallbackError =
	| 'access_denied'
	| 'email_mismatch'
	| 'not_provisioned'
	| 'email_unverified'
	| 'sub_mismatch'
	| 'invalid';

export const OIDC_CALLBACK_ERRORS: OidcCallbackError[] = [
	'access_denied',
	'email_mismatch',
	'not_provisioned',
	'email_unverified',
	'sub_mismatch',
	'invalid'
];

interface ConfigRow {
	enabled: number;
	mode: string;
	issuer: string;
	client_id: string;
	client_secret: string;
	scopes: string;
}

function envTrim(name: string): string {
	return process.env[name]?.trim() ?? '';
}

function envBool(name: string): boolean | null {
	const raw = envTrim(name).toLowerCase();
	if (!raw) return null;
	if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
	if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
	return null;
}

export function ensureOidcRow(): ConfigRow {
	const existing = db().query('SELECT enabled, mode, issuer, client_id, client_secret, scopes FROM oidc_config WHERE id = 1').get() as
		| ConfigRow
		| undefined;
	if (existing) return existing;
	db()
		.query(
			`INSERT INTO oidc_config (id, enabled, mode, issuer, client_id, client_secret, scopes)
			 VALUES (1, 0, 'optional', '', '', '', ?)`
		)
		.run(DEFAULT_OIDC_SCOPES);
	return {
		enabled: 0,
		mode: 'optional',
		issuer: '',
		client_id: '',
		client_secret: '',
		scopes: DEFAULT_OIDC_SCOPES
	};
}

export function loadOidcConfig(): OidcConfig {
	const row = ensureOidcRow();
	const enabledEnv = envBool('GALENE_OIDC_ENABLED');
	const modeEnv = envTrim('GALENE_OIDC_MODE').toLowerCase();
	const issuerEnv = envTrim('GALENE_OIDC_ISSUER');
	const clientIdEnv = envTrim('GALENE_OIDC_CLIENT_ID');
	const secretEnv = envTrim('GALENE_OIDC_CLIENT_SECRET');
	const scopesEnv = envTrim('GALENE_OIDC_SCOPES');
	const mode: OidcMode = modeEnv === 'required' || modeEnv === 'optional' ? modeEnv : row.mode === 'required' ? 'required' : 'optional';
	return {
		enabled: enabledEnv ?? row.enabled === 1,
		mode,
		issuer: (issuerEnv || row.issuer).replace(/\/+$/, ''),
		clientId: clientIdEnv || row.client_id,
		clientSecret: secretEnv || row.client_secret,
		scopes: scopesEnv || row.scopes || DEFAULT_OIDC_SCOPES,
		secretFromEnv: secretEnv.length > 0,
		enabledFromEnv: enabledEnv !== null,
		modeFromEnv: modeEnv === 'required' || modeEnv === 'optional'
	};
}

export function oidcReady(config: OidcConfig = loadOidcConfig()): boolean {
	return config.enabled && !!config.issuer && !!config.clientId && !!config.clientSecret;
}

/** Public view for the login page. Never includes the client secret. */
export function publicOidcLogin(): { enabled: boolean; mode: OidcMode; providerLabel: string } | null {
	const config = loadOidcConfig();
	if (!oidcReady(config)) return null;
	return { enabled: true, mode: config.mode, providerLabel: providerLabel(config.issuer) };
}

/** Truthy `local` query (`1`, `true`, `yes`, `on`) keeps the password form under Required SSO. */
export function localPasswordEscape(value: string | null): boolean {
	if (!value) return false;
	const raw = value.trim().toLowerCase();
	return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function providerLabel(issuer: string): string {
	const value = issuer.toLowerCase();
	if (value.includes('authentik')) return 'Authentik';
	return 'SSO';
}

export function maskSecret(secret: string): string {
	if (!secret) return '';
	if (secret.length <= 4) return '••••';
	return `••••••••${secret.slice(-4)}`;
}

export interface OidcSettingsInput {
	enabled: boolean;
	mode: OidcMode;
	issuer: string;
	clientId: string;
	/** Empty keeps the stored secret. Ignored when the secret comes from the environment. */
	clientSecret: string;
	scopes: string;
}

export function saveOidcSettings(input: OidcSettingsInput): { ok: true } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: demoBlockedMessage('Single sign-on') };
	const current = loadOidcConfig();
	// Environment values win at read time. The database copy is still updated so
	// a later unset env falls back to what an admin saved here.
	const issuer = input.issuer.trim().replace(/\/+$/, '');
	if (input.enabled) {
		if (!issuer || !input.clientId.trim()) {
			return { ok: false, error: 'Issuer URL and Client ID are required when single sign-on is on.' };
		}
		if (!current.clientSecret && !input.clientSecret.trim() && !current.secretFromEnv) {
			return { ok: false, error: 'Client secret is required when single sign-on is on.' };
		}
		try {
			const url = new URL(issuer);
			if (url.protocol !== 'https:' && url.protocol !== 'http:') {
				return { ok: false, error: 'Issuer URL must start with https:// or http://.' };
			}
		} catch {
			return { ok: false, error: 'Issuer URL is not a valid URL.' };
		}
	} else if (issuer) {
		try {
			new URL(issuer);
		} catch {
			return { ok: false, error: 'Issuer URL is not a valid URL.' };
		}
	}
	const mode: OidcMode = input.mode === 'required' ? 'required' : 'optional';
	const scopes = input.scopes.trim() || DEFAULT_OIDC_SCOPES;
	if (!/^[\w.\- ]+$/.test(scopes)) {
		return { ok: false, error: 'Scopes may only contain letters, numbers, dots, hyphens, and spaces.' };
	}
	const secret = current.secretFromEnv
		? ensureOidcRow().client_secret
		: input.clientSecret.trim() || ensureOidcRow().client_secret;
	db()
		.query(
			`UPDATE oidc_config
			 SET enabled = ?, mode = ?, issuer = ?, client_id = ?, client_secret = ?, scopes = ?, updated_at = datetime('now')
			 WHERE id = 1`
		)
		.run(input.enabled ? 1 : 0, mode, issuer, input.clientId.trim(), secret, scopes);
	return { ok: true };
}

/** Settings form values. Secret is masked; the raw value is never returned. */
export function oidcSettingsView(origin: string) {
	const config = loadOidcConfig();
	const stored = ensureOidcRow();
	return {
		enabled: config.enabled,
		mode: config.mode,
		issuer: config.issuer,
		clientId: config.clientId,
		secretConfigured: config.clientSecret.length > 0,
		secretMasked: config.secretFromEnv ? 'Set in environment' : maskSecret(stored.client_secret),
		secretFromEnv: config.secretFromEnv,
		enabledFromEnv: config.enabledFromEnv,
		modeFromEnv: config.modeFromEnv,
		issuerFromEnv: envTrim('GALENE_OIDC_ISSUER').length > 0,
		clientIdFromEnv: envTrim('GALENE_OIDC_CLIENT_ID').length > 0,
		scopesFromEnv: envTrim('GALENE_OIDC_SCOPES').length > 0,
		scopes: config.scopes,
		redirectUri: `${origin.replace(/\/+$/, '')}${OIDC_CALLBACK_PATH}`,
		providerLabel: providerLabel(config.issuer)
	};
}

export function parseDiscovery(body: unknown, expectedIssuer?: string): OidcDiscovery | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'Discovery document was not valid JSON.' };
	const doc = body as Record<string, unknown>;
	const issuer = typeof doc.issuer === 'string' ? doc.issuer.replace(/\/+$/, '') : '';
	const authorizationEndpoint = typeof doc.authorization_endpoint === 'string' ? doc.authorization_endpoint : '';
	const tokenEndpoint = typeof doc.token_endpoint === 'string' ? doc.token_endpoint : '';
	const userinfoEndpoint = typeof doc.userinfo_endpoint === 'string' ? doc.userinfo_endpoint : null;
	const jwksUri = typeof doc.jwks_uri === 'string' ? doc.jwks_uri : null;
	if (!issuer || !authorizationEndpoint || !tokenEndpoint) {
		return { error: 'Discovery document is missing issuer, authorization, or token endpoints.' };
	}
	if (expectedIssuer && issuer !== expectedIssuer.replace(/\/+$/, '')) {
		return { error: 'Discovery issuer does not match the configured Issuer URL.' };
	}
	try {
		new URL(authorizationEndpoint);
		new URL(tokenEndpoint);
	} catch {
		return { error: 'Discovery endpoints are not valid URLs.' };
	}
	return { issuer, authorizationEndpoint, tokenEndpoint, userinfoEndpoint, jwksUri };
}

export async function fetchDiscovery(
	issuer: string,
	fetchImpl: typeof fetch = fetch
): Promise<OidcDiscovery | { error: string }> {
	const base = issuer.replace(/\/+$/, '');
	let response: Response;
	try {
		response = await fetchImpl(`${base}/.well-known/openid-configuration`, {
			headers: { accept: 'application/json' },
			redirect: 'error'
		});
	} catch {
		return { error: 'Could not reach the issuer. Check the Issuer URL and that Galene can open it.' };
	}
	if (!response.ok) {
		return { error: `Discovery failed (${response.status}). Check the Issuer URL.` };
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { error: 'Discovery response was not JSON.' };
	}
	return parseDiscovery(body, base);
}

export async function testOidcConnection(
	fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; issuer: string } | { ok: false; error: string }> {
	const config = loadOidcConfig();
	if (!config.issuer || !config.clientId || !config.clientSecret) {
		return { ok: false, error: 'Issuer URL, Client ID, and Client secret are all required to test.' };
	}
	const discovery = await fetchDiscovery(config.issuer, fetchImpl);
	if ('error' in discovery) return { ok: false, error: discovery.error };
	const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
	let tokenRes: Response;
	try {
		tokenRes = await fetchImpl(discovery.tokenEndpoint, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/x-www-form-urlencoded',
				authorization: `Basic ${basic}`
			},
			body: new URLSearchParams({ grant_type: 'client_credentials' }),
			redirect: 'error'
		});
	} catch {
		return { ok: false, error: 'Could not reach the token endpoint.' };
	}
	if (tokenRes.ok) return { ok: true, issuer: discovery.issuer };
	// Many household IdPs (including Authentik) do not enable client_credentials.
	// A 400/401 with an OAuth error still proves the endpoint and client are known.
	let detail = '';
	try {
		const body = (await tokenRes.json()) as { error?: string };
		detail = body.error ?? '';
	} catch {
		detail = '';
	}
	if (tokenRes.status === 400 || tokenRes.status === 401) {
		if (detail === 'invalid_client' || detail === 'unauthorized_client' && tokenRes.status === 401) {
			// unauthorized_client often means the grant type is off, not bad credentials.
			if (detail === 'invalid_client') {
				return { ok: false, error: 'The issuer rejected the client ID or secret.' };
			}
		}
		if (detail === 'unauthorized_client' || detail === 'unsupported_grant_type' || detail === 'invalid_grant') {
			return { ok: true, issuer: discovery.issuer };
		}
		if (!detail) return { ok: true, issuer: discovery.issuer };
	}
	return {
		ok: false,
		error: detail
			? `Token endpoint returned ${tokenRes.status} (${detail}).`
			: `Token endpoint returned ${tokenRes.status}.`
	};
}

function base64Url(bytes: Buffer): string {
	return bytes.toString('base64url');
}

export function pkceChallengeFor(verifier: string): string {
	return base64Url(createHash('sha256').update(verifier).digest());
}

export function createPkce(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export function rememberOidcState(): { state: string; nonce: string; verifier: string } {
	const state = base64Url(randomBytes(24));
	const nonce = base64Url(randomBytes(24));
	const { verifier } = createPkce();
	const expires = new Date(Date.now() + STATE_TTL_MS).toISOString();
	db().query(`DELETE FROM oidc_states WHERE expires_at <= datetime('now')`).run();
	db().query(`INSERT INTO oidc_states (state, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)`).run(state, nonce, verifier, expires);
	return { state, nonce, verifier };
}

export function takeOidcState(state: string): { nonce: string; verifier: string } | null {
	if (!state) return null;
	const row = db()
		.query(`SELECT nonce, code_verifier, expires_at FROM oidc_states WHERE state = ?`)
		.get(state) as { nonce: string; code_verifier: string; expires_at: string } | undefined;
	db().query(`DELETE FROM oidc_states WHERE state = ?`).run(state);
	if (!row) return null;
	if (Date.parse(row.expires_at) <= Date.now()) return null;
	return { nonce: row.nonce, verifier: row.code_verifier };
}

export function authorizeUrl(args: {
	discovery: OidcDiscovery;
	config: OidcConfig;
	redirectUri: string;
	state: string;
	nonce: string;
	challenge: string;
}): string {
	const url = new URL(args.discovery.authorizationEndpoint);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', args.config.clientId);
	url.searchParams.set('redirect_uri', args.redirectUri);
	url.searchParams.set('scope', args.config.scopes);
	url.searchParams.set('state', args.state);
	url.searchParams.set('nonce', args.nonce);
	url.searchParams.set('code_challenge', args.challenge);
	url.searchParams.set('code_challenge_method', 'S256');
	return url.toString();
}

export interface IdTokenClaims {
	/** Stable subject identifier from the provider (`sub`). */
	sub: string | null;
	email: string;
	emailVerified: boolean | null;
	nonce: string | null;
	issuer: string | null;
	audience: string[];
	exp: number | null;
}

/** Decode a JWT payload without verifying the signature. Callers must check claims. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length < 2 || !parts[1]) return null;
	try {
		const json = Buffer.from(parts[1], 'base64url').toString('utf8');
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function claimsFromIdToken(token: string): IdTokenClaims | { error: string } {
	const payload = decodeJwtPayload(token);
	if (!payload) return { error: 'The identity token could not be read.' };
	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	if (!email || !email.includes('@')) return { error: 'The identity token has no email claim.' };
	const audRaw = payload.aud;
	const audience = Array.isArray(audRaw)
		? audRaw.filter((v): v is string => typeof v === 'string')
		: typeof audRaw === 'string'
			? [audRaw]
			: [];
	const exp = typeof payload.exp === 'number' ? payload.exp : null;
	const emailVerified =
		typeof payload.email_verified === 'boolean'
			? payload.email_verified
			: payload.email_verified === 'true'
				? true
				: payload.email_verified === 'false'
					? false
					: null;
	return {
		sub: typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null,
		email,
		emailVerified,
		nonce: typeof payload.nonce === 'string' ? payload.nonce : null,
		issuer: typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : null,
		audience,
		exp
	};
}

export function assertIdToken(claims: IdTokenClaims, config: OidcConfig, nonce: string): string | null {
	if (claims.exp != null && claims.exp * 1000 < Date.now() - 30_000) return 'The identity token has expired.';
	if (claims.issuer && claims.issuer !== config.issuer) return 'The identity token issuer does not match.';
	if (claims.audience.length && !claims.audience.includes(config.clientId)) {
		return 'The identity token was not issued for this client.';
	}
	if (!claims.nonce || !safeEqual(claims.nonce, nonce)) return 'The identity token nonce does not match.';
	// email_verified is enforced by resolveOidcUser (missing or false is not
	// verified) so the callback can show the email_unverified copy.
	return null;
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

export interface TokenResponse {
	idToken: string | null;
	accessToken: string | null;
}

export function parseTokenResponse(body: unknown): TokenResponse | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'The token response was not valid JSON.' };
	const doc = body as Record<string, unknown>;
	if (typeof doc.error === 'string') {
		return { error: doc.error === 'invalid_grant' ? 'The sign-in code was rejected.' : 'The identity provider rejected the sign-in.' };
	}
	const idToken = typeof doc.id_token === 'string' ? doc.id_token : null;
	const accessToken = typeof doc.access_token === 'string' ? doc.access_token : null;
	if (!idToken && !accessToken) return { error: 'The token response did not include an identity token.' };
	return { idToken, accessToken };
}

export async function exchangeCode(args: {
	tokenEndpoint: string;
	config: OidcConfig;
	code: string;
	redirectUri: string;
	verifier: string;
	fetchImpl?: typeof fetch;
}): Promise<TokenResponse | { error: string }> {
	const fetchImpl = args.fetchImpl ?? fetch;
	const basic = Buffer.from(`${args.config.clientId}:${args.config.clientSecret}`).toString('base64');
	let response: Response;
	try {
		response = await fetchImpl(args.tokenEndpoint, {
			method: 'POST',
			headers: {
				accept: 'application/json',
				'content-type': 'application/x-www-form-urlencoded',
				authorization: `Basic ${basic}`
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: args.code,
				redirect_uri: args.redirectUri,
				client_id: args.config.clientId,
				code_verifier: args.verifier
			}),
			redirect: 'error'
		});
	} catch {
		return { error: 'Could not reach the token endpoint.' };
	}
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		return { error: 'The token response was not JSON.' };
	}
	if (!response.ok && !(body && typeof body === 'object' && 'error' in (body as object))) {
		return { error: `The token endpoint returned ${response.status}.` };
	}
	return parseTokenResponse(body);
}

export interface UserinfoEmail {
	sub: string | null;
	email: string;
	emailVerified: boolean | null;
}

export function parseUserinfo(body: unknown): UserinfoEmail | { error: string } {
	if (!body || typeof body !== 'object') return { error: 'The user info response was not valid JSON.' };
	const doc = body as Record<string, unknown>;
	const email = typeof doc.email === 'string' ? doc.email.trim().toLowerCase() : '';
	if (!email || !email.includes('@')) return { error: 'The identity provider did not return an email.' };
	const emailVerified =
		typeof doc.email_verified === 'boolean'
			? doc.email_verified
			: doc.email_verified === 'true'
				? true
				: doc.email_verified === 'false'
					? false
					: null;
	const sub = typeof doc.sub === 'string' && doc.sub.trim() ? doc.sub.trim() : null;
	return { sub, email, emailVerified };
}

/** Key for the per-email OIDC throttle bucket. Prefixed so an IdP email never locks the password bucket. */
export function oidcThrottleEmailKey(email: string): string {
	return `oidc:${email.trim().toLowerCase()}`;
}

export interface OidcLink {
	userId: number;
	issuer: string;
	linkedAt: string;
	lastLoginAt: string | null;
}

/** The OIDC link for a user, without the subject value. */
export function getOidcLink(userId: number): OidcLink | null {
	const row = db()
		.query('SELECT user_id, issuer, linked_at, last_login_at FROM oidc_identities WHERE user_id = ?')
		.get(userId) as { user_id: number; issuer: string; linked_at: string; last_login_at: string | null } | undefined;
	if (!row) return null;
	return { userId: row.user_id, issuer: row.issuer, linkedAt: row.linked_at, lastLoginAt: row.last_login_at };
}

/**
 * Resolve an OIDC sign-in to an existing Galene user (ADO-55). Never inserts a
 * user.
 *
 * 1. issuer+sub already pinned: sign in as that user, whatever the email says now.
 * 2. Otherwise email is used once, to link: email_verified must be exactly true.
 * 3. No user with that email: email_mismatch.
 * 4. That user is already pinned to a different subject (or issuer): sub_mismatch.
 *    Never relinks silently; an admin can unlink in Settings → Users.
 * 5. Else pin (issuer, sub) to the user and sign in.
 */
export function resolveOidcUser(input: {
	issuer: string;
	sub: string | null;
	email: string;
	emailVerified: boolean | null;
}):
	| { ok: true; userId: number; linked: boolean }
	| { ok: false; error: OidcCallbackError } {
	const issuer = input.issuer.trim().replace(/\/+$/, '');
	const sub = input.sub?.trim() ?? '';
	if (!issuer || !sub) return { ok: false, error: 'invalid' };
	const d = db();
	const pinned = d
		.query('SELECT user_id FROM oidc_identities WHERE issuer = ? AND sub = ?')
		.get(issuer, sub) as { user_id: number } | undefined;
	if (pinned) {
		d.query(`UPDATE oidc_identities SET last_login_at = datetime('now') WHERE user_id = ?`).run(pinned.user_id);
		return { ok: true, userId: pinned.user_id, linked: false };
	}
	if (input.emailVerified !== true) return { ok: false, error: 'email_unverified' };
	const email = input.email.trim().toLowerCase();
	if (!email) return { ok: false, error: 'invalid' };
	const user = d.query('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) as { id: number } | undefined;
	if (!user) return { ok: false, error: 'email_mismatch' };
	const existing = d.query('SELECT 1 AS o FROM oidc_identities WHERE user_id = ?').get(user.id);
	if (existing) return { ok: false, error: 'sub_mismatch' };
	try {
		d.query(
			`INSERT INTO oidc_identities (user_id, issuer, sub, linked_at, last_login_at)
			 VALUES (?, ?, ?, datetime('now'), datetime('now'))`
		).run(user.id, issuer, sub);
	} catch {
		// A concurrent callback pinned this user or subject first.
		return { ok: false, error: 'sub_mismatch' };
	}
	return { ok: true, userId: user.id, linked: true };
}

/**
 * Throttle + resolve for the callback (ADO-55). Rejections count toward the
 * per-IP bucket and a per-email bucket (prefixed, see oidcThrottleEmailKey);
 * success clears both. A locked bucket returns `throttled` with the generic
 * lockout message.
 */
export function completeOidcSignIn(input: {
	ip: string;
	issuer: string;
	sub: string | null;
	email: string;
	emailVerified: boolean | null;
}):
	| { ok: true; userId: number; linked: boolean }
	| { ok: false; error: OidcCallbackError; throttled?: string } {
	const emailKey = input.email ? oidcThrottleEmailKey(input.email) : undefined;
	try {
		assertAllowed(input.ip, emailKey);
	} catch (err) {
		return { ok: false, error: 'invalid', throttled: (err as Error).message };
	}
	const result = resolveOidcUser(input);
	if (!result.ok) {
		recordFailure(input.ip, emailKey);
		return result;
	}
	clearOnSuccess(input.ip, emailKey);
	return result;
}

export function callbackErrorCopy(code: OidcCallbackError, label: string): { title: string; body: string } {
	const name = label || 'SSO';
	if (code === 'access_denied') {
		return {
			title: 'Access denied',
			body: `${name} did not approve this sign-in. You may have cancelled, or your account isn’t allowed for Galene. Try again, or use a local password if this server allows it.`
		};
	}
	if (code === 'not_provisioned' || code === 'email_mismatch') {
		return {
			title: 'No Galene account for this email',
			body: `You signed in at ${name}, but no Galene user has that email. Galene does not create accounts from single sign-on. Ask a Galene admin to create a user with exactly the email ${name} sends, then try again.`
		};
	}
	if (code === 'email_unverified') {
		return {
			title: 'Email not verified',
			body: `${name} did not confirm that your email is verified, so Galene can’t use it to find your account. Verify the email at ${name} (or ask its admin to mark it verified), then try again.`
		};
	}
	if (code === 'sub_mismatch') {
		return {
			title: 'Account linked to a different sign-in',
			body: `This Galene account is already linked to a different ${name} identity. Sign in with the ${name} account you used before, or ask a Galene admin to unlink single sign-on for this user in Settings → Users.`
		};
	}
	return {
		title: 'Couldn’t complete sign-in',
		body: 'Something went wrong confirming this sign-in. Go back and try again, or use a local password if this server allows it.'
	};
}
