import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RequestHandler } from './$types';
import { isMcpEnabled, mcpAppBaseUrl } from '$lib/server/mcp';
import { appVersion } from '$lib/version';

type HandleMcpRequest = (
	request: Request,
	options: { base: string; version: string; fetchImpl?: typeof fetch }
) => Promise<Response>;

/**
 * Load the Bun-bundled MCP HTTP handler from disk so Vite SSR never bundles
 * the MCP SDK / zod (those hit a `util is not defined` break in the adapter
 * output). Image ships `mcp-handler.js`; source checkouts use `mcp/http.ts`.
 */
async function loadHandleMcpRequest(): Promise<HandleMcpRequest> {
	const cwd = process.cwd();
	const built = resolve(cwd, 'mcp-handler.js');
	const entry = existsSync(built) ? built : resolve(cwd, 'mcp/http.ts');
	const mod = (await import(/* @vite-ignore */ pathToFileURL(entry).href)) as {
		handleMcpRequest: HandleMcpRequest;
	};
	return mod.handleMcpRequest;
}

/**
 * MCP streamable HTTP on the app port at `/mcp` (ADO-36).
 * Off (default) → 404; On → Bun-bundled handler (same transport as stdio bundle).
 */
async function mcp({ request }: { request: Request }) {
	if (!isMcpEnabled()) {
		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { 'content-type': 'application/json' }
		});
	}
	const handleMcpRequest = await loadHandleMcpRequest();
	return handleMcpRequest(request, {
		base: mcpAppBaseUrl(),
		version: appVersion
	});
}

export const GET: RequestHandler = (event) => mcp(event);
export const POST: RequestHandler = (event) => mcp(event);
export const DELETE: RequestHandler = (event) => mcp(event);
