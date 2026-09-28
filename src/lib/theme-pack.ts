import { RADIUS_RE, isHexColor } from './themes';
import type { ThemeColors } from './types';

/** Share-pack schema version. Import rejects every other value. */
export const GALENE_THEME_VERSION = 1;

export const THEME_NAME_MAX = 40;

/** Color keys in ThemeColors order, excluding radius. */
export const THEME_COLOR_KEYS = [
	'background',
	'surface',
	'surfaceHover',
	'foreground',
	'mutedForeground',
	'primary',
	'primaryForeground',
	'success',
	'destructive',
	'border',
	'warning',
	'input'
] as const satisfies readonly (keyof ThemeColors)[];

export interface ThemePack {
	galeneTheme: typeof GALENE_THEME_VERSION;
	name: string;
	colors: ThemeColors;
}

export type ThemePackResult = { ok: true; pack: ThemePack } | { ok: false; error: string };

function colorLabel(key: string): string {
	return key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
}

/**
 * Parse a Galene theme share pack. Unknown top-level fields are ignored.
 * Missing or invalid colors are rejected — they are not filled from defaults.
 */
export function parseThemePack(raw: string): ThemePackResult {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'That is not valid JSON.' };
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return { ok: false, error: 'Theme pack must be a JSON object.' };
	}
	const obj = data as Record<string, unknown>;
	if (obj.galeneTheme !== GALENE_THEME_VERSION) {
		return {
			ok: false,
			error: `This pack is not a Galene theme (version ${GALENE_THEME_VERSION}).`
		};
	}
	if (typeof obj.name !== 'string' || !obj.name.trim()) {
		return { ok: false, error: 'Theme name is required.' };
	}
	const name = obj.name.trim();
	if (name.length > THEME_NAME_MAX) {
		return { ok: false, error: `Theme name must be ${THEME_NAME_MAX} characters or fewer.` };
	}
	if (!obj.colors || typeof obj.colors !== 'object' || Array.isArray(obj.colors)) {
		return { ok: false, error: 'Theme colors are missing.' };
	}
	const colorsIn = obj.colors as Record<string, unknown>;
	const colors = {} as ThemeColors;
	for (const key of THEME_COLOR_KEYS) {
		const value = colorsIn[key];
		if (typeof value !== 'string') {
			return { ok: false, error: `Missing color for ${colorLabel(key)}.` };
		}
		if (!isHexColor(value)) {
			return { ok: false, error: `Invalid color for ${colorLabel(key)}.` };
		}
		colors[key] = value.trim().toLowerCase();
	}
	const radius = colorsIn.radius;
	if (typeof radius !== 'string') {
		return { ok: false, error: 'Card radius is missing.' };
	}
	const radiusTrim = radius.trim();
	if (!RADIUS_RE.test(radiusTrim)) {
		return { ok: false, error: 'Card radius must look like 0.5rem.' };
	}
	colors.radius = radiusTrim;
	return { ok: true, pack: { galeneTheme: GALENE_THEME_VERSION, name, colors } };
}

/** Serialize the live color set. Only the versioned pack fields are written. */
export function serializeThemePack(name: string, colors: ThemeColors): string {
	const pack: ThemePack = {
		galeneTheme: GALENE_THEME_VERSION,
		name: name.trim(),
		colors: { ...colors }
	};
	return JSON.stringify(pack, null, 2);
}

/** Filename for a downloaded pack. Falls back when the name has no safe characters. */
export function themePackFilename(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return `${slug || 'theme'}.galene-theme.json`;
}

/**
 * Pick a name that does not collide with existing user theme names.
 * `Ocean` with `Ocean` taken becomes `Ocean (2)`.
 */
export function uniqueThemeName(name: string, existing: readonly string[]): string {
	const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
	const base = name.trim().slice(0, THEME_NAME_MAX);
	if (!taken.has(base.toLowerCase())) return base;
	for (let n = 2; n < 1000; n++) {
		const suffix = ` (${n})`;
		const stem = base.slice(0, Math.max(1, THEME_NAME_MAX - suffix.length));
		const candidate = `${stem}${suffix}`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
	return base;
}
