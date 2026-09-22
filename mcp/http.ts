import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createGaleneServer } from './tools.ts';

const MCP_PATH = '/mcp';

export function bearerToken(header: string | null): string | null {
	if (!header || !header.startsWith('Bearer ')) return null;
	const token = header.slice('Bearer '.length).trim();
	if (!token || /\s/.test(token)) return null;
	return token;
}

function jsonError(status: number, message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function logWithoutToken(token: string | null, message: string) {
	if (token && message.includes(token)) {
		console.error('MCP request failed');
		return;
	}
	console.error(message);
}

async function probe(base: string, token: string, fetchImpl: typeof fetch): Promise<Response | null> {
	let res: Response;
	try {
		const url = new URL('/api/v1/accounts', base);
		res = await fetchImpl(url, {
			headers: { authorization: `Bearer ${token}` },
			redirect: 'manual'
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		logWithoutToken(token, message ? 'MCP auth probe failed' : 'MCP auth probe failed');
		return jsonError(502, 'Galene is unreachable');
	}
	if (res.status === 401 || res.status === 403) return jsonError(401, 'Unauthorized');
	if (!res.ok) return jsonError(502, 'Galene rejected the token check');
	return null;
}

export async function handleMcpRequest(
	request: Request,
	options: { base: string; version: string; fetchImpl?: typeof fetch }
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname !== MCP_PATH) return jsonError(404, 'Not found');
	if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
		return jsonError(405, 'Method not allowed');
	}

	const token = bearerToken(request.headers.get('authorization'));
	if (!token) return jsonError(401, 'Unauthorized');

	const fetchImpl = options.fetchImpl ?? fetch;
	const rejected = await probe(options.base, token, fetchImpl);
	if (rejected) return rejected;

	try {
		const server = createGaleneServer(options.base, token, options.version);
		const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
		await server.connect(transport);
		return await transport.handleRequest(request);
	} catch (err) {
		const message = err instanceof Error ? err.message : '';
		logWithoutToken(token, message ? 'MCP request failed' : 'MCP request failed');
		return jsonError(500, 'MCP request failed');
	}
}

export function startHttp(port: number, host: string, base: string, version: string) {
	Bun.serve({
		port,
		hostname: host,
		fetch: (request) => handleMcpRequest(request, { base, version })
	});
	console.error(`Galene MCP listening on port ${port}`);
}
