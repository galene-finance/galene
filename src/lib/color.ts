// Pure color math shared by server (branding) and client (root layout).
// No runtime imports — safe in both bundles.

export type Oklch = { L: number; C: number; H: number };

/** Parse a #rrggbb hex string into OKLCH, or null if not a valid hex color. */
export function hexToOklch(hex: string): Oklch | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	const n = parseInt(m[1], 16);
	const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	const lin = srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
	const [r, g, b] = lin;
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m2 = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m2 - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m2 + 0.4505937099 * s;
	const b2 = 0.0259040371 * l + 0.7827717662 * m2 - 0.808675766 * s;
	return { L, C: Math.hypot(a, b2), H: ((Math.atan2(b2, a) * 180) / Math.PI + 360) % 360 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const oklch = (L: number, C: number, H: number) =>
	`oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;

/**
 * CSS overrides for a custom accent color. Keeps the user's hue/chroma but
 * clamps lightness per theme so buttons stay readable on both backgrounds,
 * and picks a contrasting foreground. Returns null for an invalid color.
 *
 * Selectors use html[data-theme] (specificity 0,1,1) so the overrides beat
 * both :root (0,1,0) and [data-theme='dark'] (0,1,0) in app.css regardless
 * of stylesheet order.
 */
export function accentCss(hex: string): string | null {
	const c = hexToOklch(hex);
	if (!c) return null;
	const lightL = clamp(c.L, 0.45, 0.7);
	const darkL = clamp(c.L + 0.12, 0.62, 0.88);
	const lightFg = lightL > 0.62 ? 'oklch(0.2 0.01 265)' : 'oklch(0.98 0 0)';
	const darkFg = darkL > 0.72 ? 'oklch(0.2 0.01 265)' : 'oklch(0.98 0 0)';
	return `
html[data-theme] {
	--primary: ${oklch(lightL, c.C, c.H)};
	--primary-foreground: ${lightFg};
	--ring: ${oklch(lightL, c.C, c.H)};
}
html[data-theme='dark'] {
	--primary: ${oklch(darkL, c.C, c.H)};
	--primary-foreground: ${darkFg};
	--ring: ${oklch(darkL, c.C, c.H)};
}`;
}

/** Readable text color (near-white or near-black) for a hex background. */
export function readableOn(hex: string): string {
	const c = hexToOklch(hex);
	if (!c) return '#ffffff';
	return c.L > 0.62 ? '#0f172a' : '#ffffff';
}
