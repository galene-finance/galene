import { resolve } from 'node:path';
import { createApiToken, deleteApiToken, listApiTokens } from '$lib/server/apiTokens';

export function load({ locals }) {
	return {
		tokens: listApiTokens(locals.user!.id),
		// Filled into the MCP config snippet so the user only pastes their token.
		mcpArgs: [resolve(process.cwd(), 'mcp/index.ts')],
		apiUrl: `http://localhost:${process.env.PORT ?? 3000}`
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
	}
};
