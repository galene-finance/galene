import { createPublicKey, verify } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { closeDbForTests } from './db';
import { serializeThemePack } from '../theme-pack';
import { DEFAULT_THEMES } from '../themes';
import {
	RATE_LIMIT_MESSAGE,
	ensureInstanceKey,
	publishCurrentTheme,
	publishMessage,
	publishThemePack,
	rateLimitMessage
} from './themeGallery';

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
		expect(result.status).toBe(403);
		expect(called).toBe(false);
	});

	test('refuses a non-https gallery address', async () => {
		const result = await publishThemePack('{}', { url: 'http://example.com/api/themes' });
		expect(result.ok).toBe(false);
	});

	const gallery = 'https://themes.galene.finance/api/themes';

	test('turns the gallery 429 into a readable message with retry time', async () => {
		const result = await publishThemePack('{}', {
			url: gallery,
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: 'You can publish one theme per hour. Try again later.', code: 'rate_limited', retryAfterSec: 3599 }), {
					status: 429,
					headers: { 'Retry-After': '3599' }
				})
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(429);
		expect(result.retryAfterSec).toBe(3599);
		expect(result.error).toBe('You can publish one theme per hour. Try again in about 60 minutes.');
	});

	test('uses Retry-After when the 429 body has no retry time', async () => {
		const result = await publishThemePack('{}', {
			url: gallery,
			fetchImpl: async () => new Response('not json', { status: 429, headers: { 'Retry-After': '30' } })
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.status).toBe(429);
		expect(result.retryAfterSec).toBe(30);
		expect(result.error).toBe('You can publish one theme per hour. Try again in about a minute.');
	});

	test('falls back to a plain rate-limit message without retry info', async () => {
		const result = await publishThemePack('{}', {
			url: gallery,
			fetchImpl: async () => new Response('{}', { status: 429 })
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe(RATE_LIMIT_MESSAGE);
		expect(result.retryAfterSec).toBeUndefined();
		expect(rateLimitMessage()).toBe('You can publish one theme per hour. Try again later.');
	});

	test('maps other gallery refusals to 400 and outages to 502', async () => {
		const refused = await publishThemePack('{}', {
			url: gallery,
			fetchImpl: async () => new Response(JSON.stringify({ error: 'Theme pack is too large.' }), { status: 413 })
		});
		expect(refused.ok).toBe(false);
		if (!refused.ok) {
			expect(refused.status).toBe(400);
			expect(refused.error).toBe('Theme pack is too large.');
		}
		const down = await publishThemePack('{}', { url: gallery, fetchImpl: async () => new Response('', { status: 503 }) });
		expect(!down.ok && down.status).toBe(502);
		const unreachable = await publishThemePack('{}', {
			url: gallery,
			fetchImpl: async () => {
				throw new Error('offline');
			}
		});
		expect(!unreachable.ok && unreachable.status).toBe(502);
	});
});
