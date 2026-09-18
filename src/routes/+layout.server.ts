import { getSetting } from '$lib/server/finance';
import { getThemeSetting, resolveTheme } from '$lib/server/themes';
import { themeCssHash } from '$lib/themes';
import { EMBLEM_ICON_KEY, normalizeBrandingIcon } from '$lib/icons';

const DEFAULT_BRANDING = { name: 'Galene', icon: EMBLEM_ICON_KEY };

export function load({ locals, depends }) {
	depends('user');
	depends('settings');
	if (!locals.user) {
		// No session (e.g. /login): show the instance defaults.
		return { branding: { ...DEFAULT_BRANDING }, theme: null };
	}
	const userId = locals.user.id;
	const name = (getSetting(userId, 'app_name') ?? '').trim() || DEFAULT_BRANDING.name;
	const icon = normalizeBrandingIcon(getSetting(userId, 'icon') ?? DEFAULT_BRANDING.icon);
	const theme = resolveTheme(userId);
	return {
		branding: { name, icon },
		theme: {
			// value: what the user's setting stores (slug or user theme id)
			value: getThemeSetting(userId),
			// slug: what goes in the data-theme attribute
			slug: theme.slug,
			hash: themeCssHash(theme)
		}
	};
}
