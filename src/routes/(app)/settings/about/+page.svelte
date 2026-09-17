<script lang="ts">
	import Title from '$lib/components/Title.svelte';
	import { iconPaths } from '$lib/icons';
	import { repoUrl, shortCommit } from '$lib/version';
	import type { Branding } from '$lib/types';

	let {
		data
	}: {
		data: {
			branding: Branding;
			version: { name: string; version: string; commit: string | null; built_at: string | null };
		};
	} = $props();

	const logo = $derived(iconPaths(data.branding.icon));
	const commit = $derived(data.version.commit ?? '');
	const builtAt = $derived(data.version.built_at ?? '');
</script>

<Title title="About" />

<div class="mx-auto flex max-w-3xl flex-col gap-8 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">About</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="flex items-center gap-3 border-b border-border px-4 py-3">
			<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					{@html logo}
				</svg>
			</span>
			<div class="min-w-0">
				<h2 class="font-medium">{data.branding.name}</h2>
				<p class="text-sm text-muted-foreground">Calm seas. Clear books.</p>
				<p class="text-sm text-muted-foreground">v{data.version.version}</p>
			</div>
		</div>
		<div class="grid gap-x-8 gap-y-3 p-4 sm:grid-cols-2">
			<div>
				<p class="text-sm font-medium">Version</p>
				<p class="text-sm text-muted-foreground">v{data.version.version}</p>
			</div>
			<div>
				<p class="text-sm font-medium">Commit</p>
				{#if commit}
					<p class="text-sm text-muted-foreground">
						<a
							href="{repoUrl}/commit/{commit}"
							target="_blank"
							rel="noopener noreferrer"
							class="underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
						>
							{shortCommit()}
						</a>
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">unknown</p>
				{/if}
			</div>
			<div>
				<p class="text-sm font-medium">Built</p>
				<p class="text-sm text-muted-foreground">{builtAt ? new Date(builtAt).toLocaleString() : 'unknown'}</p>
			</div>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Check for updates</h2>
			<p class="text-sm text-muted-foreground">
				Releases are published to GitHub. Compare the version above with the latest release — if it's newer,
				pull the new image and restart, or re-run your install steps.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-3 p-4">
			<a
				href="{repoUrl}/releases"
				target="_blank"
				rel="noopener noreferrer"
				class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
			>
				View releases
			</a>
			<code class="rounded bg-surface-hover px-2 py-1 text-xs text-muted-foreground">curl -s /version</code>
			<span class="text-sm text-muted-foreground">— same info from the command line, no login needed</span>
		</div>
	</section>
</div>
