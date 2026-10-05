import { resolve } from 'node:path';
import { createApiToken, deleteApiToken, listApiTokens, type ApiTokenScope } from '$lib/server/apiTokens';
import { getAccounts, getCategories } from '$lib/server/finance';
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
	saveWriteApiSettings,
	updateWebhook
} from '$lib/server/writeApi';
import type { RuleCondition, RuleField, RuleOp } from '$lib/types';
import { parseAmountToCents } from '$lib/utils';

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
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		audit: listAudit(userId)
	};
}

function parseWebhookConditions(form: FormData): { ok: true; conditions: RuleCondition[] } | { ok: false; error: string } {
	const conditions: RuleCondition[] = [];
	for (let i = 0; ; i++) {
		const field = String(form.get(`cond_field_${i}`) ?? '');
		if (!field) break;
		if (!['merchant', 'amount', 'account', 'category'].includes(field)) {
			return { ok: false, error: 'Invalid condition field.' };
		}
		const op = String(form.get(`cond_op_${i}`) ?? '') as RuleOp;
		const value = String(form.get(`cond_value_${i}`) ?? '').trim();
		if (field === 'amount') {
			const v = parseAmountToCents(value);
			if (v === null || v <= 0) return { ok: false, error: `Condition ${i + 1} needs a valid amount.` };
			if (op === 'between') {
				const v2 = parseAmountToCents(String(form.get(`cond_value2_${i}`) ?? ''));
				if (v2 === null || v2 < v) {
					return { ok: false, error: `Condition ${i + 1}: the max must be at least the min.` };
				}
				conditions.push({ field: field as RuleField, op, value: v, value2: v2 });
			} else {
				conditions.push({ field: field as RuleField, op, value: v });
			}
		} else {
			if (!value) return { ok: false, error: `Condition ${i + 1} needs a value.` };
			conditions.push({ field: field as RuleField, op, value: field === 'merchant' ? value : Number(value) });
		}
	}
	return { ok: true, conditions };
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
		const parsed = parseWebhookConditions(form);
		if (!parsed.ok) return { webhookError: parsed.error };
		const result = createWebhook(locals.user!.id, {
			name: String(form.get('name') ?? ''),
			url: String(form.get('url') ?? ''),
			events: form.getAll('events'),
			filters: { conditions: parsed.conditions },
			fields: form.getAll('fields'),
			enabled: form.get('enabled') === '1'
		});
		if (!result.ok) return { webhookError: result.error };
		return { ok: true, webhookSecret: result.secret, webhookName: result.webhook.name };
	},

	'update-webhook': async ({ request, locals }) => {
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id)) return { webhookError: 'Webhook not found.' };
		const parsed = parseWebhookConditions(form);
		if (!parsed.ok) return { webhookError: parsed.error };
		const result = updateWebhook(locals.user!.id, id, {
			name: String(form.get('name') ?? ''),
			url: String(form.get('url') ?? ''),
			events: form.getAll('events'),
			filters: { conditions: parsed.conditions },
			fields: form.getAll('fields'),
			enabled: form.get('enabled') === '1'
		});
		if (!result.ok) return { webhookError: result.error };
		return { ok: true, message: 'Webhook saved.' };
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
