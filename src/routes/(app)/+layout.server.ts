import { redirect } from '@sveltejs/kit';
import { getTags } from '$lib/server/finance';
import { listNotifications, unreadCount } from '$lib/server/notifications';
import { scopedAccounts, scopedCategories, viewerScope } from '$lib/server/scopeQuery';
import { getThemeSetting, getUserThemes } from '$lib/server/themes';

export function load({ locals, depends }) {
	depends('user');
	depends('settings');
	if (!locals.user) redirect(303, '/login');
	const userId = locals.user.id;
	const scope = viewerScope({ locals });
	const viewer = locals.user.role === 'viewer';
	return {
		user: locals.user,
		viewer,
		accounts: scopedAccounts(userId, scope),
		categories: scopedCategories(userId, scope),
		tags: viewer ? [] : getTags(userId),
		themes: getUserThemes(userId),
		themeValue: getThemeSetting(userId),
		notifications: viewer ? [] : listNotifications(userId),
		notificationsUnread: viewer ? 0 : unreadCount(userId)
	};
}
