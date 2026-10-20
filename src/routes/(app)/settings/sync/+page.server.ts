import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { getProvider, PROVIDERS } from '$lib/server/providers';
import {
	createLinkToken,
	getPlaidConfig,
	plaidConfigForClient,
	plaidConfigured,
	plaidLinkEnabled,
	plainPlaidConnectError,
	savePlaidConfig
} from '$lib/server/providers/plaid';
import {
	finishPlaidReconnect,
	connect,
	countOpenSyncReviews,
	disconnect,
	getLinkedAccounts,
	listConnections,
	listPlaidItemsForSettings,
	mapAccount,
	reconnectLinkToken,
	removePlaidItemForUser,
	setSyncInterval,
	syncNow
} from '$lib/server/sync';
import { mergedNote } from '$lib/utils';

/** "90 minutes" / "an hour" / "a day" style label for an interval in minutes. */
function formatInterval(minutes: number): string {
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
	const hours = minutes / 60;
	if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
	const days = hours / 24;
	if (days < 7) return days === 1 ? 'a day' : `${days} days`;
	const weeks = days / 7;
	return weeks === 1 ? 'a week' : `${weeks} weeks`;
}

export function load({ locals, depends }) {
	depends('user');
	depends('sync');
	if (!locals.user) redirect(303, '/login');
	const userId = locals.user.id;
	const connections = listConnections(userId);
	const linked: Record<string, ReturnType<typeof getLinkedAccounts>> = {};
	for (const c of connections) linked[c.provider] = getLinkedAccounts(userId, c.provider);
	// Every one of the user's accounts, so the mapping UI can offer them as targets.
	const allAccounts = db()
		.query('SELECT id, name, type, provider, external_id FROM accounts WHERE user_id = ? ORDER BY name')
		.all(userId) as { id: number; name: string; type: string; provider: string | null; external_id: string | null }[];
	// Only the serializable metadata — provider methods stay server-side.
	const providers = PROVIDERS.map((p) => {
		const configured = p.isConfigured ? p.isConfigured(userId) : true;
		const link = p.id === 'plaid' ? plaidLinkEnabled(userId) : undefined;
		return {
			id: p.id,
			label: p.label,
			description: p.description,
			credentialFields: p.credentialFields,
			configured,
			configureHint:
				p.id === 'plaid' && !link
					? !configured
						? 'Add your Plaid client id and secret below to enable Plaid (switch to production for live banks).'
						: 'Add your Plaid client secret (and sandbox instance name in sandbox) to connect new Plaid accounts; existing connections keep syncing.'
					: undefined,
			minSyncIntervalMinutes: p.minSyncIntervalMinutes,
			link
		};
	});
	return {
		providers,
		connections,
		linked,
		allAccounts,
		userId,
		openSyncReviews: countOpenSyncReviews(userId),
		// Plaid is configured per user; the form pre-fills the saved values —
		// except the secret, which never reaches the browser (see
		// plaidConfigForClient).
		plaid: plaidConfigForClient(userId),
		plaidItems: listPlaidItemsForSettings(userId)
	};
}

