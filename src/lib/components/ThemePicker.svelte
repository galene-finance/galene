<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
	import { applyThemeNow, themeValue } from '$lib/themes';
	import type { Theme } from '$lib/types';

	let {
		themes,
		selected = '',
		action = null
	}: {
		themes: Theme[];
		/** Stored value of the current theme: a default slug or a user theme id. */
		selected?: string;
		/** POST action to persist the choice; null = localStorage only (e.g. /login). */
		action?: string | null;
	} = $props();

	// Start from the prop, else from whatever app.html already applied.
	// First paint snapshot. The effect follows `selected` after a later save.
	let current = $state(untrack(() =>
		selected ||
			(typeof document !== 'undefined' &&
				themes.find((t) => t.slug === document.documentElement.dataset.theme)?.slug) ||
			themes[0].slug
	));
	$effect(() => {
		if (selected) current = themes.find((t) => themeValue(t) === selected)?.slug ?? current;
	});

	const currentTheme = $derived(themes.find((t) => t.slug === current) ?? themes[0]);

	let open = $state(false);

	function pick(t: Theme) {
		current = t.slug;
		applyThemeNow(t);
		// Plain buttons don't trigger the menu's auto-close (only MenuItems do),
		// and bits-ui locks the body to pointer-events:none while it's open.
		open = false;
	}
</script>

<DropdownMenu
	bind:open
	ariaLabel="Choose theme"
	class="min-w-0 max-w-full shrink"
>
	{#snippet trigger()}
		<span
			class="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-1.5 text-sm transition-colors hover:bg-surface-hover sm:px-2.5"
		>
			<span class="size-2.5 shrink-0 rounded-full" style="background: {currentTheme.colors.primary}"></span>
			<span class="hidden min-w-0 truncate sm:inline">{currentTheme.name}</span>
			<svg
				class="size-3.5 shrink-0 text-muted-foreground"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
		</span>
	{/snippet}

	{#each themes as t (t.slug)}
		{#if action}
			<form method="POST" {action} use:enhance class="block" onsubmit={() => pick(t)}>
				<input type="hidden" name="theme" value={themeValue(t)} />
				<button
					type="submit"
					class="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover"
				>
					<span class="flex shrink-0 gap-1">
						<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.background}"></span>
						<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.surface}"></span>
						<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.primary}"></span>
						<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.foreground}"></span>
					</span>
					<span class="flex-1 truncate text-left">{t.name}</span>
					{#if current === t.slug}
						<svg
							class="size-4 shrink-0 text-primary"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					{/if}
				</button>
			</form>
		{:else}
			<button
				type="button"
				class="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm hover:bg-surface-hover"
				onclick={() => pick(t)}
			>
				<span class="flex shrink-0 gap-1">
					<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.background}"></span>
					<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.surface}"></span>
					<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.primary}"></span>
					<span class="size-3 rounded-full border border-black/10" style="background: {t.colors.foreground}"></span>
				</span>
				<span class="flex-1 truncate text-left">{t.name}</span>
				{#if current === t.slug}
					<svg
						class="size-4 shrink-0 text-primary"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				{/if}
			</button>
		{/if}
	{/each}
</DropdownMenu>
