/**
 * Public demo mode (ADO-37 / ADO-38 / ADO-39). When GALENE_DEMO=1, sensitive and
 * destructive features stay visible in Settings (read-only UI) but mutating APIs
 * are refused. Locked: bank sync, backups, API tokens / MCP, advisor access,
 * SSO settings, user account create/delete/admin/password, 2FA enroll/use, and
 * Data wipe / bulk delete. A shared demo login is bootstrapped with realistic
 * seed data on first start (empty users table). MFA factors on the seed user
 * are cleared on every boot so a restore snapshot cannot lock visitors out.
 *
 * Precedence: any of 1/true/yes/on enables; unset or 0/false/no/off disables.
 *
 * Keep this module free of `@sveltejs/kit` imports so unit tests can load it
 * without a full Kit install. Route guards live in `demoGuard.ts`.
 */

import { createUser, canPublicSignup } from './users';
import { db } from './db';

/** Public demo credentials — intentional; used on the public demo host. */
export const DEMO_EMAIL = 'demo@test.com';
export const DEMO_PASSWORD = 'demopass1';
export const DEMO_NAME = 'Demo';

/**
 * Settings routes whose mutations are refused in demo mode. Pages stay
 * reachable (GET) so visitors can see the UI as read-only.
 */
export const DEMO_LOCKED_SETTINGS = new Set([
	'/(app)/settings/sync',
	'/(app)/settings/backups',
	'/(app)/settings/api',
	'/(app)/settings/advisor',
	'/(app)/settings/users',
	'/(app)/settings/data'
]);

/** Form action names under Security that change SSO. */
export const DEMO_LOCKED_OIDC_ACTIONS = new Set(['save-oidc', 'test-oidc']);

/** Form action names under Security that enroll / change / disable TOTP. */
export const DEMO_LOCKED_MFA_ACTIONS = new Set(['begin', 'confirm', 'disable']);

/** Form action names under Users that mutate accounts (create is also gated in users.ts). */
export const DEMO_LOCKED_USER_ACTIONS = new Set(['create', 'delete', 'toggle-admin', 'reset-password']);

/** Form action names under Data that wipe / bulk-delete. */
export const DEMO_LOCKED_DATA_ACTIONS = new Set(['delete', 'delete-all']);

function envTruthy(name: string): boolean {
	const raw = process.env[name]?.trim().toLowerCase() ?? '';
	return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function isDemoMode(): boolean {
	return envTruthy('GALENE_DEMO');
}

export function demoBlockedMessage(feature?: string): string {
	const what = feature ? `${feature} is` : 'This action is';
	return `${what} disabled on the public demo. Run your own Galene instance to use it.`;
}

/**
 * Strip every MFA method and backup code for all users. Called on every demo
 * boot (after bootstrap / after a scheduled restore) so a golden seed that
 * accidentally includes TOTP cannot lock the shared login.
 */
export function clearDemoMfaFactors(): void {
	if (!isDemoMode()) return;
	const d = db();
	d.run('BEGIN');
	try {
		d.query('DELETE FROM mfa_challenges').run();
		d.query('DELETE FROM user_mfa_backup_codes').run();
		d.query('DELETE FROM user_mfa_methods').run();
		d.run('COMMIT');
	} catch (error) {
		d.run('ROLLBACK');
		throw error;
	}
}

/**
 * Create the shared demo admin + seed data when the database has no users.
 * Idempotent: no-op when accounts already exist. Always clears MFA factors
 * while demo mode is on (safe after restore from a snapshot).
 */
export function ensureDemoBootstrap(): void {
	if (!isDemoMode()) return;
	if (canPublicSignup()) {
		const result = createUser({
			name: DEMO_NAME,
			email: DEMO_EMAIL,
			password: DEMO_PASSWORD,
			isAdmin: true,
			demoData: true,
			allowDemoBootstrap: true
		});
		if (!result.ok) {
			throw new Error(`Demo bootstrap failed: ${result.error}`);
		}
	}
	clearDemoMfaFactors();
}

export function lockedFeatureLabel(routeId: string): string {
	switch (routeId) {
		case '/(app)/settings/sync':
			return 'Bank sync';
		case '/(app)/settings/backups':
			return 'Backups';
		case '/(app)/settings/api':
			return 'API tokens';
		case '/(app)/settings/advisor':
			return 'Advisor access';
		case '/(app)/settings/users':
			return 'User account changes';
		case '/(app)/settings/data':
			return 'Data deletion';
		default:
			return 'This feature';
	}
}

/** Extract a SvelteKit form action name from `?/action` query keys. */
export function extractActionName(url: URL): string {
	for (const key of url.searchParams.keys()) {
		if (key.startsWith('/')) return key.slice(1);
	}
	return '';
}
