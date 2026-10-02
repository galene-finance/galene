import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import {
	DEMO_LOCKED_OIDC_ACTIONS,
	DEMO_LOCKED_SETTINGS,
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
 * Bounce demo visitors away from locked Settings pages (GET). Mutations on
 * those routes (and SSO save/test) are refused with 403.
 */
export function guardDemoMode(event: RequestEvent): void {
	if (!isDemoMode()) return;
	const id = event.route.id ?? '';

	if (DEMO_LOCKED_SETTINGS.has(id)) {
		if (MUTATING.has(event.request.method)) {
			refuseDemo(lockedFeatureLabel(id));
		}
		if (event.request.method === 'GET' || event.request.method === 'HEAD') {
			redirect(303, '/settings');
		}
	}

	if (id === '/(app)/settings/security' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (DEMO_LOCKED_OIDC_ACTIONS.has(actionName)) {
			refuseDemo('Single sign-on');
		}
	}

	if (id === '/login' && MUTATING.has(event.request.method)) {
		const actionName = extractActionName(event.url);
		if (actionName === 'signup') {
			refuseDemo('Account creation');
		}
	}
}
