<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import TopNav from '$lib/components/TopNav.svelte';
	import { DEFAULT_THEMES, applyThemeNow, rememberThemePreference, themeValue } from '$lib/themes';
	import type { Account, AppNotification, Branding, Category, Tag, Theme, User } from '$lib/types';

	type LayoutData = {
		user: User;
		accounts: Account[];
		categories: Category[];
		tags: Tag[];
		themes: Theme[];
		themeValue: string;
		branding: Branding;
		theme: { value: string; slug: string; css: string; base: string } | null;
		notifications: AppNotification[];
		notificationsUnread: number;
		viewer?: boolean;
		demo?: boolean;
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
		// SPA navigations do not re-run the head script, so remember the
		// server theme here too (including the built-in fallback slug).
		rememberThemePreference(data.theme.value, data.theme.base);
		const t = [...DEFAULT_THEMES, ...data.themes].find(
			(x) => themeValue(x) === data.themeValue
		);
		if (t) applyThemeNow(t);
	});
</script>

<div class="galene-shell flex min-h-screen min-w-0 w-full max-w-full flex-col overflow-x-hidden overflow-x-clip">
	<TopNav
		user={data.user}
		branding={data.branding}
		themes={[...DEFAULT_THEMES, ...data.themes]}
		selectedTheme={data.themeValue}
		themeAction="/settings/appearance?/select-theme"
		notifications={data.notifications}
		notificationsUnread={data.notificationsUnread}
		viewer={data.viewer}
		bind:open={mobileNavOpen}
	/>

	<main class="min-w-0 max-w-full flex-1 overflow-x-clip p-4 md:p-6">
		{#if data.demo}
			<div
				class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-foreground"
				role="status"
			>
				<strong class="font-medium">Public demo</strong>
				— shared sample data; bank sync, backups, API tokens, advisor access, SSO, and new accounts are locked. Resets on a schedule.
			</div>
		{/if}
		{@render children()}
	</main>

	<ToastHost />
</div>
