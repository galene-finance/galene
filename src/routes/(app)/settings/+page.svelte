<script lang="ts">
	import Title from '$lib/components/Title.svelte';
	import { filterSettingsSections, settingsSections } from '$lib/settingsHub';

	let {
		data
	}: {
		data: { isAdmin: boolean };
	} = $props();

	let query = $state('');

	const sections = $derived(filterSettingsSections(settingsSections(data.isAdmin), query));
</script>

<Title title="Settings" />

<div class="mx-auto flex min-w-0 max-w-3xl flex-col gap-6 2xl:max-w-5xl">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
			<p class="mt-1 text-sm text-muted-foreground">Browse by card, or type to filter title and description.</p>
		</div>
		<label
			class="flex min-w-[min(100%,17.5rem)] flex-1 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:max-w-xs sm:flex-none"
		>
			<svg
				class="shrink-0 text-muted-foreground"
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="M20 20l-3.5-3.5" />
			</svg>
			<input
				type="search"
				bind:value={query}
				placeholder="Find a setting…"
				autocomplete="off"
				aria-label="Find a setting"
				class="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
			/>
		</label>
	</div>

	{#if sections.length === 0}
		<p class="text-sm text-muted-foreground">No settings match. Try “sync”, “API”, or “backup”.</p>
	{/if}

	{#each sections as section (section.id)}
		<section>
			<h2 class="mb-2.5 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">
				{section.label}
			</h2>
			<div class="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-2 xl:grid-cols-3">
				{#each section.cards as card (card.href)}
					<a
						href={card.href}
						class="group flex min-h-[6.75rem] flex-col gap-1.5 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-px hover:border-primary/50"
					>
						<span
							class="mb-1 grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary"
							aria-hidden="true">{card.icon}</span
						>
						<p class="text-[0.95rem] font-semibold group-hover:text-primary">
							{card.title}
							{#if card.admin}
								<span
									class="ml-1.5 inline-block rounded bg-primary/10 px-1.5 py-px align-middle text-[0.65rem] font-semibold tracking-wide text-primary uppercase"
									>Admin</span
								>
							{/if}
						</p>
						<p class="flex-1 text-[0.8rem] leading-snug text-muted-foreground">{card.desc}</p>
					</a>
				{/each}
			</div>
		</section>
	{/each}
</div>
