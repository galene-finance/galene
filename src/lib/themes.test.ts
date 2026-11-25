import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_THEMES,
	DEFAULT_THEME_SLUG,
	isBuiltinThemeSlug,
	resolveStoredThemeSlug,
	themeBootstrapScript,
	themeHeadScript,
	themeToCss,
	themeCssHash,
	themePresentationOrder,
} from './themes';

describe('Graphite default without losing saved choices', () => {
	test('stylesheet fallback agrees with Graphite before scripts run', () => {
		const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8').split('@theme inline')[0];
		const graphite = DEFAULT_THEMES.find(t => t.slug === 'graphite')!;
		for (const key of ['background', 'surface', 'foreground', 'primary'] as const) expect(css).toContain(`--${key}: ${graphite.colors[key]};`);
	});
	test('uses Graphite as the native default', () => expect(DEFAULT_THEME_SLUG).toBe('graphite'));
	test.each([null, 'ocean', 'dark'])('paints fresh or saved built-in choice %j', (stored) => {
		const doc = { documentElement: { dataset: {} as Record<string, string> }, createElement: () => ({}), head: { appendChild: (_node: unknown) => {} } };
		new Function('document', 'localStorage', themeBootstrapScript())(doc, { getItem: (key: string) => key === 'galene-theme' ? stored : null });
		expect(doc.documentElement.dataset.theme).toBe(stored ?? 'graphite');
	});
});

describe('filled status palette', () => {
	function luminance(hex: string) {
		const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
		return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
	}
 for(const slug of ['graphite','ocean','dark']) test(`${slug} has readable primary controls and the shared radius`,()=>{
  const theme=DEFAULT_THEMES.find(t=>t.slug===slug)!;const c=theme.colors;
  expect(themeToCss(theme)).toContain('color-scheme: dark;');
  const a=luminance(c.primary),b=luminance(c.primaryForeground);
  expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5);
  expect(c.radius).toBe('0.875rem');
 });
	for (const theme of DEFAULT_THEMES) test(`${theme.slug} has opaque readable filled status tokens`, () => {
		const css = themeToCss(theme);
		for (const state of ['neutral', 'positive', 'attention', 'negative', 'movement']) {
			const fill = css.match(new RegExp(`--pill-${state}-fill: (#[0-9a-fA-F]{6});`))?.[1];
			const ink = css.match(new RegExp(`--pill-${state}-ink: (#[0-9a-fA-F]{6});`))?.[1];
			expect(fill).toBeDefined(); expect(ink).toBeDefined();
			const a = luminance(fill!), b = luminance(ink!);
			expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
		}
	});
});

test('cache keys change when emitted CSS changes beyond stored colors', () => {
 for (const theme of DEFAULT_THEMES) {
  const source = JSON.stringify(theme.colors); let oldHash = 0;
  for (let i = 0; i < source.length; i++) oldHash = (oldHash * 31 + source.charCodeAt(i)) | 0;
  expect(themeCssHash(theme)).not.toBe(Math.abs(oldHash).toString(36));
 }
});

test('presentation leads with the chosen trio without changing native normalization order',()=>{
 const before=DEFAULT_THEMES.map(t=>t.slug);
 expect(themePresentationOrder(DEFAULT_THEMES).slice(0,3).map(t=>t.slug)).toEqual(['graphite','ocean','dark']);
 expect(DEFAULT_THEMES.map(t=>t.slug)).toEqual(before);
 expect(DEFAULT_THEMES[0].slug).toBe('light');
});

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
