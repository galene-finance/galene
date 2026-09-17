import { DEFAULT_THEMES, DEFAULT_THEME_SLUG, RADIUS_RE, getDefaultTheme, isHexColor, themeValue } from '$lib/themes';
import type { Theme, ThemeColors } from '$lib/types';
import { getSetting, setSetting } from './finance';
import { db } from './db';

interface ThemeRow {
	id: number;
	name: string;
	colors: string;
}

/** Fill in any missing/invalid color values from the default light theme. */
export function normalizeColors(c: Partial<ThemeColors>): ThemeColors {
	const base = DEFAULT_THEMES[0].colors;
	const hex = (v: unknown, fallback: string) =>
		typeof v === 'string' && isHexColor(v) ? v.toLowerCase() : fallback;
	const radius =
		typeof c.radius === 'string' && RADIUS_RE.test(c.radius.trim()) ? c.radius.trim() : base.radius;
	return {
		background: hex(c.background, base.background),
		surface: hex(c.surface, base.surface),
		surfaceHover: hex(c.surfaceHover, base.surfaceHover),
		foreground: hex(c.foreground, base.foreground),
		mutedForeground: hex(c.mutedForeground, base.mutedForeground),
		primary: hex(c.primary, base.primary),
		primaryForeground: hex(c.primaryForeground, base.primaryForeground),
		success: hex(c.success, base.success),
		destructive: hex(c.destructive, base.destructive),
		border: hex(c.border, base.border),
		warning: hex(c.warning, base.warning),
		input: hex(c.input, base.input),
		radius
	};
}

function rowToTheme(row: ThemeRow): Theme {
	return {
		id: row.id,
		slug: `t${row.id}`,
		name: row.name,
		colors: normalizeColors(JSON.parse(row.colors) as Partial<ThemeColors>)
	};
}

export function getUserThemes(userId: number): Theme[] {
	const rows = db()
		.query('SELECT id, name, colors FROM themes WHERE user_id = ? ORDER BY id')
		.all(userId) as ThemeRow[];
	return rows.map(rowToTheme);
}

export function getUserThemeById(userId: number, id: number): Theme | null {
	const row = db()
		.query('SELECT id, name, colors FROM themes WHERE id = ? AND user_id = ?')
		.get(id, userId) as ThemeRow | undefined;
	return row ? rowToTheme(row) : null;
}

/** The value stored in the user's `theme` setting: a default slug or a user theme id. */
export function getThemeSetting(userId: number): string {
	return getSetting(userId, 'theme') ?? DEFAULT_THEME_SLUG;
}

/**
 * Resolve a stored theme value (or the user's current setting) to a full
 * theme. Falls back to the default light theme for unknown values.
 */
export function resolveTheme(userId: number, value?: string | null): Theme {
	const v = (value ?? getThemeSetting(userId)).trim();
	const def = getDefaultTheme(v);
	if (def) return def;
	const id = parseInt(v, 10);
	if (Number.isFinite(id)) {
		const userTheme = getUserThemeById(userId, id);
		if (userTheme) return userTheme;
	}
	return getDefaultTheme(DEFAULT_THEME_SLUG)!;
}

/** True when the value names a real default theme or one of the user's themes. */
export function isValidThemeValue(userId: number, value: string): boolean {
	if (DEFAULT_THEMES.some((t) => t.slug === value)) return true;
	const id = parseInt(value, 10);
	return Number.isFinite(id) && !!getUserThemeById(userId, id);
}

export function saveUserTheme(userId: number, id: number | null, name: string, colors: ThemeColors): number {
	const json = JSON.stringify(normalizeColors(colors));
	if (id === null) {
		const result = db().query('INSERT INTO themes (user_id, name, colors) VALUES (?, ?, ?)').run(userId, name, json);
		return Number(result.lastInsertRowid);
	}
	db().query('UPDATE themes SET name = ?, colors = ? WHERE id = ? AND user_id = ?').run(name, json, id, userId);
	return id;
}

export function deleteUserTheme(userId: number, id: number) {
	db().query('DELETE FROM themes WHERE id = ? AND user_id = ?').run(id, userId);
}

export function selectTheme(userId: number, value: string) {
	setSetting(userId, 'theme', value);
}

export { themeValue };
