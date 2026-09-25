import type { Theme, ThemeColors } from './types';

/** Slug of the built-in theme used when a user has no saved choice. */
export const DEFAULT_THEME_SLUG = 'light';

const light: ThemeColors = {
	background: '#f8fafc',
	surface: '#ffffff',
	surfaceHover: '#f1f5f9',
	foreground: '#1e293b',
	mutedForeground: '#64748b',
	primary: '#0d9488',
	primaryForeground: '#ffffff',
	success: '#16a34a',
	destructive: '#dc2626',
	border: '#e2e8f0',
	warning: '#f59e0b',
	input: '#cbd5e1',
	radius: '0.5rem'
};

/** Built-in themes. User-created themes live in the `themes` table. */
export const DEFAULT_THEMES: Theme[] = [
	{ id: null, slug: 'light', name: 'Light', colors: light },
	{
		id: null,
		slug: 'dark',
		name: 'Dark',
		colors: {
			background: '#0f172a',
			surface: '#1e293b',
			surfaceHover: '#263349',
			foreground: '#e2e8f0',
			mutedForeground: '#94a3b8',
			primary: '#2dd4bf',
			primaryForeground: '#0f172a',
			success: '#4ade80',
			destructive: '#f87171',
			border: '#334155',
			warning: '#fbbf24',
			input: '#475569',
			radius: '0.5rem'
		}
	},
	{
		id: null,
		slug: 'forest',
		name: 'Forest',
		colors: {
			background: '#0a120e',
			surface: '#101a14',
			surfaceHover: '#18261d',
			foreground: '#e8f2ec',
			mutedForeground: '#8fa89a',
			primary: '#22ff88',
			primaryForeground: '#06130c',
			success: '#4ade80',
			destructive: '#f87171',
			border: '#1e2f24',
			warning: '#fbbf24',
			input: '#24382c',
			radius: '0.5rem'
		}
	},
	{
		id: null,
		slug: 'ocean',
		name: 'Ocean',
		colors: {
			background: '#0a1220',
			surface: '#101a2c',
			surfaceHover: '#18243a',
			foreground: '#e2e8f0',
			mutedForeground: '#8494ab',
			primary: '#3b82f6',
			primaryForeground: '#ffffff',
			success: '#34d399',
			destructive: '#f87171',
			border: '#1e2a40',
			warning: '#fbbf24',
			input: '#243350',
			radius: '0.5rem'
		}
	},
	{
		id: null,
		slug: 'rose',
		name: 'Rose',
		colors: {
			background: '#fdf2f6',
			surface: '#ffffff',
			surfaceHover: '#fce7ef',
			foreground: '#3f1d2b',
			mutedForeground: '#9d6b80',
			primary: '#db2777',
			primaryForeground: '#ffffff',
			success: '#16a34a',
			destructive: '#dc2626',
			border: '#f3d3de',
			warning: '#f59e0b',
			input: '#e8b4c6',
			radius: '0.5rem'
		}
	},
	{
		id: null,
		slug: 'graphite',
		name: 'Graphite',
		colors: {
			background: '#111315',
			surface: '#1a1d20',
			surfaceHover: '#23272b',
			foreground: '#e5e7ea',
			mutedForeground: '#9aa1a9',
			primary: '#f59e0b',
			primaryForeground: '#1a1205',
			success: '#4ade80',
			destructive: '#f87171',
			border: '#2c3136',
			warning: '#fbbf24',
			input: '#3a4046',
			radius: '0.5rem'
		}
	}
];

export function getDefaultTheme(slug: string): Theme | null {
	return DEFAULT_THEMES.find((t) => t.slug === slug) ?? null;
}

/**
 * CSS that applies a theme's colors to the document. The selector is scoped
 * to the data-theme attribute value, so it beats the :root defaults in
 * app.css regardless of stylesheet order.
 */
