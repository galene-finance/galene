import { getIcon, iconPaths } from '$lib/icons';
import { readableOn } from '$lib/color';
import { getSetting } from '$lib/server/finance';
import { resolveTheme } from '$lib/server/themes';
import { DEFAULT_THEMES } from '$lib/themes';

// The browser sends the session cookie with favicon requests, so a signed-in
// user gets their own icon and theme accent; anonymous visitors get defaults.
export function GET({ locals }) {
	let iconKey = 'logo';
	let accent = DEFAULT_THEMES[0].colors.primary;
	if (locals.user) {
		iconKey = getSetting(locals.user.id, 'favicon') ?? 'logo';
		accent = resolveTheme(locals.user.id).colors.primary;
	}
	const icon = getIcon(iconKey);
	const fg = readableOn(accent);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="${accent}"/>
<g transform="translate(16 16) scale(1.3333)" fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths(icon.key)}</g>
</svg>`;
	return new Response(svg, {
		headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' }
	});
}
