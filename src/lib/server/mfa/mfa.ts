import { randomBytes } from 'node:crypto';
import { toDataURL } from 'qrcode';
import { MFA_CHALLENGE_MAX_AGE, hashPassword, verifyPassword } from '../auth';
import { db } from '../db';
import { hashToken, tokenHint, verifyToken } from '../tokenHash';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/**
 * TOTP two-factor (issue #30). Method-agnostic on purpose: the `type`
 * discriminator on user_mfa_methods and `method_type` on mfa_challenges leave
 * room for a future email OTP once SMTP exists — only the verification branch
 * in verifyLoginChallenge is TOTP-specific.
 */

const BACKUP_CODE_COUNT = 8;
// Unambiguous alphabet (no 0/O/1/I); 32 chars so one random byte picks one.
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MfaMethodInfo {
	type: string;
	label: string;
	enabled: boolean;
	created_at: string;
	confirmed_at: string | null;
}

/** A user's MFA methods. The TOTP secret is never included. */
export function listMethods(userId: number): MfaMethodInfo[] {
	return (
		db()
			.query(
				'SELECT type, label, enabled, created_at, confirmed_at FROM user_mfa_methods WHERE user_id = ? ORDER BY id'
			)
			.all(userId) as {
			type: string;
			label: string;
			enabled: number;
			created_at: string;
			confirmed_at: string | null;
		}[]
	).map((m) => ({ ...m, enabled: m.enabled === 1 }));
}

function getEnabledTotpSecret(userId: number): string | null {
	const row = db()
		.query("SELECT secret FROM user_mfa_methods WHERE user_id = ? AND type = 'totp' AND enabled = 1")
		.get(userId) as { secret: string } | undefined;
	return row?.secret ?? null;
}

/** True if the user has an enabled TOTP method (gates the login second step). */
export function hasEnabledTotp(userId: number): boolean {
	return getEnabledTotpSecret(userId) !== null;
}

/** QR data URL for the otpauth:// URI of a (possibly not-yet-confirmed) secret. */
export async function totpQrDataUrl(secret: string, accountName: string): Promise<string> {
	return toDataURL(otpauthUri(secret, accountName), { width: 256, margin: 1 });
}

/**
 * Start enrollment: a fresh secret plus the otpauth:// URI and a QR data URL
 * for the authenticator app. The secret is only shown during enrollment —
 * it is stored at rest but never returned again after confirmation.
 */
export async function beginTotpEnroll(accountName: string): Promise<{
	secret: string;
	otpauthUrl: string;
	qrDataUrl: string;
}> {
	const secret = generateTotpSecret();
	return {
		secret,
		otpauthUrl: otpauthUri(secret, accountName),
		qrDataUrl: await totpQrDataUrl(secret, accountName)
	};
}

function generateBackupCode(): string {
	const bytes = randomBytes(8);
	let code = '';
	for (const b of bytes) code += BACKUP_ALPHABET[b % 32];
	return code;
}

/**
 * Confirm enrollment: the presented code must be a valid TOTP for the
 * presented secret. On success the method is enabled and one-time backup
 * codes are generated; the plaintext codes are returned exactly once.
 */