export function themeToCss(theme: Theme): string {
	const c = theme.colors;
	return `html[data-theme='${theme.slug}'] {
	--background: ${c.background};
	--surface: ${c.surface};
	--surface-hover: ${c.surfaceHover};
	--muted: ${c.surfaceHover};
	--border: ${c.border};
	--input: ${c.input};
	--foreground: ${c.foreground};
	--muted-foreground: ${c.mutedForeground};
	--primary: ${c.primary};
	--primary-foreground: ${c.primaryForeground};
	--success: ${c.success};
	--destructive: ${c.destructive};
	--destructive-foreground: #ffffff;
	--warning: ${c.warning};
	--ring: ${c.primary};
	--radius: ${c.radius};
}`;
}

/** Short hash of the theme's colors, used to bust the /theme.css cache. */
export function themeCssHash(theme: Theme): string {
	const s = JSON.stringify(theme.colors);
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return Math.abs(h).toString(36);
}

/** localStorage key for the last chosen theme (slug or user-theme id). */
export const THEME_STORAGE_KEY = 'galene-theme';

/**
 * localStorage key for the last built-in slug. Survives logout when the
 * active choice is a user theme the login page cannot load.
 */
export const THEME_SLUG_STORAGE_KEY = 'galene-theme-slug';

const BUILTIN_SLUGS = new Set(DEFAULT_THEMES.map((t) => t.slug));

/** True for a built-in theme slug (`dark`, `forest`, …). */
export function isBuiltinThemeSlug(value: string): boolean {
	return BUILTIN_SLUGS.has(value);
}

/**
 * Last usable built-in slug from storage. `stored` is `galene-theme`;
 * `storedSlug` is `galene-theme-slug`. A numeric user-theme id is ignored
 * here so sign-out does not leave `data-theme` pointing at CSS the
 * anonymous page cannot fetch.
 */
export function resolveStoredThemeSlug(stored: string | null, storedSlug: string | null): string | null {
	const direct = (stored ?? '').trim();
	if (isBuiltinThemeSlug(direct)) return direct;
	const fallback = (storedSlug ?? '').trim();
	if (isBuiltinThemeSlug(fallback)) return fallback;
	return null;
}

/**
 * Blocking bootstrap for app.html. Sets `data-theme` and inlines the
 * built-in theme's variables before first paint. User-theme ids (digits)
 * also request `/theme.css` when a session can serve them; the inlined
 * slug still covers the gap if that request 404s after sign-out.
 */
export function themeBootstrapScript(): string {
	const css: Record<string, string> = {};
	for (const theme of DEFAULT_THEMES) css[theme.slug] = themeToCss(theme);
	return (
		'(function(){' +
		'var css=' +
		JSON.stringify(css) +
		';' +
		'try{' +
		'var t=localStorage.getItem(' +
		JSON.stringify(THEME_STORAGE_KEY) +
		');' +
		'var s=localStorage.getItem(' +
		JSON.stringify(THEME_SLUG_STORAGE_KEY) +
		');' +
		'var slug=(t&&css[t])?t:((s&&css[s])?s:null);' +
		'if(!slug)return;' +
		'document.documentElement.dataset.theme=slug;' +
		'var st=document.createElement("style");' +
		'st.id="theme-critical";' +
		'st.textContent=css[slug];' +
		'document.head.appendChild(st);' +
		'if(t&&!css[t]&&/^\\d+$/.test(t)){' +
		'var link=document.createElement("link");' +
		'link.id="theme-css";' +
		'link.rel="stylesheet";' +
		'link.href="/theme.css?theme="+encodeURIComponent(t);' +
		'document.head.appendChild(link);' +
		'}' +
		'}catch(e){}' +
		'})();'
	);
}

/**
 * Built-in slug to keep for sign-out. A user theme keeps the browser's
 * last built-in choice; `base` (from the server) is only the fallback
 * when that choice is missing. `base` is `dark` or `light` from the
 * theme's background, so a dark custom theme does not fall back to white.
 */
