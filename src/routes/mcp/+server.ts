import type { RequestHandler } from './$types';
import { handleMcpRequest } from '../../../mcp/http';
import { isMcpEnabled, mcpAppBaseUrl } from '$lib/server/mcp';
import { appVersion } from '$lib/version';

/**
 * MCP streamable HTTP on the app port at `/mcp` (ADO-36).
 * Off (default) → 404; On → same handler as the standalone MCP bundle.
 */
async function mcp({ request }: { request: Request }) {
	if (!isMcpEnabled()) {
		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}
	return handleMcpRequest(request, {
		base: mcpAppBaseUrl(),
		version: appVersion
	});
}

export const GET: RequestHandler = (event) => mcp(event);
export const POST: RequestHandler = (event) => mcp(event);
export const DELETE: RequestHandler = (event) => mcp(event);
