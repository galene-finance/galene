import { getSetting, setSetting } from '$lib/server/finance';
import {
	deleteUserTheme,
	getThemeSetting,
	getUserThemeById,
	getUserThemes,
	isValidThemeValue,
	saveUserTheme
} from '$lib/server/themes';
import { parseThemePack, uniqueThemeName } from '$lib/theme-pack';
import { isDemoMode } from '$lib/server/demoMode';
import { publishCurrentTheme } from '$lib/server/themeGallery';
import { publishThemeAction } from '$lib/server/themeGalleryAction';
import { DEFAULT_THEME_SLUG, RADIUS_RE, isHexColor } from '$lib/themes';
import { EMBLEM_ICON_KEY, ICONS, isValidBrandingIcon, normalizeBrandingIcon } from '$lib/icons';
import type { ThemeColors } from '$lib/types';

export function load({ locals }) {
	const userId = locals.user!.id;
	return {
		themes: getUserThemes(userId),
		selected: getThemeSetting(userId),
		appName: getSetting(userId, 'app_name') ?? '',
		icon: normalizeBrandingIcon(getSetting(userId, 'icon') ?? EMBLEM_ICON_KEY),
		favicon: normalizeBrandingIcon(getSetting(userId, 'favicon') ?? EMBLEM_ICON_KEY),
		weekStartsOn: getSetting(userId, 'week_starts_on') ?? 'sunday',
		canPublishTheme: !isDemoMode()
	};
}

export const actions = {
	'select-theme': async ({ request, locals }) => {
		const form = await request.formData();
		const value = String(form.get('theme') ?? '').trim();
		if (!isValidThemeValue(locals.user!.id, value)) return { error: 'Unknown theme.' };
		setSetting(locals.user!.id, 'theme', value);
		return { ok: true };
	},

	'save-theme': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = form.get('id') ? parseInt(String(form.get('id')), 10) : null;
		const name = String(form.get('name') ?? '').trim();
		if (!name) return { error: 'Theme name is required.' };
		if (name.length > 40) return { error: 'Theme name must be 40 characters or fewer.' };
		if (id !== null && !getUserThemeById(userId, id)) return { error: 'Theme not found.' };

		const colors: ThemeColors = {
			background: String(form.get('background') ?? ''),
			surface: String(form.get('surface') ?? ''),
			surfaceHover: String(form.get('surfaceHover') ?? ''),
			foreground: String(form.get('foreground') ?? ''),
			mutedForeground: String(form.get('mutedForeground') ?? ''),
			primary: String(form.get('primary') ?? ''),
			primaryForeground: String(form.get('primaryForeground') ?? ''),
			success: String(form.get('success') ?? ''),
			destructive: String(form.get('destructive') ?? ''),
			border: String(form.get('border') ?? ''),
			warning: String(form.get('warning') ?? ''),
			input: String(form.get('input') ?? ''),
			radius: String(form.get('radius') ?? '0.5rem')
		};
		for (const [key, value] of Object.entries(colors)) {
			if (key === 'radius') {
				if (!RADIUS_RE.test(value.trim())) return { error: 'Card radius must look like 0.5rem.' };
			} else if (!isHexColor(value)) {
				return { error: `Invalid color for ${key}.` };
			}
		}

		const savedId = saveUserTheme(userId, id, name, colors);
		setSetting(userId, 'theme', String(savedId));
		return { ok: true };
	},

	'import-theme': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const parsed = parseThemePack(String(form.get('pack') ?? ''));
		if (!parsed.ok) return { error: parsed.error };

		const replaceIdRaw = String(form.get('replaceId') ?? '').trim();
		let id: number | null = null;
		let name = String(form.get('name') ?? parsed.pack.name).trim();
		if (!name) return { error: 'Theme name is required.' };
		if (name.length > 40) return { error: 'Theme name must be 40 characters or fewer.' };

		if (replaceIdRaw) {
			id = parseInt(replaceIdRaw, 10);
			if (!Number.isFinite(id) || !getUserThemeById(userId, id)) {
				return { error: 'Choose a custom theme to replace, or save as a new theme.' };
			}
		} else {
			name = uniqueThemeName(
				name,
				getUserThemes(userId).map((t) => t.name)
			);
		}

		const savedId = saveUserTheme(userId, id, name, parsed.pack.colors);
		setSetting(userId, 'theme', String(savedId));
		return { ok: true, message: id ? 'Theme replaced.' : 'Theme imported.' };
	},

	'delete-theme': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = parseInt(String(form.get('id') ?? ''), 10);
		if (!Number.isFinite(id) || !getUserThemeById(userId, id)) return { error: 'Theme not found.' };
		deleteUserTheme(userId, id);
		if (getThemeSetting(userId) === String(id)) setSetting(userId, 'theme', DEFAULT_THEME_SLUG);
		return { ok: true };
	},

	'save-branding': async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const name = String(form.get('app_name') ?? '').trim();
		const icon = String(form.get('icon') ?? '').trim();
		const favicon = String(form.get('favicon') ?? '').trim();
		if (name.length > 40) return { error: 'App name must be 40 characters or fewer.' };
		const iconKey = normalizeBrandingIcon(icon);
		if (!isValidBrandingIcon(iconKey)) return { error: 'Invalid icon.' };
		const faviconKey = normalizeBrandingIcon(favicon);
		if (!isValidBrandingIcon(faviconKey)) return { error: 'Invalid favicon.' };
		setSetting(userId, 'app_name', name);
		setSetting(userId, 'icon', iconKey);
		setSetting(userId, 'favicon', faviconKey);
		return { ok: true };
	},

	'publish-theme': async ({ locals }) => {
		return publishThemeAction(() => publishCurrentTheme(locals.user!.id));
	},

	'save-week-start': async ({ request, locals }) => {
		const form = await request.formData();
		const value = String(form.get('week_starts_on') ?? '');
		if (!['sunday', 'monday'].includes(value)) return { error: 'Invalid week start.' };
		setSetting(locals.user!.id, 'week_starts_on', value);
		return { ok: true };
	}
};
