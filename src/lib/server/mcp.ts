import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db';
import { appVersion } from '../version';
import { isDemoMode } from './demoMode';

/**
 * Household MCP HTTP (ADO-36).
 *
 * Precedence: a set GALENE_ENABLE_MCP env var overrides the Settings toggle.
 * Default is off — upgrades never expose /mcp until an admin enables it.
 *
 * When on, MCP is served on the **app HTTP port** at `/mcp` (same process; no
 * second listener or child). Off = that path is not live. Stdio clients can
 * still launch mcp-bundle.js / mcp/index.ts without this toggle.
 *
 * Port/host columns may still exist on mcp_config from ADO-35; they are not
 * read or written anymore.
 */

const ROW_ID = 1;
/** Legacy defaults kept only so INSERT stays compatible with the ADO-35 schema. */
const LEGACY_PORT = 3001;
const LEGACY_HOST = '0.0.0.0';

export const MCP_HTTP_PATH = '/mcp';

export interface McpConfig {
	enabled: boolean;
	enabledFromEnv: boolean;
}

interface ConfigRow {
	enabled: number;
}

function envTrim(name: string): string {
	return process.env[name]?.trim() ?? '';
}

function envBool(name: string): boolean | null {
	const raw = envTrim(name).toLowerCase();
	if (!raw) return null;
	if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
	if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
	return null;
}

export function ensureMcpRow(): ConfigRow {
	const existing = db()
		.query('SELECT enabled FROM mcp_config WHERE id = ?')
		.get(ROW_ID) as ConfigRow | undefined;
	if (existing) return existing;
	db()
		.query(
			`INSERT INTO mcp_config (id, enabled, port, host)
			 VALUES (?, 0, ?, ?)`
		)
		.run(ROW_ID, LEGACY_PORT, LEGACY_HOST);
	return { enabled: 0 };
}

export function loadMcpConfig(): McpConfig {
	if (isDemoMode()) {
		return { enabled: false, enabledFromEnv: true };
	}
	const row = ensureMcpRow();
	const enabledEnv = envBool('GALENE_ENABLE_MCP');
	return {
		enabled: enabledEnv ?? row.enabled === 1,
		enabledFromEnv: enabledEnv !== null
	};
}

export function isMcpEnabled(): boolean {
	return loadMcpConfig().enabled;
}

export interface McpSettingsInput {
	enabled: boolean;
}

export function saveMcpSettings(input: McpSettingsInput): { ok: true } | { ok: false; error: string } {
	if (isDemoMode()) return { ok: false, error: 'MCP is disabled on the public demo.' };
	ensureMcpRow();
	db()
		.query(
			`UPDATE mcp_config
			 SET enabled = ?, updated_at = datetime('now')
			 WHERE id = ?`
		)
		.run(input.enabled ? 1 : 0, ROW_ID);
	return { ok: true };
}

/** Loopback base URL for in-process MCP tools calling the REST API. */
export function mcpAppBaseUrl(): string {
	const port = process.env.PORT ?? '3000';
	return `http://127.0.0.1:${port}`;
}

/** Settings form values for the API page (admin). */
export function mcpSettingsView(appOrigin: string) {
	const config = loadMcpConfig();
	const origin = appOrigin.replace(/\/$/, '') || mcpAppBaseUrl();
	return {
		enabled: config.enabled,
		enabledFromEnv: config.enabledFromEnv,
		/** Path is live when enabled (same process; no second port). */
		listening: config.enabled,
		listenUrl: `${origin}${MCP_HTTP_PATH}`,
		path: MCP_HTTP_PATH,
		version: appVersion
	};
}

/** Path to the MCP entry for stdio clients. Bundle in the image; source in a checkout. */
export function mcpEntryPath(cwd = process.cwd()): string {
	const bundle = resolve(cwd, 'mcp-bundle.js');
	if (existsSync(bundle)) return bundle;
	return resolve(cwd, 'mcp/index.ts');
}
