import { describe, expect, test } from 'bun:test';
import {
	classifyPlaidError,
	formatPlaidItemFailureBanner,
	isReconnectCode,
	PLAID_PARTIAL_FAILURE_FALLBACK,
	plaidItemFailureLogLine,
	RECONNECT_ERROR_CODES
} from './plaidItemStatus';

const RECONNECT = [
	'ITEM_LOGIN_REQUIRED',
	'PENDING_EXPIRATION',
	'PENDING_DISCONNECT',
	'USER_PERMISSION_REVOKED',
	'USER_ACCOUNT_REVOKED',
	'ITEM_LOCKED'
] as const;

const TEMPORARY = [
	'INSTITUTION_DOWN',
	'INSTITUTION_NOT_RESPONDING',
	'INSTITUTION_NOT_AVAILABLE',
	'PRODUCT_NOT_READY',
	'RATE_LIMIT_EXCEEDED',
	'INTERNAL_SERVER_ERROR'
] as const;

describe('Plaid item error classifier', () => {
	test('reconnect codes share needs re-login and offer Reconnect', () => {
		expect([...RECONNECT_ERROR_CODES]).toEqual([...RECONNECT]);
		for (const code of RECONNECT) {
			const classified = classifyPlaidError(code);
			expect(classified.kind).toBe('reconnect');
			expect(classified.state).toBe('needs_relogin');
			expect(classified.label).toBe('needs re-login');
			expect(classified.nextStep).toContain('Reconnect');
			expect(classified.offerReconnect).toBe(true);
			expect(classified.accountSelection).toBe(false);
			expect(isReconnectCode(code)).toBe(true);
		}
	});

	test('NO_ACCOUNTS asks the user to choose accounts again', () => {
		const classified = classifyPlaidError('NO_ACCOUNTS');
		expect(classified.kind).toBe('reselect_accounts');
		expect(classified.state).toBe('reselect_accounts');
		expect(classified.label).toBe('choose accounts again');
		expect(classified.reason).toBe('Plaid found no accounts to sync.');
		expect(classified.nextStep).toBe('Reconnect it and choose the accounts to share.');
		expect(classified.offerReconnect).toBe(true);
		expect(classified.accountSelection).toBe(true);
		expect(isReconnectCode('NO_ACCOUNTS')).toBe(false);
	});

	test('temporary codes say to try again later and hide Reconnect', () => {
		for (const code of TEMPORARY) {
			const classified = classifyPlaidError(code);
			expect(classified.kind).toBe('temporary');
			expect(classified.state).toBe('temporary');
			expect(classified.label).toBe('temporarily unavailable');
			expect(classified.nextStep).toBe('Try again later.');
			expect(classified.offerReconnect).toBe(false);
			expect(classified.accountSelection).toBe(false);
		}
	});

	test('unknown and null codes are a generic error that includes the code when present', () => {
		const unknown = classifyPlaidError('PRODUCT_NOT_ENABLED');
		expect(unknown.kind).toBe('error');
		expect(unknown.state).toBe('error');
		expect(unknown.label).toBe('error');
		expect(unknown.reason).toContain('PRODUCT_NOT_ENABLED');
		expect(unknown.offerReconnect).toBe(true);
		const missing = classifyPlaidError(null);
		expect(missing.kind).toBe('error');
		expect(missing.reason).toBe('Plaid could not sync this institution.');
		expect(missing.reason).not.toContain('(');
		expect(classifyPlaidError('').reason).toBe(missing.reason);
		expect(isReconnectCode(null)).toBe(false);
		expect(isReconnectCode(undefined)).toBe(false);
	});

	test('banner names each institution and falls back only when none are known', () => {
		expect(formatPlaidItemFailureBanner([])).toBe(PLAID_PARTIAL_FAILURE_FALLBACK);
		const message = formatPlaidItemFailureBanner([
			{ institutionName: 'Example Bank', errorCode: 'NO_ACCOUNTS' },
			{ institutionName: null, errorCode: 'ITEM_LOGIN_REQUIRED' },
			{ institutionName: 'Sample Credit Union', errorCode: 'INSTITUTION_DOWN' }
		]);
		expect(message).toContain(
			'Example Bank: Plaid found no accounts to sync. Reconnect it and choose the accounts to share.'
		);
		expect(message).toContain('A linked institution: This institution needs you to sign in again. Reconnect.');
		expect(message).toContain('Sample Credit Union:');
		expect(message).toContain('Try again later.');
		expect(message).not.toBe(PLAID_PARTIAL_FAILURE_FALLBACK);
		const huge = formatPlaidItemFailureBanner(
			Array.from({ length: 20 }, (_, i) => ({
				institutionName: `Institution ${i} `.repeat(8),
				errorCode: 'NO_ACCOUNTS'
			}))
		);
		expect(huge.length).toBeLessThanOrEqual(480);
	});

	test('failure log line keeps item, institution, code, and type, and drops secrets', () => {
		const token = 'access-sandbox-SECRET123';
		const hint = 'a'.repeat(64);
		const line = plaidItemFailureLogLine({
			itemId: `unknown:${hint.slice(0, 12)}`,
			institutionName: token,
			code: 'NO_ACCOUNTS',
			errorType: 'ITEM_ERROR'
		});
		expect(line).toBe(
			'[Plaid] item sync failed: item=unknown institution=unknown code=NO_ACCOUNTS type=ITEM_ERROR'
		);
		expect(line).not.toContain(token);
		expect(line).not.toContain(hint);
		expect(line).not.toContain('SECRET123');
	});
});
