<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import TopNav from '$lib/components/TopNav.svelte';
	import { DEFAULT_THEMES, applyThemeNow, themeValue } from '$lib/themes';
	import type { Account, AppNotification, Branding, Category, Tag, Theme, User } from '$lib/types';

	type LayoutData = {
		user: User;
		accounts: Account[];
		categories: Category[];
		tags: Tag[];
		themes: Theme[];
		themeValue: string;
		branding: Branding;
		theme: { value: string; slug: string; hash: string } | null;
		notifications: AppNotification[];
		notificationsUnread: number;
	};

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let mobileNavOpen = $state(false);

	// Re-apply the saved theme on the client: the <head> script only runs
	// on full page loads, and scripts injected via {@html} don't execute on
	// SPA navigations, so this keeps the theme correct after login/logout
	// and when the user switches themes. Also keeps the localStorage copy
	// in sync for the login page and pre-paint on hard loads.
	$effect(() => {
		if (!data.theme) return;
		const t = [...DEFAULT_THEMES, ...data.themes].find(
			(x) => themeValue(x) === data.themeValue
		);
		if (t) applyThemeNow(t);
	});
</script>

<div class="flex min-h-dvh min-w-0 max-w-full flex-col overflow-x-clip">
	<TopNav
		user={data.user}
		branding={data.branding}
		themes={[...DEFAULT_THEMES, ...data.themes]}
		selectedTheme={data.themeValue}
		themeAction="/settings/appearance?/select-theme"
		notifications={data.notifications}
		notificationsUnread={data.notificationsUnread}
		bind:open={mobileNavOpen}
	/>

	<main class="min-w-0 max-w-full flex-1 overflow-x-clip p-4 md:p-6">
		{@render children()}
	</main>

	<ToastHost />
</div>
