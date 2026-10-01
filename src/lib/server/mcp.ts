import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './db';
import { appVersion } from '../version';

/**
 * Household MCP HTTP listener (ADO-35).
 *
 * Precedence: a set GALENE_ENABLE_MCP env var overrides the Settings toggle.
 * GALENE_MCP_PORT / GALENE_MCP_HOST override the saved port/host when set.
 * Default is off — upgrades never open a listener until an admin enables it.
 *
 * When on, the app spawns the bundled MCP server (mcp-bundle.js in the image,
 * or mcp/index.ts from a source checkout). Off stops that child — no listener.
 * Stdio clients can still launch the bundle themselves without this toggle.
 */

const ROW_ID = 1;
const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';

export interface McpConfig {
	enabled: boolean;
	port: number;
	host: string;
	enabledFromEnv: boolean;
	portFromEnv: boolean;
	hostFromEnv: boolean;
}

interface ConfigRow {
	enabled: number;
	port: number;
	host: string;
}

type McpChild = {
	kill: (code?: number | NodeJS.Signals) => boolean | void;
	killed?: boolean;
	exited?: Promise<number>;
	pid?: number;
};

let child: McpChild | null = null;
let startedKey: string | null = null;
/** Test hook: replace spawn without hitting the real Bun.spawn. */
let spawnImpl: ((cmd: string[], opts: SpawnOpts) => McpChild) | null = null;

interface SpawnOpts {
	env: Record<string, string | undefined>;
	stdout: 'inherit';
	stderr: 'inherit';
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

function envPort(name: string): number | null {
	const raw = envTrim(name);
	if (!raw) return null;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
	return n;
}

export function ensureMcpRow(): ConfigRow {
	const existing = db()
		.query('SELECT enabled, port, host FROM mcp_config WHERE id = ?')
		.get(ROW_ID) as ConfigRow | undefined;
	if (existing) return existing;
	db()
		.query(
			`INSERT INTO mcp_config (id, enabled, port, host)
			 VALUES (?, 0, ?, ?)`
		)
		.run(ROW_ID, DEFAULT_PORT, DEFAULT_HOST);
	return { enabled: 0, port: DEFAULT_PORT, host: DEFAULT_HOST };
}

export function loadMcpConfig(): McpConfig {
	const row = ensureMcpRow();
	const enabledEnv = envBool('GALENE_ENABLE_MCP');
	const portEnv = envPort('GALENE_MCP_PORT');
	const hostEnv = envTrim('GALENE_MCP_HOST');
	return {
		enabled: enabledEnv ?? row.enabled === 1,
		port: portEnv ?? row.port,
		host: hostEnv || row.host || DEFAULT_HOST,
		enabledFromEnv: enabledEnv !== null,
		portFromEnv: portEnv !== null,
		hostFromEnv: hostEnv.length > 0
	};
}

export interface McpSettingsInput {
	enabled: boolean;
	port: number;
	host: string;
}

export function saveMcpSettings(input: McpSettingsInput): { ok: true } | { ok: false; error: string } {
	ensureMcpRow();
	const port = Number(input.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { ok: false, error: 'MCP port must be an integer between 1 and 65535.' };
	}
	const host = input.host.trim() || DEFAULT_HOST;
	if (host.length > 255 || /[\s]/.test(host)) {
		return { ok: false, error: 'MCP host must be a hostname or IP without spaces.' };
	}
	db()
		.query(
			`UPDATE mcp_config
			 SET enabled = ?, port = ?, host = ?, updated_at = datetime('now')
			 WHERE id = ?`
		)
		.run(input.enabled ? 1 : 0, port, host, ROW_ID);
	applyMcpRuntime();
	return { ok: true };
}

/** Settings form values for the API page (admin). */
export function mcpSettingsView() {
	const config = loadMcpConfig();
	return {
		enabled: config.enabled,
		port: config.port,
		host: config.host,
		enabledFromEnv: config.enabledFromEnv,
		portFromEnv: config.portFromEnv,
		hostFromEnv: config.hostFromEnv,
		listening: isMcpListening(),
		listenUrl: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}/mcp`,
		version: appVersion
	};
}

/** Path to the MCP entry the child runs. Bundle in the image; source in a checkout. */
export function mcpEntryPath(cwd = process.cwd()): string {
	const bundle = resolve(cwd, 'mcp-bundle.js');
	if (existsSync(bundle)) return bundle;
	return resolve(cwd, 'mcp/index.ts');
}

function appBaseUrl(): string {
	const port = process.env.PORT ?? '3000';
	return `http://127.0.0.1:${port}`;
}

function runtimeKey(config: McpConfig): string {
	return `${config.enabled ? 1 : 0}:${config.port}:${config.host}`;
}

function defaultSpawn(cmd: string[], opts: SpawnOpts): McpChild {
	// Bun.spawn is available under the Bun runtime (dev + production image).
	return Bun.spawn(cmd, {
		env: opts.env,
		stdout: opts.stdout,
		stderr: opts.stderr
	}) as unknown as McpChild;
}

export function stopMcpChild(): void {
	if (!child) {
		startedKey = null;
		return;
	}
	try {
		child.kill();
	} catch {
		// Already exited.
	}
	child = null;
	startedKey = null;
}

export function isMcpListening(): boolean {
	return child != null && !child.killed;
}

/**
 * Start or stop the MCP child to match the effective config.
 * Safe to call repeatedly (startup, Settings save, tests).
 */
export function applyMcpRuntime(): void {
	const config = loadMcpConfig();
	const key = runtimeKey(config);
	if (!config.enabled) {
		stopMcpChild();
		return;
	}
	if (child && !child.killed && startedKey === key) return;
	stopMcpChild();
	const entry = mcpEntryPath();
	const spawn = spawnImpl ?? defaultSpawn;
	child = spawn(['bun', entry], {
		env: {
			...process.env,
			GALENE_API_URL: appBaseUrl(),
			GALENE_MCP_PORT: String(config.port),
			GALENE_MCP_HOST: config.host,
			// HTTP mode must not carry a process-wide API token.
			GALENE_API_TOKEN: undefined
		},
		stdout: 'inherit',
		stderr: 'inherit'
	});
	startedKey = key;
	void child.exited?.then(() => {
		if (startedKey === key) {
			child = null;
			startedKey = null;
		}
	});
}

/** Called once from hooks.server.ts — same pattern as backup/sync schedulers. */
export function startMcpRuntime(): void {
	applyMcpRuntime();
	// Adapter emits this after draining HTTP; child is not detached so it also
	// dies if the parent exits abruptly.
	process.once('sveltekit:shutdown', () => stopMcpChild());
}

/** Test-only: inject a fake spawn and reset process state. */
export function _resetMcpRuntimeForTests(opts?: {
	spawn?: (cmd: string[], opts: SpawnOpts) => McpChild;
}): void {
	stopMcpChild();
	spawnImpl = opts?.spawn ?? null;
}