export function confirmTotpEnroll(
	userId: number,
	secret: string,
	code: string
): { ok: true; backupCodes: string[] } | { ok: false; error: string } {
	const normalized = secret.trim().toUpperCase();
	if (!/^[A-Z2-7]{16,64}$/.test(normalized)) {
		return { ok: false, error: 'Enter the secret exactly as shown.' };
	}
	if (!verifyTotp(normalized, code)) {
		return { ok: false, error: 'That code is not valid. Check your authenticator app and try again.' };
	}
	const user = db().query('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
	if (!user) return { ok: false, error: 'Account not found.' };
	const d = db();
	d.run('BEGIN');
	try {
		// Re-enrollment replaces any existing method and its backup codes.
		d.query("DELETE FROM user_mfa_methods WHERE user_id = ? AND type = 'totp'").run(userId);
		d.query('DELETE FROM user_mfa_backup_codes WHERE user_id = ?').run(userId);
		d.query(
			"INSERT INTO user_mfa_methods (user_id, type, label, secret, enabled, confirmed_at) VALUES (?, 'totp', ?, ?, 1, datetime('now'))"
		).run(userId, user.email, normalized);
		const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());
		const insert = d.query('INSERT INTO user_mfa_backup_codes (user_id, code_hash) VALUES (?, ?)');
		for (const c of codes) insert.run(userId, hashPassword(c));
		d.run('COMMIT');
		return { ok: true, backupCodes: codes };
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

/**
 * Consume a one-time backup code. Returns true if the presented code matched
 * an unused one (it is then marked used).
 */
function useBackupCode(userId: number, code: string): boolean {
	const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '');
	if (!/^[A-Z0-9]{8}$/.test(normalized)) return false;
	const rows = db()
		.query('SELECT id, code_hash FROM user_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL')
		.all(userId) as { id: number; code_hash: string }[];
	for (const row of rows) {
		if (verifyPassword(normalized, row.code_hash)) {
			db().query("UPDATE user_mfa_backup_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
			return true;
		}
	}
	return false;
}

/**
 * Disable: the password plus a current TOTP code or a one-time backup code
 * (the backup code path keeps a lost phone from locking the user out).
 */
export function disableTotp(userId: number, password: string, code: string): { ok: true } | { ok: false; error: string } {
	const user = db()
		.query('SELECT password_hash FROM users WHERE id = ?')
		.get(userId) as { password_hash: string } | undefined;
	if (!user || !verifyPassword(password, user.password_hash)) {
		return { ok: false, error: 'Password is incorrect.' };
	}
	const secret = getEnabledTotpSecret(userId);
	if (secret === null) return { ok: true }; // nothing to disable
	const presented = code.trim().toUpperCase().replace(/[\s-]/g, '');
	if (!verifyTotp(secret, presented) && !useBackupCode(userId, presented)) {
		return { ok: false, error: 'That code is not valid. Use a code from your authenticator app or a backup code.' };
	}
	const d = db();
	d.run('BEGIN');
	try {
		d.query("DELETE FROM user_mfa_methods WHERE user_id = ? AND type = 'totp'").run(userId);
		d.query('DELETE FROM user_mfa_backup_codes WHERE user_id = ?').run(userId);
		d.run('COMMIT');
		return { ok: true };
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

/** How many backup codes exist / remain unused. No hashes leave the server. */
export function backupCodeCounts(userId: number): { total: number; unused: number } {
	const row = db()
		.query(
			'SELECT COUNT(*) AS total, SUM(CASE WHEN used_at IS NULL THEN 1 ELSE 0 END) AS unused FROM user_mfa_backup_codes WHERE user_id = ?'
		)
		.get(userId) as { total: number; unused: number | null };
	return { total: row.total, unused: row.unused ?? 0 };
}

/**
 * Issue a short-lived challenge for the login second step. Called after a
 * correct password, before any session cookie is set. The raw token is
 * returned for the cookie; only the salted hash and a one-way hint are
 * stored (same pattern as sessions).
 */
export function createLoginChallenge(userId: number): string {
	const token = randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + MFA_CHALLENGE_MAX_AGE * 1000).toISOString();
	const { hint, salt, hash } = hashToken(token);
	db()
		.query(
			"INSERT INTO mfa_challenges (token_hint, user_id, salt, token_hash, method_type, expires_at) VALUES (?, ?, ?, ?, 'totp', ?)"
		)
		.run(hint, userId, salt, hash, expiresAt);
	return token;
}

/** The pending challenge for a cookie token, or null if unknown or expired. */
export function getLoginChallenge(token: string): {
	userId: number;
	email: string;
	methodType: string;
	expiresAt: string;
} | null {
	const row = db()
		.query(
			`SELECT s.user_id, u.email, s.method_type, s.salt, s.token_hash, s.expires_at
			 FROM mfa_challenges s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.token_hint = ? AND s.expires_at > datetime('now')`
		)
		.get(tokenHint(token)) as
		| { user_id: number; email: string; method_type: string; salt: string; token_hash: string; expires_at: string }
		| undefined;
	if (!row || !verifyToken(token, row.salt, row.token_hash)) return null;
	return { userId: row.user_id, email: row.email, methodType: row.method_type, expiresAt: row.expires_at };
}

/** Remove a challenge (after a successful or cancelled second step). */
export function destroyLoginChallenge(token: string) {
	db().query('DELETE FROM mfa_challenges WHERE token_hint = ?').run(tokenHint(token));
}

/**
 * Verify the login second step: a current TOTP code, or a one-time backup
 * code. The challenge is consumed on success. The challenge carries the
 * method type so a future email OTP (once SMTP exists) can be verified here
 * without touching the session core.
 */
export function verifyLoginChallenge(
	token: string,
	code: string
): { ok: true; userId: number } | { ok: false; error: string } {
	const challenge = getLoginChallenge(token);
	if (!challenge) return { ok: false, error: 'This sign-in attempt has expired. Sign in again.' };
	const presented = code.trim();
	const secret = getEnabledTotpSecret(challenge.userId);
	if (secret !== null && verifyTotp(secret, presented)) {
		destroyLoginChallenge(token);
		return { ok: true, userId: challenge.userId };
	}
	if (useBackupCode(challenge.userId, presented)) {
		destroyLoginChallenge(token);
		return { ok: true, userId: challenge.userId };
	}
	return { ok: false, error: 'That code is not valid. Check your authenticator app or use a backup code.' };
}
