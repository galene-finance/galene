import { resolve } from 'node:path';
import { createApiToken, deleteApiToken, listApiTokens, type ApiTokenScope } from '$lib/server/apiTokens';
import { mcpEntryPath, mcpSettingsView, saveMcpSettings } from '$lib/server/mcp';
import {
	WEBHOOK_EVENTS,
	WEBHOOK_FIELDS,
	createWebhook,
	deleteWebhook,
	isWriteApiEnabled,
	listAudit,
	listWebhooks,
	rotateWebhookSecret,
	saveWriteApiSettings
} from '$lib/server/writeApi';

export function load({ locals, url }) {
	const isAdmin = locals.user!.is_admin === 1;
	const userId = locals.user!.id;
	return {
		tokens: listApiTokens(userId),
		// Filled into the MCP config snippet so the user only pastes their token.
		mcpArgs: [resolve(process.cwd(), 'mcp/index.ts')],
		mcpBundleHint: mcpEntryPath(),
		apiUrl: `http://localhost:${process.env.PORT ?? 3000}`,
		isAdmin,
		mcp: isAdmin ? mcpSettingsView(url.origin) : null,
		writeApiEnabled: isAdmin ? isWriteApiEnabled() : false,
		webhooks: listWebhooks(userId),
		webhookEvents: WEBHOOK_EVENTS,
		webhookFields: WEBHOOK_FIELDS,
		audit: listAudit(userId)
	};
}

export const actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { error: 'Enter a name for this token.' };
		const scope: ApiTokenScope = form.get('scope') === 'write' ? 'write' : 'read';
		const { info, token } = createApiToken(locals.user!.id, name, scope);
		return { ok: true, token, tokenName: info.name, tokenScope: info.scope };
	},

	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteApiToken(locals.user!.id, id);
		return { ok: true };
	},

	'save-mcp': async ({ request, locals }) => {
		if (locals.user!.is_admin !== 1) {
			return { error: 'Only an administrator can change the MCP server.' };
		}
		const form = await request.formData();
		const result = saveMcpSettings({
			enabled: form.get('enabled') === '1'
		});
		if (!result.ok) return { mcpError: result.error };
		return { ok: true, message: 'MCP settings saved.' };
	},

	'save-write-api': async ({ request, locals }) => {
		if (locals.user!.is_admin !== 1) {
			return { error: 'Only an administrator can change the write API.' };
		}
		const form = await request.formData();
		const result = saveWriteApiSettings(form.get('enabled') === '1');
		if (!result.ok) return { writeError: result.error };
		return { ok: true, message: 'Write API settings saved.' };
	},

	'create-webhook': async ({ request, locals }) => {
		const form = await request.formData();
		const filters: Record<string, number> = {};
		const account = String(form.get('account_id') ?? '').trim();
		const category = String(form.get('category_id') ?? '').trim();
		const min = String(form.get('min_amount_cents') ?? '').trim();
		const max = String(form.get('max_amount_cents') ?? '').trim();
		if (account) filters.account_id = parseInt(account, 10);
		if (category) filters.category_id = parseInt(category, 10);
		if (min) filters.min_amount_cents = parseInt(min, 10);
		if (max) filters.max_amount_cents = parseInt(max, 10);
		const result = createWebhook(locals.user!.id, {
			name: String(form.get('name') ?? ''),
			url: String(form.get('url') ?? ''),
			events: form.getAll('events'),
			filters,
			fields: form.getAll('fields')
		});
		if (!result.ok) return { webhookError: result.error };
		return { ok: true, webhookSecret: result.secret, webhookName: result.webhook.name };
	},

	'delete-webhook': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (Number.isFinite(id)) deleteWebhook(locals.user!.id, id);
		return { ok: true };
	},

	'rotate-webhook': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) return { webhookError: 'Webhook not found.' };
		const result = rotateWebhookSecret(locals.user!.id, id);
		if (!result.ok) return { webhookError: result.error };
		return { ok: true, webhookSecret: result.secret, webhookName: 'Rotated signing secret' };
	}
};
