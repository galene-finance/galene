#!/usr/bin/env bun
/**
 * Galene MCP server.
 *
 * Stdio (default): an MCP client launches this process. GALENE_API_TOKEN is required.
 * HTTP: set GALENE_MCP_PORT. The process stays up and reads the API token from
 * each request's Authorization header. Do not put the token in the environment.
 *
 * GALENE_API_URL is the Galene app (default http://localhost:3000).
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttp } from './http.ts';
import { createGaleneServer } from './tools.ts';

// Replaced by `--define` in the Docker build; absent for local runs.
declare const GALENE_VERSION: string | undefined;

// The version (package.json is the single source of truth) is baked in at
// image build time via `--define GALENE_VERSION=…` (bun build can't bundle
// JSON imports); a local `bun mcp/index.ts` run reads package.json instead.
const version =
  typeof GALENE_VERSION !== 'undefined'
    ? GALENE_VERSION
    : (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
        .version;

const base = process.env.GALENE_API_URL ?? 'http://localhost:3000';
const portRaw = process.env.GALENE_MCP_PORT;

if (portRaw) {
	const port = Number(portRaw);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		console.error('GALENE_MCP_PORT must be a port number.');
		process.exit(1);
	}
	const host = process.env.GALENE_MCP_HOST || '0.0.0.0';
	startHttp(port, host, base, version);
} else {
	const token = process.env.GALENE_API_TOKEN;
	if (!token) {
		console.error('GALENE_API_TOKEN is required. Create a token in Galene → Settings → API.');
		process.exit(1);
	}
	const transport = new StdioServerTransport();
	await createGaleneServer(base, token, version).connect(transport);
}