export function themeBaseSlug(theme: Theme): string {
	if (theme.id === null && isBuiltinThemeSlug(theme.slug)) return theme.slug;
	return isDarkHex(theme.colors.background) ? 'dark' : 'light';
}

function isDarkHex(hex: string): boolean {
	const n = parseInt(hex.slice(1), 16);
	if (!Number.isFinite(n)) return true;
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/**
 * Head snippet for a signed-in page. Inlines the resolved theme (built-in
 * or custom) and remembers the setting plus a built-in slug.
 */
export function themeHeadScript(theme: { value: string; slug: string; css: string; base: string }): string {
	const builtins = DEFAULT_THEMES.map((t) => t.slug);
	return (
		'<script>\n' +
		'(function(){\n' +
		'var slug=' +
		JSON.stringify(theme.slug) +
		';\n' +
		'var value=' +
		JSON.stringify(theme.value) +
		';\n' +
		'var base=' +
		JSON.stringify(isBuiltinThemeSlug(theme.base) ? theme.base : 'dark') +
		';\n' +
		'var known=' +
		JSON.stringify(builtins) +
		';\n' +
		'document.documentElement.dataset.theme=slug;\n' +
		'try{\n' +
		'var prev=localStorage.getItem(' +
		JSON.stringify(THEME_SLUG_STORAGE_KEY) +
		');\n' +
		'var keep=known.indexOf(value)>=0?value:(known.indexOf(prev)>=0?prev:base);\n' +
		'localStorage.setItem(' +
		JSON.stringify(THEME_STORAGE_KEY) +
		',value);\n' +
		'localStorage.setItem(' +
		JSON.stringify(THEME_SLUG_STORAGE_KEY) +
		',keep);\n' +
		'}catch(e){}\n' +
		'var st=document.getElementById("theme-critical");\n' +
		'if(!st){st=document.createElement("style");st.id="theme-critical";document.head.appendChild(st);}\n' +
		'st.textContent=' +
		JSON.stringify(theme.css) +
		';\n' +
		'var link=document.getElementById("theme-css");\n' +
		'if(link)link.remove();\n' +
		'})();\n' +
		'</' +
		'script>'
	);
}

export const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(v: string): boolean {
	return HEX_RE.test(v.trim());
}

export const RADIUS_RE = /^\d*\.?\d+rem$/;

/** The value stored in the user's `theme` setting for a given theme. */
export function themeValue(theme: Theme): string {
	return theme.id === null ? theme.slug : String(theme.id);
}

/** Remember the active setting and a built-in slug the login page can paint. */
export function rememberThemePreference(value: string, base: string) {
	if (typeof localStorage === 'undefined') return;
	try {
		const prev = localStorage.getItem(THEME_SLUG_STORAGE_KEY);
		const keep = isBuiltinThemeSlug(value)
			? value
			: prev && isBuiltinThemeSlug(prev)
				? prev
				: isBuiltinThemeSlug(base)
					? base
					: 'dark';
		localStorage.setItem(THEME_STORAGE_KEY, value);
		localStorage.setItem(THEME_SLUG_STORAGE_KEY, keep);
	} catch {
		/* private mode */
	}
}

/**
 * Paint theme variables now. Colors are inlined so a refresh does not wait
 * on `/theme.css`. Safe to call from the server (no-op).
 */
export function applyThemeNow(theme: Theme) {
	if (typeof document === 'undefined') return;
	const value = themeValue(theme);
	document.documentElement.dataset.theme = theme.slug;
	const prev =
		typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_SLUG_STORAGE_KEY) : null;
	rememberThemePreference(value, prev && isBuiltinThemeSlug(prev) ? prev : themeBaseSlug(theme));
	let style = document.getElementById('theme-critical');
	if (!style) {
		style = document.createElement('style');
		style.id = 'theme-critical';
		document.head.appendChild(style);
	}
	style.textContent = themeToCss(theme);
	const link = document.getElementById('theme-css');
	if (link) link.remove();
}
