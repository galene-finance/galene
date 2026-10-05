import { normalizeMerchant } from './merchantNormalize';
import type { RuleCondition } from '$lib/types';

/**
 * One condition dialect for rules and webhooks.
 * Merchant Contains is a normalized substring (same as rules).
 * Amount compares the absolute cents value (same as rules).
 */
export function conditionMatches(
	c: RuleCondition,
	row: {
		merchant?: string | null;
		amount_cents?: number | null;
		account_id?: number | null;
		category_id?: number | null;
	}
): boolean {
	if (c.field === 'merchant') {
		if (row.merchant == null) return false;
		const lm = normalizeMerchant(row.merchant);
		const lv = normalizeMerchant(String(c.value ?? ''));
		if (lv === '') return false;
		return c.op === 'equals' ? lm === lv : lm.includes(lv);
	}
	if (c.field === 'account') return String(row.account_id ?? '') === String(c.value);
	if (c.field === 'category') return String(row.category_id ?? '') === String(c.value);
	if (row.amount_cents == null) return false;
	const a = Math.abs(row.amount_cents);
	const v = Number(c.value);
	if (!Number.isFinite(v)) return false;
	switch (c.op) {
		case 'equals':
			return a === v;
		case 'gt':
			return a > v;
		case 'lt':
			return a < v;
		case 'between':
			return a >= v && a <= Number(c.value2 ?? v);
		default:
			return false;
	}
}


