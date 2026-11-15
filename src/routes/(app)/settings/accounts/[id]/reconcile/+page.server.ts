import { error } from '@sveltejs/kit';
import { isDemoMode } from '$lib/server/demoMode';
import {
	finishReconcile,
	loadReconcile,
	setCleared,
	tickAllThrough,
	unlockTransaction,
	type DismissPair
} from '$lib/server/reconcile';
import { todayISO } from '$lib/utils';

function accountIdOf(params: { id?: string }): number {
	const id = parseInt(params.id ?? '', 10);
	if (!Number.isInteger(id)) error(404, 'Account not found.');
	return id;
}

function message(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function dismissPairsOf(value: unknown): DismissPair[] {
	if (value == null) return [];
	if (!Array.isArray(value)) throw new Error('Could not read the review.');
	return value.map((item) => {
		if (!item || typeof item !== 'object') throw new Error('Could not read the review.');
		const row = item as { manualId?: unknown; syncedId?: unknown };
		return { manualId: Number(row.manualId), syncedId: Number(row.syncedId) };
	});
}

export function load({ locals, params }) {
	const accountId = accountIdOf(params);
	const scope = locals.viewer?.scope ?? null;
	const loaded = loadReconcile(locals.user!.id, accountId, scope ? { accountIds: scope.accountIds } : null);
	if (!loaded) error(404, 'Account not found.');
	const asOf = loaded.account.provider_balance_as_of;
	const through = asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : todayISO();
	return {
		...loaded,
		defaultThrough: through,
		viewer: locals.user?.role === 'viewer',
		demo: isDemoMode()
	};
}

export const actions = {
	'set-cleared': async ({ request, locals, params }) => {
		const accountId = accountIdOf(params);
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isInteger(id)) return { error: 'Invalid transaction.', source: 'cleared' as const };
		try {
			setCleared(locals.user!.id, accountId, [id], String(form.get('cleared')) === '1');
		} catch (e) {
			return { error: message(e, 'Could not update cleared.'), source: 'cleared' as const };
		}
		return { ok: true, source: 'cleared' as const };
	},

	'tick-all': async ({ request, locals, params }) => {
		const accountId = accountIdOf(params);
		const form = await request.formData();
		try {
			tickAllThrough(locals.user!.id, accountId, String(form.get('through') ?? ''));
		} catch (e) {
			return { error: message(e, 'Could not tick these rows.'), source: 'tick' as const };
		}
		return { ok: true, source: 'tick' as const };
	},

	unlock: async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		try {
			unlockTransaction(locals.user!.id, id);
		} catch (e) {
			return { error: message(e, 'Could not unlock.'), source: 'unlock' as const };
		}
		return { ok: true, source: 'unlock' as const };
	},

	finish: async ({ request, locals, params }) => {
		const accountId = accountIdOf(params);
		const form = await request.formData();
		let plan: unknown;
		try {
			plan = JSON.parse(String(form.get('plan') ?? ''));
		} catch {
			return { error: 'Could not read the review.', source: 'finish' as const };
		}
		if (!plan || typeof plan !== 'object') return { error: 'Could not read the review.', source: 'finish' as const };
		const body = plan as Record<string, unknown>;
		const adjustment = body.adjustment;
		try {
			finishReconcile(locals.user!.id, accountId, {
				bankBalanceCents: Number(body.bankBalanceCents),
				statementDate: String(body.statementDate ?? ''),
				adjustment:
					adjustment && typeof adjustment === 'object'
						? {
								amountCents: Number((adjustment as { amountCents: unknown }).amountCents),
								date: String((adjustment as { date: unknown }).date ?? ''),
								note: String((adjustment as { note: unknown }).note ?? '')
							}
						: null,
				addUnimportedIds: Array.isArray(body.addUnimportedIds) ? body.addUnimportedIds.map(Number) : [],
				deleteIds: Array.isArray(body.deleteIds) ? body.deleteIds.map(Number) : [],
				dismissPairs: dismissPairsOf(body.dismissPairs)
			});
		} catch (e) {
			return { error: message(e, 'Could not finish reconcile.'), source: 'finish' as const };
		}
		return { ok: true, message: 'Reconcile finished.', source: 'finish' as const };
	}
};
