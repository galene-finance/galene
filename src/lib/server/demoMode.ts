/**
 * Public demo mode (ADO-37). When GALENE_DEMO=1, bank sync, backups, API
 * tokens / MCP, advisor access, SSO settings, and new account creation are
 * locked in both the UI and the server. A shared demo login is bootstrapped
 * with realistic seed data on first start (empty users table).
 *
 * Precedence: any of 1/true/yes/on enables; unset or 0/false/no/off disables.
 *
 * Keep this module free of `@sveltejs/kit` imports so unit tests can load it
 * without a full Kit install. Route guards live in `demoGuard.ts`.
 */

import { createUser, canPublicSignup } from './users';

/** Public demo credentials — intentional; used on the public demo host. */
export const DEMO_EMAIL = 'demo@test.com';
export const DEMO_PASSWORD = 'demopass1';
export const DEMO_NAME = 'Demo';

/** Settings routes that are fully locked in demo mode (page + actions). */
export const DEMO_LOCKED_SETTINGS = new Set([
	'/(app)/settings/sync',
	'/(app)/settings/backups',
	'/(app)/settings/api',
	'/(app)/settings/advisor',
	'/(app)/settings/users'
]);

/** Form action names under Security that change SSO (TOTP stays available). */
export const DEMO_LOCKED_OIDC_ACTIONS = new Set(['save-oidc', 'test-oidc']);

/** Card hrefs hidden from the Settings hub in demo mode. */
export const DEMO_HIDDEN_SETTINGS_HREFS = new Set([
	'/settings/sync',
	'/settings/backups',
	'/settings/api',
	'/settings/advisor',
	'/settings/users'
]);

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
 * Create the shared demo admin + seed data when the database has no users.
 * Idempotent: no-op when accounts already exist. Safe to call on every boot.
 */
export function ensureDemoBootstrap(): void {
	if (!isDemoMode()) return;
	if (!canPublicSignup()) return;
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
			return 'User account creation';
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
