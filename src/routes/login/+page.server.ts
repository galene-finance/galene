import { redirect } from '@sveltejs/kit';
import {
	clearMfaCookie,
	clearSessionCookie,
	createSession,
	destroySession,
	hashPassword,
	mfaCookieName,
	setMfaCookie,
	setSessionCookie,
	verifyPassword
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { assertAllowed, clearOnSuccess, recordFailure } from '$lib/server/loginThrottle';
import {
	createLoginChallenge,
	destroyLoginChallenge,
	getLoginChallenge,
	hasEnabledTotp,
	verifyLoginChallenge
} from '$lib/server/mfa/mfa';
import { seedDemoData } from '$lib/server/demoData';
import { ensureDefaultTransferCategories } from '$lib/server/finance';
import { canPublicSignup } from '$lib/server/users';
import { versionLabel } from '$lib/version';

export function load({ locals, cookies }) {
	if (locals.user) redirect(303, '/');
	// A valid pending MFA challenge (set after a correct password) means the
	// page shows the second step instead of the password form.
	const mfaToken = cookies.get(mfaCookieName());
	const challenge = mfaToken ? getLoginChallenge(mfaToken) : null;
	return {
		setup: canPublicSignup(),
		version: versionLabel(),
		mfa: challenge ? { email: challenge.email } : null
	};
}

export const actions = {
	signup: async (event) => {
		const { request, cookies } = event;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		// Signup is only open before the first account exists. The UI hides
		// the form after setup, but the action enforces the same gate so a
		// hand-crafted POST can't register more accounts.
		if (!canPublicSignup()) {
			return {
				error: 'This server has already been set up. Ask an administrator to create your account.',
				name,
				email
			};
		}
		// Light per-IP throttle (issue #19): failed validation and duplicate
		// email attempts accumulate, a successful signup clears the bucket.
		// Only the IP bucket is used here — the email bucket is left to the
		// login flow so a pre-setup lockout can't block the first account.
		const ip = event.getClientAddress() ?? 'unknown';
		try {
			assertAllowed(ip);
		} catch (error) {
			return { error: (error as Error).message, name, email };
		}
		if (!name || !email || password.length < 8) {
			recordFailure(ip);
			return { error: 'Please fill in all fields. Password must be at least 8 characters.', name, email };
		}
		const existing = db().query('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
		if (existing) {
			recordFailure(ip);
			return { error: 'An account with this email already exists.', name, email };
		}

		// The first account ever created (server setup) is always the admin.
		// BEGIN IMMEDIATE takes the write lock up front, so two concurrent
		// first signups (separate processes sharing the database) can't both
		// read an empty users table: the loser waits for the lock, re-counts,
		// sees the committed user, and bails without inserting a second one.
		const d = db();
		let userId: number;
		d.run('BEGIN IMMEDIATE');
		try {
			const count = (d.query('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
			if (count > 0) {
				d.run('ROLLBACK');
				return {
					error: 'This server has already been set up. Ask an administrator to create your account.',
					name,
					email
				};
			}
			const result = d
				.query('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)')
				.run(name, email, hashPassword(password));
			userId = Number(result.lastInsertRowid);
			if (form.get('demo_data')) seedDemoData(userId, { inTransaction: true });
			else ensureDefaultTransferCategories(userId);
			d.run('COMMIT');
		} catch (error) {
			d.run('ROLLBACK');
			throw error;
		}
		clearOnSuccess(ip);
		const token = createSession(userId);
		setSessionCookie(cookies, token);
		redirect(303, '/');
	},

	login: async (event) => {
		const { request, cookies } = event;
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		// Rate limiting (issue #19): a locked IP or email is rejected before
		// touching the user table, with a generic message that never reveals
		// whether the email exists.
		const ip = event.getClientAddress() ?? 'unknown';
		try {
			assertAllowed(ip, email);
		} catch (error) {
			return { error: (error as Error).message, email };
		}
		const row = db()
			.query('SELECT id, password_hash FROM users WHERE lower(email) = lower(?)')
			.get(email) as { id: number; password_hash: string } | undefined;
		if (!row || !verifyPassword(password, row.password_hash)) {
			recordFailure(ip, email);
			return { error: 'Invalid email or password.', email };
		}
		clearOnSuccess(ip, email);
		// Second step (issue #30): an enabled TOTP method delays the session
		// until a code is verified. The challenge token goes in a short-lived
		// cookie; no session is set yet. API bearer tokens intentionally
		// bypass this.
		if (hasEnabledTotp(row.id)) {
			setMfaCookie(cookies, createLoginChallenge(row.id));
			return { mfa: true, email };
		}
		const token = createSession(row.id);
		setSessionCookie(cookies, token);
		redirect(303, '/');
	},

	verify: async (event) => {
		const { request, cookies } = event;
		const form = await request.formData();
		const code = String(form.get('code') ?? '').trim();
		const token = cookies.get(mfaCookieName());
		if (!token) return { error: 'This sign-in attempt has expired. Sign in again.' };
		// Same throttle as the password step (issue #19): a locked IP or
		// email can't brute-force the 6-digit code either.
		const ip = event.getClientAddress() ?? 'unknown';
		const challenge = getLoginChallenge(token);
		const email = challenge?.email ?? '';
		try {
			assertAllowed(ip, email || undefined);
		} catch (error) {
			return { error: (error as Error).message };
		}
		const result = verifyLoginChallenge(token, code);
		if (!result.ok) {
			// Only a real code failure counts; an expired challenge is not an
			// attack signal.
			if (challenge) recordFailure(ip, email);
			return { error: result.error };
		}
		clearOnSuccess(ip, email);
		clearMfaCookie(cookies);
		const session = createSession(result.userId);
		setSessionCookie(cookies, session);
		redirect(303, '/');
	},

	cancel: async ({ cookies }) => {
		const token = cookies.get(mfaCookieName());
		if (token) destroyLoginChallenge(token);
		clearMfaCookie(cookies);
		redirect(303, '/login');
	},

	logout: async ({ cookies }) => {
		const token = cookies.get('galene_session');
		if (token) destroySession(token);
		clearSessionCookie(cookies);
		clearMfaCookie(cookies);
		redirect(303, '/login');
	}
};
