import { hashPassword } from './auth';
import { db } from './db';
import { seedDemoData } from './demoData';
import { ensureDefaultTransferCategories } from './finance';

export interface UserRow {
	id: number;
	name: string;
	email: string;
	is_admin: number;
	created_at: string;
}

/** All accounts on this server, oldest first (the setup account first). */
export function listUsers(): UserRow[] {
	return db()
		.query('SELECT id, name, email, is_admin, created_at FROM users ORDER BY id')
		.all() as UserRow[];
}

export function getUserRow(id: number): UserRow | null {
	const row = db().query('SELECT id, name, email, is_admin, created_at FROM users WHERE id = ?').get(id) as
		| UserRow
		| undefined;
	return row ?? null;
}

/**
 * True while no account exists yet, i.e. the server is in first-setup mode
 * and the public signup form on /login may create the (admin) account.
 * Shared by the login load and signup action so the UI gate and the server
 * gate can't drift apart.
 */
export function canPublicSignup(): boolean {
	const row = db().query('SELECT COUNT(*) AS c FROM users').get() as { c: number };
	return row.c === 0;
}

function adminCount(): number {
	return (db().query('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get() as { c: number }).c;
}

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Create a new account (admin action). The new account signs in with the
 * given password; demo data is optional and only ever written under the new
 * account's own user_id.
 */
export function createUser(input: {
	name: string;
	email: string;
	password: string;
	isAdmin: boolean;
	demoData: boolean;
}): { ok: true; userId: number } | { ok: false; error: string } {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	if (!name) return { ok: false, error: 'Enter a name.' };
	if (!isEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
	if (input.password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
	const existing = db().query('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
	if (existing) return { ok: false, error: 'An account with this email already exists.' };

	const d = db();
	d.run('BEGIN');
	try {
		const result = d
			.query('INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)')
			.run(name, email, hashPassword(input.password), input.isAdmin ? 1 : 0);
		const userId = Number(result.lastInsertRowid);
		if (input.demoData) seedDemoData(userId, { inTransaction: true });
		else ensureDefaultTransferCategories(userId);
		d.run('COMMIT');
		return { ok: true, userId };
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

/**
 * Grant or revoke the admin role. Self-demotion is blocked, and the last
 * remaining admin can never be demoted, so the server always keeps at least
 * one admin.
 */
export function setUserAdmin(
	actorId: number,
	targetId: number,
	isAdmin: boolean
): { ok: true } | { ok: false; error: string } {
	const target = getUserRow(targetId);
	if (!target) return { ok: false, error: 'User not found.' };
	if (target.is_admin === (isAdmin ? 1 : 0)) return { ok: true };
	if (!isAdmin) {
		if (targetId === actorId) return { ok: false, error: 'You can\u2019t demote your own account.' };
		if (adminCount() <= 1)
			return { ok: false, error: 'At least one admin is required. Promote another account first.' };
	}
	db().query('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, targetId);
	return { ok: true };
}

/**
 * Delete an account and all of its data (the schema cascades everything).
 * Self-deletion is blocked, and the last remaining admin can't be deleted.
 */
export function deleteUser(actorId: number, targetId: number): { ok: true } | { ok: false; error: string } {
	const target = getUserRow(targetId);
	if (!target) return { ok: false, error: 'User not found.' };
	if (targetId === actorId) return { ok: false, error: 'You can\u2019t delete your own account.' };
	if (target.is_admin === 1 && adminCount() <= 1)
		return { ok: false, error: 'At least one admin is required. Promote another account first.' };
	db().query('DELETE FROM users WHERE id = ?').run(targetId);
	return { ok: true };
}

/** Replace a user's password (admin action; the user signs in with the new one). */
export function resetPassword(
	actorId: number,
	targetId: number,
	password: string
): { ok: true } | { ok: false; error: string } {
	const target = getUserRow(targetId);
	if (!target) return { ok: false, error: 'User not found.' };
	if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
	db().query('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), targetId);
	return { ok: true };
}