export const actions = {
	// Save the user's Plaid credentials (client id / secret, env, sandbox
	// instance). The secret field is never pre-filled (it is not sent to the
	// browser), so an empty submission keeps the stored secret — only a
	// non-empty value overwrites it. Other fields clear when left empty.
	'save-plaid': async ({ request, locals }) => {
		const form = await request.formData();
		const clientId = String(form.get('plaid_client_id') ?? '').trim();
		const submittedSecret = String(form.get('plaid_client_secret') ?? '').trim();
		const env = String(form.get('plaid_env') ?? 'sandbox').trim() === 'production' ? 'production' : 'sandbox';
		const sandboxInstance = String(form.get('plaid_sandbox_instance') ?? '').trim();
		const clientSecret = submittedSecret || getPlaidConfig(locals.user!.id).clientSecret;
		if (clientId && !clientSecret) {
			return { error: 'Enter both the client id and client secret, or clear the client id.' };
		}
		if (env === 'sandbox' && !sandboxInstance) {
			return { error: 'Enter your Plaid sandbox instance name (Plaid dashboard → Sandbox) to connect new accounts.' };
		}
		savePlaidConfig(locals.user!.id, { clientId, clientSecret, env, sandboxInstance });
		return { ok: true, message: 'Plaid settings saved.' };
	},

	// Called by the client right before opening the Link widget; the token is
	// one-time-use, so it is minted per click, never in load().
	'link-token': async ({ locals }) => {
		try {
			return { token: await createLinkToken(locals.user!.id) };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Could not start a Plaid session.' };
		}
	},

	// Update-mode Link token for one item that needs a fresh sign-in.
	'reconnect-token': async ({ request, locals }) => {
		const form = await request.formData();
		const itemId = Number(form.get('item_id'));
		try {
			return { token: await reconnectLinkToken(locals.user!.id, itemId), itemId };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Could not start a reconnect session.' };
		}
	},

	// Link update mode does not issue a new access token. Clear the error and
	// sync that one item right away so the card returns to healthy without Sync now.
	'reconnect-done': async ({ request, locals }) => {
		const form = await request.formData();
		const itemId = Number(form.get('item_id'));
		try {
			const summary = await finishPlaidReconnect(locals.user!.id, itemId);
			if ('error' in summary && !('created' in summary)) {
				// Hard failure for this item only — keep it as the item's error state.
				return {
					ok: true,
					itemError: true,
					message: summary.error
				};
			}
			if ('error' in summary) {
				return {
					ok: true,
					message: `Signed in again. ${summary.error}`,
					accounts: summary.accounts,
					created: summary.created,
					updated: summary.updated,
					merged: summary.merged,
					lastSyncedAt: summary.lastSyncedAt
				};
			}
			return {
				ok: true,
				message: `Signed in again. Synced ${summary.created} new transaction${summary.created === 1 ? '' : 's'}, ${summary.updated} updated.`,
				accounts: summary.accounts,
				created: summary.created,
				updated: summary.updated,
				merged: summary.merged,
				lastSyncedAt: summary.lastSyncedAt
			};
		} catch (error) {
			// Never surface as a crash — record as an item-level message.
			return {
				ok: true,
				itemError: true,
				message: error instanceof Error ? error.message : 'Could not finish reconnecting.'
			};
		}
	},

	'remove-item': async ({ request, locals }) => {
		const form = await request.formData();
		const itemId = Number(form.get('item_id'));
		try {
			await removePlaidItemForUser(locals.user!.id, itemId);
			return {
				ok: true,
				message: 'Removed that linked institution. Its imported accounts and transactions stay in your app.'
			};
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Could not remove that institution.' };
		}
	},

	connect: async ({ request, locals }) => {
		const form = await request.formData();
		const providerId = String(form.get('provider') ?? '');
		const provider = getProvider(providerId);
		if (!provider) return { error: 'Unknown provider.' };
		const credentials: Record<string, string> = {};
		for (const f of provider.credentialFields) credentials[f.key] = String(form.get(`cred_${f.key}`) ?? '').trim();
		const metadata = String(form.get('plaid_metadata') ?? '').trim();
		if (metadata) credentials.plaid_metadata = metadata;
		if (String(form.get('plaid_allow_duplicate') ?? '').trim() === '1') {
			credentials.plaid_allow_duplicate = '1';
		}
		try {
			const linked = await connect(locals.user!.id, providerId, credentials);
			if (linked && typeof linked === 'object' && 'alreadyLinked' in linked && linked.alreadyLinked) {
				// Do not sync. When the public token was not exchanged, the client
				// may resubmit it with plaid_allow_duplicate=1.
				return {
					alreadyLinked: linked.item,
					// After the safety net the token was already exchanged and cannot be reused.
					publicToken: linked.exchanged ? '' : (credentials.public_token ?? ''),
					plaidMetadata: metadata
				};
			}
			if (provider.autoSyncOnConnect) {
				// Plaid links one bank per Link session; pull the newly linked
				// account(s) in right away so the user sees them without a
				// second "Sync now" click. A failed pull doesn't undo the
				// connect — the user can retry with "Sync now".
				const summary = await syncNow(locals.user!.id, providerId);
				if ('error' in summary) {
					return {
						ok: true,
						message: `Connected to ${provider.label}, but its transactions couldn't be pulled yet: ${summary.error}. Use "Sync now" to retry.`
					};
				}
				return {
					ok: true,
					message: `Connected to ${provider.label}: ${summary.created} new transaction${summary.created === 1 ? '' : 's'}, ${summary.updated} updated${mergedNote(summary)}.`
				};
			}
			return { ok: true, message: `Connected to ${provider.label}.` };
		} catch (error) {
			return { error: plainPlaidConnectError(error) };
		}
	},

	disconnect: async ({ request, locals }) => {
		const form = await request.formData();
		const providerId = String(form.get('provider') ?? '');
		const provider = getProvider(providerId);
		disconnect(locals.user!.id, providerId);
		return {
			ok: true,
			message: `Disconnected from ${provider?.label ?? 'the provider'}. Imported accounts and transactions stay in your app.`
		};
	},

	sync: async ({ request, locals }) => {
		const form = await request.formData();
		return await syncNow(locals.user!.id, String(form.get('provider') ?? ''));
	},

	interval: async ({ request, locals }) => {
		const form = await request.formData();
		const providerId = String(form.get('provider') ?? '');
		const provider = getProvider(providerId);
		if (!provider) return { error: 'Unknown provider.' };
		const raw = String(form.get('interval') ?? '').trim();
		const minutes = raw === '' ? null : Number(raw);
		if (minutes != null && (!Number.isInteger(minutes) || minutes <= 0)) {
			return { error: 'Invalid sync interval.' };
		}
		// Keep the UI from scheduling faster than the provider's rate limits allow.
		if (minutes != null && provider.minSyncIntervalMinutes != null && minutes < provider.minSyncIntervalMinutes) {
			return {
				error: `${provider.label} can't sync more often than every ${formatInterval(provider.minSyncIntervalMinutes)} — that would hit the provider's rate limit.`
			};
		}
		try {
			setSyncInterval(locals.user!.id, providerId, minutes);
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Could not update the sync interval.' };
		}
		return {
			ok: true,
			message:
				minutes == null
					? 'Auto-sync off. Use "Sync now" to refresh.'
					: `Auto-sync on: every ${formatInterval(minutes)}.`
		};
	},

	map: async ({ request, locals }) => {
		const form = await request.formData();
		const providerId = String(form.get('provider') ?? '');
		const externalId = String(form.get('external_id') ?? '');
		const target = String(form.get('target') ?? '');
		const newName = String(form.get('new_name') ?? '');
		if (!providerId || !externalId) return { error: 'Missing account to map.' };
		try {
			const result =
				target === 'new'
					? mapAccount(locals.user!.id, providerId, externalId, { kind: 'new', name: newName })
					: mapAccount(locals.user!.id, providerId, externalId, { kind: 'existing', accountId: Number(target) });
			return { ok: true, message: `Mapped to “${result.name}”.` };
		} catch (error) {
			return { error: error instanceof Error ? error.message : 'Could not update the mapping.' };
		}
	}
};
