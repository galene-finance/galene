import { resolve } from 'node:path';
import { createApiToken, deleteApiToken, listApiTokens } from '$lib/server/apiTokens';
import { mcpEntryPath, mcpSettingsView, saveMcpSettings } from '$lib/server/mcp';

export function load({ locals }) {
	const isAdmin = locals.user!.is_admin === 1;
	return {
		tokens: listApiTokens(locals.user!.id),
		// Filled into the MCP config snippet so the user only pastes their token.
		mcpArgs: [resolve(process.cwd(), 'mcp/index.ts')],
		mcpBundleHint: mcpEntryPath(),
		apiUrl: `http://localhost:${process.env.PORT ?? 3000}`,
		isAdmin,
		mcp: isAdmin ? mcpSettingsView() : null
	};
}

export const actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { error: 'Enter a name for this token.' };
		const { info, token } = createApiToken(locals.user!.id, name);
		return { ok: true, token, tokenName: info.name };
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
		const port = parseInt(String(form.get('port') ?? ''), 10);
		const result = saveMcpSettings({
			enabled: form.get('enabled') === '1',
			port: Number.isFinite(port) ? port : 3001,
			host: String(form.get('host') ?? '0.0.0.0')
		});
		if (!result.ok) return { mcpError: result.error };
		return { ok: true, message: 'MCP settings saved.' };
	}
};
