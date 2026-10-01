import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'galene-mcp-'));
process.env.GALENE_DATA_DIR = dir;
process.env.GALENE_DB_PATH = join(dir, 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
delete process.env.GALENE_ENABLE_MCP;
delete process.env.GALENE_MCP_PORT;
delete process.env.GALENE_MCP_HOST;

const database = new Database(process.env.GALENE_DB_PATH);
import { migrate } from './db';
migrate(database);

const {
	_resetMcpRuntimeForTests,
	applyMcpRuntime,
	ensureMcpRow,
	isMcpListening,
	loadMcpConfig,
	mcpEntryPath,
	saveMcpSettings,
	stopMcpChild
} = await import('./mcp');

describe('MCP settings', () => {
	beforeEach(() => {
		delete process.env.GALENE_ENABLE_MCP;
		delete process.env.GALENE_MCP_PORT;
		delete process.env.GALENE_MCP_HOST;
		database.query('DELETE FROM mcp_config').run();
		_resetMcpRuntimeForTests({
			spawn: () => ({
				kill: () => true,
				killed: false,
				exited: new Promise(() => {}),
				pid: 4242
			})
		});
	});

	afterEach(() => {
		stopMcpChild();
		_resetMcpRuntimeForTests();
	});

	test('default is off and no listener starts', () => {
		const cfg = loadMcpConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.port).toBe(3001);
		applyMcpRuntime();
		expect(isMcpListening()).toBe(false);
	});

	test('persists enable/port/host and starts the child when on', () => {
		const saved = saveMcpSettings({ enabled: true, port: 3101, host: '127.0.0.1' });
		expect(saved).toEqual({ ok: true });
		const cfg = loadMcpConfig();
		expect(cfg.enabled).toBe(true);
		expect(cfg.port).toBe(3101);
		expect(cfg.host).toBe('127.0.0.1');
		expect(isMcpListening()).toBe(true);

		saveMcpSettings({ enabled: false, port: 3101, host: '127.0.0.1' });
		expect(loadMcpConfig().enabled).toBe(false);
		expect(isMcpListening()).toBe(false);
	});

	test('GALENE_ENABLE_MCP overrides the saved toggle', () => {
		ensureMcpRow();
		database.query('UPDATE mcp_config SET enabled = 0 WHERE id = 1').run();
		process.env.GALENE_ENABLE_MCP = '1';
		expect(loadMcpConfig().enabled).toBe(true);
		expect(loadMcpConfig().enabledFromEnv).toBe(true);
		applyMcpRuntime();
		expect(isMcpListening()).toBe(true);

		process.env.GALENE_ENABLE_MCP = '0';
		database.query('UPDATE mcp_config SET enabled = 1 WHERE id = 1').run();
		expect(loadMcpConfig().enabled).toBe(false);
		applyMcpRuntime();
		expect(isMcpListening()).toBe(false);
	});

	test('rejects an invalid port', () => {
		const bad = saveMcpSettings({ enabled: true, port: 0, host: '0.0.0.0' });
		expect(bad.ok).toBe(false);
		expect(isMcpListening()).toBe(false);
	});

	test('mcpEntryPath prefers mcp-bundle.js when present', () => {
		const nest = mkdtempSync(join(tmpdir(), 'galene-mcp-entry-'));
		try {
			expect(mcpEntryPath(nest).endsWith('mcp/index.ts')).toBe(true);
			writeFileSync(join(nest, 'mcp-bundle.js'), '// stub\n');
			expect(mcpEntryPath(nest).endsWith('mcp-bundle.js')).toBe(true);
		} finally {
			rmSync(nest, { recursive: true, force: true });
		}
	});
});

afterEach(() => {
	// keep suite clean for other files that import db
});

// Keep the temp dir for the process; bun test may re-import. Clean on exit.
process.on('exit', () => {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});
