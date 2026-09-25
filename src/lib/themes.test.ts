import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_THEMES,
	isBuiltinThemeSlug,
	resolveStoredThemeSlug,
	themeBootstrapScript,
	themeHeadScript,
	themeToCss
} from './themes';

describe('stored theme slug', () => {
	test('keeps a built-in slug', () => {
		expect(resolveStoredThemeSlug('forest', null)).toBe('forest');
		expect(isBuiltinThemeSlug('dark')).toBe(true);
	});

	test('falls back when the stored value is a user theme id', () => {
		expect(resolveStoredThemeSlug('42', 'ocean')).toBe('ocean');
		expect(resolveStoredThemeSlug('42', null)).toBeNull();
		expect(resolveStoredThemeSlug('nope', 'light')).toBe('light');
	});
});

describe('pre-paint bootstrap', () => {
	test('app.html inlines the same script as themeBootstrapScript()', () => {
		const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
		expect(html).toContain(themeBootstrapScript());
	});

	test('bootstrap carries every built-in theme and does not fetch them', () => {
		const script = themeBootstrapScript();
		for (const theme of DEFAULT_THEMES) {
			expect(script).toContain(theme.slug);
			expect(script).toContain(theme.colors.background);
		}
		expect(script).toContain('galene-theme-slug');
		expect(script).not.toContain("link.href = '/theme.css?theme=' + encodeURIComponent(t)");
	});

	test('signed-in head script inlines server CSS and remembers a default slug', () => {
		const theme = DEFAULT_THEMES[1];
		const html = themeHeadScript({
			value: theme.slug,
			slug: theme.slug,
			base: theme.slug,
			css: themeToCss(theme)
		});
		expect(html.startsWith('<script>')).toBe(true);
		expect(html).toContain(theme.colors.background);
		expect(html).toContain('galene-theme-slug');
		expect(html).not.toContain('/theme.css');
	});

	test('signed-in head script falls back to a built-in slug for a user theme id', () => {
		const html = themeHeadScript({
			value: '7',
			slug: 't7',
			base: 'dark',
			css: "html[data-theme='t7'] { --background: #111111; }"
		});
		expect(html).toContain('galene-theme-slug');
		expect(html).toContain('"dark"');
		expect(html).toContain('"t7"');
		expect(html).not.toContain('/theme.css');
	});
});
