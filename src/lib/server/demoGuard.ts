import { error, type RequestEvent } from '@sveltejs/kit';
import {
	DEMO_LOCKED_DATA_ACTIONS,
	DEMO_LOCKED_MFA_ACTIONS,
	DEMO_LOCKED_OIDC_ACTIONS,
	DEMO_LOCKED_SETTINGS,
	DEMO_LOCKED_USER_ACTIONS,
	demoBlockedMessage,
	extractActionName,
	isDemoMode,
	lockedFeatureLabel
} from './demoMode';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Fail an action/API call when demo mode is on. */
export function refuseDemo(feature?: string): never {
	error(403, demoBlockedMessage(feature));
}

/**
 * Demo Settings pages stay visible (GET) as read-only. Mutations on locked
 * routes, SSO/2FA actions, user mutations, Data wipes, and signup are 403.
 */
export function guardDemoMode(event: RequestEvent): void {
	if (!isDemoMode()) return;
	const id = event.route.id ?? '';

	if (DEMO_LOCKED_SETTINGS.has(id) && MUTATING.has(event.request.method)) {
		refuseDemo(lockedFeatureLabel(id));
	}

	if (id === '/(app)/settings/security' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (DEMO_LOCKED_OIDC_ACTIONS.has(actionName)) {
			refuseDemo('Single sign-on');
		}
		if (DEMO_LOCKED_MFA_ACTIONS.has(actionName)) {
			refuseDemo('Two-factor authentication');
		}
	}

	// Redundant with DEMO_LOCKED_SETTINGS for users/data, but keeps action-name
	// checks explicit if a future route splits actions across pages.
	if (id === '/(app)/settings/users' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (DEMO_LOCKED_USER_ACTIONS.has(actionName)) {
			refuseDemo('User account changes');
		}
	}

	if (id === '/(app)/settings/data' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (DEMO_LOCKED_DATA_ACTIONS.has(actionName)) {
			refuseDemo('Data deletion');
		}
	}

	if (id === '/login' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (actionName === 'signup') {
			refuseDemo('Account creation');
		}
	}
}
