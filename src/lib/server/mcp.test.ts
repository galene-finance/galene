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
	ensureMcpRow,
	isMcpEnabled,
	loadMcpConfig,
	mcpEntryPath,
	mcpSettingsView,
	saveMcpSettings,
	MCP_HTTP_PATH
} = await import('./mcp');

describe('MCP settings (app-port /mcp)', () => {
	beforeEach(() => {
		delete process.env.GALENE_ENABLE_MCP;
		database.query('DELETE FROM mcp_config').run();
	});

	test('default is off and path is not live', () => {
		const cfg = loadMcpConfig();
		expect(cfg.enabled).toBe(false);
		expect(cfg.enabledFromEnv).toBe(false);
		expect(isMcpEnabled()).toBe(false);
		const view = mcpSettingsView('http://127.0.0.1:3000');
		expect(view.listening).toBe(false);
		expect(view.path).toBe('/mcp');
		expect(view.listenUrl).toBe('http://127.0.0.1:3000/mcp');
		expect(MCP_HTTP_PATH).toBe('/mcp');
	});

	test('persists enable toggle; path live when on', () => {
		const saved = saveMcpSettings({ enabled: true });
		expect(saved).toEqual({ ok: true });
		expect(loadMcpConfig().enabled).toBe(true);
		expect(isMcpEnabled()).toBe(true);
		expect(mcpSettingsView('http://example.test').listening).toBe(true);
		expect(mcpSettingsView('http://example.test').listenUrl).toBe('http://example.test/mcp');

		saveMcpSettings({ enabled: false });
		expect(loadMcpConfig().enabled).toBe(false);
		expect(isMcpEnabled()).toBe(false);
	});

	test('GALENE_ENABLE_MCP overrides the saved toggle', () => {
		ensureMcpRow();
		database.query('UPDATE mcp_config SET enabled = 0 WHERE id = 1').run();
		process.env.GALENE_ENABLE_MCP = '1';
		expect(loadMcpConfig().enabled).toBe(true);
		expect(loadMcpConfig().enabledFromEnv).toBe(true);
		expect(isMcpEnabled()).toBe(true);

		process.env.GALENE_ENABLE_MCP = '0';
		database.query('UPDATE mcp_config SET enabled = 1 WHERE id = 1').run();
		expect(loadMcpConfig().enabled).toBe(false);
		expect(isMcpEnabled()).toBe(false);
	});

	test('does not read or require port/host from Settings', () => {
		ensureMcpRow();
		database.query(`UPDATE mcp_config SET enabled = 1, port = 9999, host = '10.0.0.1' WHERE id = 1`).run();
		const view = mcpSettingsView('http://127.0.0.1:3000');
		expect(view.enabled).toBe(true);
		expect(view.listenUrl).toBe('http://127.0.0.1:3000/mcp');
		expect('port' in view).toBe(false);
		expect('host' in view).toBe(false);
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
