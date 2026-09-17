import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type { User } from '$lib/types';
import { db } from './db';
import { hashToken, tokenHint, verifyToken } from './tokenHash';

const SESSION_COOKIE = 'galene_session';
const SESSION_DAYS = 30;

export function sessionCookieName() {
	return SESSION_COOKIE;
}

/**
 * Whether the session cookie gets the `Secure` flag. Defaults to production
 * (NODE_ENV=production) so TLS deployments get secure cookies, but can be forced
 * with GALENE_COOKIE_SECURE (1/true or 0/false) — e.g. set 0 when serving plain
 * HTTP with no TLS-terminating proxy, otherwise browsers won't send the cookie
 * and login silently fails.
 *
 * Note: Vite replaces `process.env.NODE_ENV` in the SSR bundle with the
 * *build-time* value, so container builds must run with NODE_ENV=production
 * (the Dockerfile does); GALENE_COOKIE_SECURE is read at runtime and is the
 * reliable override.
 */
export function isSecureCookie(): boolean {
	const override = process.env.GALENE_COOKIE_SECURE?.trim().toLowerCase();
	if (override === '1' || override === 'true' || override === 'yes' || override === 'on') return true;
	if (override === '0' || override === 'false' || override === 'no' || override === 'off') return false;
	return process.env.NODE_ENV === 'production';
}

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 32).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const candidate = scryptSync(password, salt, 32);
	const expected = Buffer.from(hash, 'hex');
	return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Create a session. Only the salted hash and a one-way hint are stored; the
 * raw token is returned for the cookie and never written to the database.
 */
export function createSession(userId: number): string {
	const token = randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
	const { hint, salt, hash } = hashToken(token);
	db()
		.query('INSERT INTO sessions (token_hint, user_id, salt, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)')
		.run(hint, userId, salt, hash, expiresAt);
	return token;
}

export function destroySession(token: string) {
	db().query('DELETE FROM sessions WHERE token_hint = ?').run(tokenHint(token));
}

export function setSessionCookie(cookies: Cookies, token: string) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecureCookie(),
		maxAge: SESSION_DAYS * 24 * 3600
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.set(SESSION_COOKIE, '', {
		path: '/',
		maxAge: 0,
		httpOnly: true,
		sameSite: 'lax',
		// Match the set cookie's Secure flag, otherwise the browser treats the
		// clear as a different cookie and the original one is never removed.
		secure: isSecureCookie()
	});
}

const MFA_COOKIE = 'galene_mfa';

/** MFA challenge lifetime in seconds; the challenge row expires with it. */
export const MFA_CHALLENGE_MAX_AGE = 10 * 60;

export function mfaCookieName() {
	return MFA_COOKIE;
}

/**
 * Short-lived cookie carrying the pending MFA challenge token, set after a
 * correct password and before any session cookie (issue #30). Same flags as
 * the session cookie.
 */
export function setMfaCookie(cookies: Cookies, token: string) {
	cookies.set(MFA_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecureCookie(),
		maxAge: MFA_CHALLENGE_MAX_AGE
	});
}

export function clearMfaCookie(cookies: Cookies) {
	cookies.set(MFA_COOKIE, '', {
		path: '/',
		maxAge: 0,
		httpOnly: true,
		sameSite: 'lax',
		secure: isSecureCookie()
	});
}

/**
 * Resolve a session token to its user. The raw token is hashed to a hint to
 * locate the row, then verified against the stored per-row salt + scrypt
 * hash. Returns null for unknown, mismatched, or expired tokens.
 */
export function getUserByToken(token: string): User | null {
	const row = db()
		.query(
			`SELECT u.id, u.name, u.email, u.is_admin, s.salt, s.token_hash
			 FROM sessions s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hint = ? AND s.expires_at > datetime('now')`
		)
		.get(tokenHint(token)) as
		| { id: number; name: string; email: string; is_admin: number; salt: string; token_hash: string }
		| undefined;
	if (!row || !verifyToken(token, row.salt, row.token_hash)) return null;
	return { id: row.id, name: row.name, email: row.email, is_admin: row.is_admin };
}
