import {
	deleteAccount,
	getAccountBalances,
	getAccountTxnAnchors,
	getAccounts,
	saveAccount
} from '$lib/server/finance';
import type { AccountType } from '$lib/types';
import { parseAmountToCents } from '$lib/utils';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function load({ locals }) {
	const userId = locals.user!.id;
	const balances = getAccountBalances(userId);
	const anchors = getAccountTxnAnchors(userId);
	const accounts = getAccounts(userId).map((a) => {
		const anchor = anchors.get(a.id);
		return {
			...a,
			ledger_balance_cents: balances.get(a.id) ?? 0,
			earliest_txn_date: anchor?.earliestDate ?? null,
			txn_sum_cents: anchor?.sumAllCents ?? 0
		};
	});
	return { accounts };
}

export const actions = {
	'save-account': async ({ request, locals }) => {
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const name = String(form.get('name') ?? '').trim();
		const type = String(form.get('type') ?? 'bank');
		const color = String(form.get('color') ?? '').trim() || null;
		const openingRaw = String(form.get('opening_balance') ?? '').trim();
		const asOfRaw = String(form.get('opening_as_of') ?? '').trim();

		if (!name) return { error: 'Account name is required.', source: 'save' as const };
		if (!['bank', 'credit', 'cash', 'investment', 'other'].includes(type)) {
			return { error: 'Invalid account type.', source: 'save' as const };
		}

		// Opening + as-of: both empty (clear / unset) or both set.
		let opening_balance_cents: number | null = null;
		let opening_as_of: string | null = null;
		if (openingRaw !== '' || asOfRaw !== '') {
			if (openingRaw === '' || asOfRaw === '') {
				return {
					error: 'Set both opening balance and as-of date, or clear both.',
					source: 'save' as const
				};
			}
			const cents = parseAmountToCents(openingRaw);
			if (cents === null) {
				return { error: 'Opening balance must be a valid amount.', source: 'save' as const };
			}
			if (!DATE_RE.test(asOfRaw)) {
				return { error: 'As-of date must be YYYY-MM-DD.', source: 'save' as const };
			}
			opening_balance_cents = cents;
			opening_as_of = asOfRaw;
		}

		try {
			saveAccount(locals.user!.id, id, {
				name,
				type: type as AccountType,
				color,
				opening_balance_cents,
				opening_as_of
			});
		} catch {
			return {
				error: 'Account could not be saved.',
				source: 'save' as const
			};
		}
		return {
			ok: true,
			source: 'save' as const,
			message: id ? 'Account updated.' : 'Account added.'
		};
	},

	'delete-account': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) {
			return { error: 'Account not found.', source: 'delete' as const };
		}
		const raw = String(form.get('reassign_to') ?? '').trim();
		const reassignTo = parseInt(raw, 10);
		if (!Number.isFinite(reassignTo)) {
			return {
				error: 'Choose another account to move transactions to.',
				source: 'delete' as const
			};
		}
		try {
			deleteAccount(locals.user!.id, id, reassignTo);
		} catch (error) {
			return {
				error: (error as Error).message || 'Account could not be deleted.',
				source: 'delete' as const
			};
		}
		return { ok: true, source: 'delete' as const, message: 'Account deleted.' };
	}
};
