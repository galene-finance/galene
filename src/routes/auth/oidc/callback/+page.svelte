<script lang="ts">
	import Title from '$lib/components/Title.svelte';

	let { data }: {
		data: { phase: 'welcome' | 'error' | 'pending'; title: string; body: string; providerLabel: string };
	} = $props();

	const link =
		'inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
</script>

<Title title={data.title} />

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
	<div class="w-full max-w-sm">
		<div class="mb-6 flex flex-col items-center gap-2">
			<img
				src="/brand/galene-emblem.png"
				alt=""
				width="40"
				height="40"
				class="size-10 rounded-full object-cover"
				decoding="async"
			/>
		</div>
		<div class="rounded-lg border border-border bg-surface p-5 text-center">
			{#if data.phase === 'error'}
				<h1 class="text-lg font-semibold tracking-tight">{data.title}</h1>
				<p class="mt-2 text-sm text-muted-foreground">{data.body}</p>
				<div class="mt-5">
					<a href="/login" class="{link} border border-border bg-surface text-foreground hover:bg-muted">Back to sign in</a>
				</div>
			{:else if data.phase === 'welcome'}
				<h1 class="text-lg font-semibold tracking-tight">{data.title}</h1>
				<p class="mt-2 text-sm text-muted-foreground">{data.body}</p>
				<div class="mt-5">
					<a href="/" class="{link} bg-primary text-primary-foreground hover:opacity-90">Continue</a>
				</div>
			{:else}
				<h1 class="text-lg font-semibold tracking-tight">{data.title}</h1>
				<p class="mt-2 text-sm text-muted-foreground">{data.body}</p>
			{/if}
		</div>
	</div>
</div>
