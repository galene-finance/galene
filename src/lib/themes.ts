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

export const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(v: string): boolean {
	return HEX_RE.test(v.trim());
}

export const RADIUS_RE = /^\d*\.?\d+rem$/;

/** The value stored in the user's `theme` setting for a given theme. */
export function themeValue(theme: Theme): string {
	return theme.id === null ? theme.slug : String(theme.id);
}

/**
 * Apply a theme to the current page immediately: sets the data-theme
 * attribute, the localStorage copy (survives logout), and the stylesheet.
 * Safe to call from the server (no-op).
 */
export function applyThemeNow(theme: Theme) {
	if (typeof document === 'undefined') return;
	const value = themeValue(theme);
	document.documentElement.dataset.theme = theme.slug;
	localStorage.setItem('galene-theme', value);
	let link = document.getElementById('theme-css') as HTMLLinkElement | null;
	if (!link) {
		link = document.createElement('link');
		link.id = 'theme-css';
		link.rel = 'stylesheet';
		document.head.appendChild(link);
	}
	link.href = `/theme.css?theme=${encodeURIComponent(value)}&v=${themeCssHash(theme)}`;
}
