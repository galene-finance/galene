import { redirect } from '@sveltejs/kit';
import { getAccounts, getCategories, getTags } from '$lib/server/finance';
import { listNotifications, unreadCount } from '$lib/server/notifications';
import { getThemeSetting, getUserThemes } from '$lib/server/themes';

export function load({ locals, depends }) {
	depends('user');
	depends('settings');
	if (!locals.user) redirect(303, '/login');
	const userId = locals.user.id;
	return {
		user: locals.user,
		accounts: getAccounts(userId),
		categories: getCategories(userId),
		tags: getTags(userId),
		themes: getUserThemes(userId),
		themeValue: getThemeSetting(userId),
		notifications: listNotifications(userId),
		notificationsUnread: unreadCount(userId)
	};
}
