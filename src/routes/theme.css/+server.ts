import { getDefaultTheme, themeToCss } from '$lib/themes';
import { getUserThemeById } from '$lib/server/themes';

// Serves the CSS for one theme, keyed by the data-theme value: a built-in
// slug (no session required) or a user theme id (session required).
export function GET({ url, locals }) {
	const param = (url.searchParams.get('theme') ?? '').trim();
	let theme = getDefaultTheme(param);
	if (!theme) {
		const id = parseInt(param, 10);
		if (Number.isFinite(id) && locals.user) {
			theme = getUserThemeById(locals.user.id, id);
		}
	}
	if (!theme) return new Response('Not found', { status: 404 });
	return new Response(themeToCss(theme), {
		headers: {
			'content-type': 'text/css',
			'cache-control': 'no-cache'
		}
	});
}
