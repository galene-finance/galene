import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEMES } from './themes';
import {
	parseThemePack,
	serializeThemePack,
	themePackFilename,
	uniqueThemeName
} from './theme-pack';

const tron = {
	galeneTheme: 1,
	name: 'Tron',
	extra: 'ignored',
	colors: {
		background: '#000102',
		surface: '#0C1421',
		surfaceHover: '#030e1c',
		foreground: '#e1f2f8',
		mutedForeground: '#8f8f8f',
		primary: '#00c7c7',
		primaryForeground: '#030303',
		success: '#24b6a1',
		destructive: '#d40f00',
		border: '#003636',
		warning: '#fbbf24',
		input: '#001b1b',
		radius: '0.5rem'
	}
};

describe('parseThemePack', () => {
	test('accepts a v1 pack and lowercases hex', () => {
		const result = parseThemePack(JSON.stringify(tron));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pack.name).toBe('Tron');
		expect(result.pack.galeneTheme).toBe(1);
		expect(result.pack.colors.surface).toBe('#0c1421');
		expect(result.pack.colors.radius).toBe('0.5rem');
		expect('extra' in result.pack).toBe(false);
	});

	test('round-trips through serialize', () => {
		const parsed = parseThemePack(JSON.stringify(tron));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const again = parseThemePack(serializeThemePack(parsed.pack.name, parsed.pack.colors));
		expect(again).toEqual(parsed);
	});

	test('serializes a built-in color set under its display name', () => {
		const ocean = DEFAULT_THEMES.find((t) => t.slug === 'ocean')!;
		const raw = serializeThemePack(ocean.name, ocean.colors);
		const parsed = parseThemePack(raw);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.pack.name).toBe('Ocean');
		expect(parsed.pack.colors).toEqual(ocean.colors);
	});

	test('rejects bad JSON', () => {
		expect(parseThemePack('{')).toEqual({ ok: false, error: 'That is not valid JSON.' });
	});

	test('rejects a missing or wrong version', () => {
		const { galeneTheme: _v, ...rest } = tron;
		expect(parseThemePack(JSON.stringify(rest)).ok).toBe(false);
		expect(parseThemePack(JSON.stringify({ ...tron, galeneTheme: 2 })).ok).toBe(false);
		expect(parseThemePack(JSON.stringify({ ...tron, galeneTheme: '1' })).ok).toBe(false);
	});

	test('rejects a blank or too-long name', () => {
		expect(parseThemePack(JSON.stringify({ ...tron, name: '   ' })).ok).toBe(false);
		expect(parseThemePack(JSON.stringify({ ...tron, name: 'x'.repeat(41) })).ok).toBe(false);
	});

	test('rejects a missing color', () => {
		const colors = { ...tron.colors };
		delete (colors as { primary?: string }).primary;
		const result = parseThemePack(JSON.stringify({ ...tron, colors }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain('primary');
	});

	test('rejects a bad hex', () => {
		const result = parseThemePack(
			JSON.stringify({ ...tron, colors: { ...tron.colors, primary: '#zz' } })
		);
		expect(result).toEqual({ ok: false, error: 'Invalid color for primary.' });
	});

	test('rejects a bad radius', () => {
		const result = parseThemePack(
			JSON.stringify({ ...tron, colors: { ...tron.colors, radius: '8px' } })
		);
		expect(result).toEqual({ ok: false, error: 'Card radius must look like 0.5rem.' });
	});

	test('does not fill missing colors from the light theme', () => {
		const result = parseThemePack(JSON.stringify({ galeneTheme: 1, name: 'Partial', colors: {} }));
		expect(result.ok).toBe(false);
	});
});

describe('theme pack helpers', () => {
	test('filename sanitizes the name', () => {
		expect(themePackFilename('Ocean Blue!')).toBe('ocean-blue.galene-theme.json');
		expect(themePackFilename('   ')).toBe('theme.galene-theme.json');
	});

	test('suffixes a name that already exists', () => {
		expect(uniqueThemeName('Ocean', ['Forest'])).toBe('Ocean');
		expect(uniqueThemeName('Ocean', ['Ocean'])).toBe('Ocean (2)');
		expect(uniqueThemeName('Ocean', ['ocean', 'Ocean (2)'])).toBe('Ocean (3)');
	});
});
