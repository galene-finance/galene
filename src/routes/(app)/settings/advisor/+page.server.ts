import { fail, redirect } from '@sveltejs/kit';
import { getAccounts } from '$lib/server/finance';
import {
	createGrant,
	listAudit,
	listGrants,
	revokeGrant,
	yearRange,
	type AdvisorKind
} from '$lib/server/advisor';
import { buildPackZip, savePack } from '$lib/server/pack';

function parseIds(form: FormData): number[] {
	return form
		.getAll('account_ids')
		.map((v) => parseInt(String(v), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
}

function rangeFromForm(form: FormData): { dateFrom: string; dateTo: string } | { error: string } {
	const dateFrom = String(form.get('date_from') ?? '').trim();
	const dateTo = String(form.get('date_to') ?? '').trim();
	if (dateFrom || dateTo) {
		if (!dateFrom || !dateTo) return { error: 'Choose both a start and an end date.' };
		return { dateFrom, dateTo };
	}
	const fromYear = yearRange(parseInt(String(form.get('year') ?? ''), 10));
	if (fromYear) return fromYear;
	return { error: 'Choose a year or a date range.' };
}

export function load({ locals }) {
	if (locals.user?.role === 'viewer') redirect(303, '/transactions');
	const userId = locals.user!.id;
	return {
		grants: listGrants(userId),
		audit: listAudit(userId),
		accounts: getAccounts(userId).map((a) => ({ id: a.id, name: a.name })),
		year: new Date().getFullYear()
	};
}

export const actions = {
	create: async ({ request, locals, url }) => {
		if (locals.user?.role === 'viewer') return fail(403, { error: 'Read-only.' });
		const userId = locals.user!.id;
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '') as AdvisorKind;
		if (kind !== 'pack' && kind !== 'viewer') return fail(400, { error: 'Choose a pack or an invite.' });
		const range = rangeFromForm(form);
		if ('error' in range) return fail(400, { error: range.error });
		const ttl = parseInt(String(form.get('ttl_days') ?? '14'), 10);
		const password = String(form.get('password') ?? '');
		if (!password.trim()) return fail(400, { error: 'A link password is required.' });
		const created = createGrant(userId, {
			label: String(form.get('label') ?? ''),
			kind,
			dateFrom: range.dateFrom,
			dateTo: range.dateTo,
			accountIds: parseIds(form),
			ttlDays: ttl,
			password
		});
		if ('error' in created) return fail(400, { error: created.error });
		const sharePath =
			kind === 'pack' ? `/advisor/pack/${created.token}` : `/advisor/invite/${created.token}`;
		let packReady = false;
		if (kind === 'pack') {
			const zip = buildPackZip(
				{
					userId,
					grantId: created.grant.id,
					dateFrom: created.grant.date_from,
					dateTo: created.grant.date_to,
					accountIds: created.grant.account_ids
				},
				new Date().toISOString()
			);
			savePack(
				{
					userId,
					grantId: created.grant.id,
					dateFrom: created.grant.date_from,
					dateTo: created.grant.date_to,
					accountIds: created.grant.account_ids
				},
				zip
			);
			packReady = true;
		}
		return {
			ok: true,
			message: kind === 'pack' ? 'Pack generated. Copy the link if you want to share it.' : 'Invite created. Copy the magic link.',
			shareUrl: new URL(sharePath, url.origin).href,
			downloadId: packReady ? created.grant.id : null,
			passwordSet: created.grant.has_password
		};
	},

	revoke: async ({ request, locals }) => {
		if (locals.user?.role === 'viewer') return fail(403, { error: 'Read-only.' });
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id) || !revokeGrant(locals.user!.id, id)) {
			return fail(400, { error: 'That grant is already revoked or missing.' });
		}
		return { ok: true, message: 'Access revoked.' };
	}
};
