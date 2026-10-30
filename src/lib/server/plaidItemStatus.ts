/**
 * One classifier for Plaid item error codes. Reconnect lists, banners, and
 * the settings labels all derive from this module — do not copy the code
 * lists elsewhere.
 */
import type { PlaidItemSyncState } from '../types';

const RECONNECT_CODES = [
	'ITEM_LOGIN_REQUIRED',
	'PENDING_EXPIRATION',
	'PENDING_DISCONNECT',
	'USER_PERMISSION_REVOKED',
	'USER_ACCOUNT_REVOKED',
	'ITEM_LOCKED'
] as const;

const RESELECT_CODES = ['NO_ACCOUNTS'] as const;

const TEMPORARY_CODES = [
	'INSTITUTION_DOWN',
	'INSTITUTION_NOT_RESPONDING',
	'INSTITUTION_NOT_AVAILABLE',
	'PRODUCT_NOT_READY',
	'RATE_LIMIT_EXCEEDED',
	'INTERNAL_SERVER_ERROR'
] as const;

export const RECONNECT_ERROR_CODES = RECONNECT_CODES;
export type ReconnectErrorCode = (typeof RECONNECT_CODES)[number];

const RECONNECT_SET = new Set<string>(RECONNECT_CODES);
const RESELECT_SET = new Set<string>(RESELECT_CODES);
const TEMPORARY_SET = new Set<string>(TEMPORARY_CODES);

export type PlaidFailureKind = 'reconnect' | 'reselect_accounts' | 'temporary' | 'error';

export interface PlaidItemClassification {
	kind: PlaidFailureKind;
	/** Settings list status, for example "needs re-login". */
	label: string;
	state: Exclude<PlaidItemSyncState, 'connected'>;
	reason: string;
	nextStep: string;
	/** Offer the existing Link update-mode Reconnect action. */
	offerReconnect: boolean;
	/** Update-mode link token should enable account selection. */
	accountSelection: boolean;
}

/** Used only when no failed item can be named. */
export const PLAID_PARTIAL_FAILURE_FALLBACK =
	'Some linked institutions could not be synced. The others were updated.';

const BANNER_MAX = 480;

export function isReconnectCode(code: string | null | undefined): code is ReconnectErrorCode {
	return !!code && RECONNECT_SET.has(code);
}

function displayCode(code: string | null | undefined): string | null {
	if (!code) return null;
	const cleaned = code.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
	return cleaned || null;
}

/** Classify a Plaid error_code. Null and unknown codes are a generic error. */
export function classifyPlaidError(code: string | null | undefined): PlaidItemClassification {
	const normalized = code?.trim() || null;
	if (normalized && RECONNECT_SET.has(normalized)) {
		return {
			kind: 'reconnect',
			state: 'needs_relogin',
			label: 'needs re-login',
			reason: 'This institution needs you to sign in again.',
			nextStep: 'Reconnect.',
			offerReconnect: true,
			accountSelection: false
		};
	}
	if (normalized && RESELECT_SET.has(normalized)) {
		return {
			kind: 'reselect_accounts',
			state: 'reselect_accounts',
			label: 'choose accounts again',
			reason: 'Plaid found no accounts to sync.',
			nextStep: 'Reconnect it and choose the accounts to share.',
			offerReconnect: true,
			accountSelection: true
		};
	}
	if (normalized && TEMPORARY_SET.has(normalized)) {
		return {
			kind: 'temporary',
			state: 'temporary',
			label: 'temporarily unavailable',
			reason: 'Plaid could not sync this institution right now.',
			nextStep: 'Try again later.',
			offerReconnect: false,
			accountSelection: false
		};
	}
	const shown = displayCode(normalized);
	return {
		kind: 'error',
		state: 'error',
		label: 'error',
		reason: shown
			? `Plaid could not sync this institution (${shown}).`
			: 'Plaid could not sync this institution.',
		nextStep: 'Reconnect, or try again later.',
		offerReconnect: true,
		accountSelection: false
	};
}

/** User-facing sentence for a reconnect code. Derived from the classifier. */
export function reconnectMessage(): string {
	return classifyPlaidError('ITEM_LOGIN_REQUIRED').reason;
}

export function itemFailureSentence(code: string | null | undefined): string {
	const classified = classifyPlaidError(code);
	return `${classified.reason} ${classified.nextStep}`.replace(/\s+/g, ' ').trim();
}

function institutionLabel(name: string | null | undefined): string {
	const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
	if (!trimmed || looksLikeSecret(trimmed)) return 'A linked institution';
	return trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
}

/**
 * Banner for connections.last_error and the sync-failed notification.
 * Names each failed institution. Falls back only when none can be identified.
 */
export function formatPlaidItemFailureBanner(
	items: { institutionName: string | null; errorCode: string | null }[]
): string {
	if (items.length === 0) return PLAID_PARTIAL_FAILURE_FALLBACK;
	const parts = items.map((item) => {
		const classified = classifyPlaidError(item.errorCode);
		return `${institutionLabel(item.institutionName)}: ${classified.reason} ${classified.nextStep}`
			.replace(/\s+/g, ' ')
			.trim();
	});
	let message = parts.join(' ');
	if (message.length > BANNER_MAX) {
		message = `${message.slice(0, BANNER_MAX - 1).trimEnd()}…`;
	}
	return message;
}

function looksLikeSecret(value: string): boolean {
	return /access-(?:sandbox|production|development)-/i.test(value) ||
		/public-(?:sandbox|production|development)-/i.test(value) ||
		/\b[a-f0-9]{64}\b/i.test(value) ||
		/bearer\s+\S+/i.test(value);
}

/** One log field. Never a token, token hint, or unknown:<hint> id. */
function logField(value: string | null | undefined, fallback: string): string {
	const text = (value ?? '').trim();
	if (!text || text.startsWith('unknown:') || looksLikeSecret(text)) return fallback;
	const cleaned = text.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!cleaned || looksLikeSecret(cleaned)) return fallback;
	return cleaned.slice(0, 80);
}

/**
 * Exactly one console.error line per failed item. Must not include access
 * tokens, token hints, secrets, or request bodies.
 */
export function plaidItemFailureLogLine(input: {
	itemId: string | null | undefined;
	institutionName: string | null | undefined;
	code: string | null | undefined;
	errorType: string | null | undefined;
}): string {
	const item = logField(input.itemId, 'unknown');
	const institution = logField(input.institutionName, 'unknown');
	const code = logField(displayCode(input.code) ?? input.code, 'none');
	const type = logField(displayCode(input.errorType) ?? input.errorType, 'none');
	return `[Plaid] item sync failed: item=${item} institution=${institution} code=${code} type=${type}`;
}

export function logPlaidItemSyncFailure(input: {
	itemId: string | null | undefined;
	institutionName: string | null | undefined;
	code: string | null | undefined;
	errorType: string | null | undefined;
}): void {
	console.error(plaidItemFailureLogLine(input));
}
