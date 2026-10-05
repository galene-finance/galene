import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { closeDbForTests } from './db';
import { publishCurrentTheme } from './themeGallery';
import { publishThemeAction } from './themeGalleryAction';

process.env.GALENE_DB_PATH = join(mkdtempSync(join(tmpdir(), 'galene-gallery-action-')), 'galene.db');
process.env.GALENE_ALLOW_EPHEMERAL_DATA = '1';

afterEach(() => {
	closeDbForTests();
	delete process.env.GALENE_DEMO;
});

describe('publish-theme action', () => {
	test('demo publish fails with 403, not 200 with error text', async () => {
		process.env.GALENE_DEMO = '1';
		let called = false;
		const result = await publishThemeAction(() =>
			publishCurrentTheme(1, {
				fetchImpl: async () => {
					called = true;
					return new Response('{}', { status: 201 });
				}
			})
		);
		expect(called).toBe(false);
		expect('status' in result && result.status).toBe(403);
		const data = (result as { data: { error: string; rateLimited: boolean } }).data;
		expect(data.error).toBe('Publishing a theme is disabled on the public demo. Run your own Galene instance to use it.');
		expect(data.rateLimited).toBe(false);
	});

	test('gallery rate limit fails with 429 and a readable message', async () => {
		const result = await publishThemeAction(async () => ({
			ok: false,
			status: 429,
			error: 'You can publish one theme per hour. Try again in about 60 minutes.',
			retryAfterSec: 3599
		}));
		expect('status' in result && result.status).toBe(429);
		const data = (result as { data: { publishError: string; rateLimited: boolean; retryAfterSec: number } }).data;
		expect(data.publishError).toBe('You can publish one theme per hour. Try again in about 60 minutes.');
		expect(data.rateLimited).toBe(true);
		expect(data.retryAfterSec).toBe(3599);
	});

	test('success stays a normal action result', async () => {
		const result = await publishThemeAction(async () => ({ ok: true, message: 'Published to the theme gallery.' }));
		expect(result).toEqual({ ok: true, message: 'Published to the theme gallery.' });
	});
});
