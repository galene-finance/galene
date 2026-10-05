import { createPublicKey, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { closeDbForTests } from './db';
import { serializeThemePack } from '../theme-pack';
import { DEFAULT_THEMES } from '../themes';
import { ensureInstanceKey, publishCurrentTheme, publishMessage, publishThemePack } from './themeGallery';

const dbPath = join(mkdtempSync(join(tmpdir(), 'galene-gallery-')), 'galene.db');
process.env.GALENE_DB_PATH = dbPath;
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';
delete process.env.GALENE_DEMO;
delete process.env.GALENE_THEME_GALLERY_URL;

afterEach(() => {
	closeDbForTests();
	delete process.env.GALENE_DEMO;
});

describe('theme gallery publish', () => {
	test('keeps one instance key and signs the body the gallery checks', async () => {
		const first = ensureInstanceKey();
		closeDbForTests();
		const second = ensureInstanceKey();
		expect(second.publicKey).toBe(first.publicKey);

		const body = serializeThemePack(DEFAULT_THEMES[0].name, DEFAULT_THEMES[0].colors);
		let seen: { url: string; body: string; headers: Record<string, string> } | null = null;
		const result = await publishThemePack(body, {
			url: 'https://themes.galene.finance/api/themes',
			now: () => 1_700_000_000_000,
			fetchImpl: async (url, init) => {
				seen = { url, body: init.body, headers: init.headers };
				return new Response(JSON.stringify({ id: 'abc', name: 'Light' }), { status: 201 });
			}
		});
		expect(result.ok).toBe(true);
		expect(seen).not.toBeNull();
		expect(seen!.url).toBe('https://themes.galene.finance/api/themes');
		expect(seen!.body).toBe(body);
		const key = createPublicKey({
			key: { kty: 'OKP', crv: 'Ed25519', x: seen!.headers['Galene-Key'] },
			format: 'jwk'
		});
		const message = publishMessage(seen!.headers['Galene-Timestamp'], Buffer.from(seen!.body, 'utf8'));
		expect(verify(null, message, key, Buffer.from(seen!.headers['Galene-Signature'], 'base64url'))).toBe(true);
		expect(seen!.headers['Galene-Key']).toBe(first.publicKey);
	});

	test('does not publish from the public demo', async () => {
		process.env.GALENE_DEMO = '1';
		let called = false;
		const result = await publishCurrentTheme(1, {
			fetchImpl: async () => {
				called = true;
				return new Response('{}', { status: 201 });
			}
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain('disabled on the public demo');
		expect(called).toBe(false);
	});

	test('refuses a non-https gallery address', async () => {
		const result = await publishThemePack('{}', { url: 'http://example.com/api/themes' });
		expect(result.ok).toBe(false);
	});
});
