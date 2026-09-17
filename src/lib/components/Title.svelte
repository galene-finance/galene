<script lang="ts">
	import { page } from '$app/state';
	import type { Branding } from '$lib/types';

	let { title }: { title: string } = $props();

	// Brand name comes from the root layout's data (merged into every page's data).
	const brand = $derived((page.data as { branding?: Branding }).branding?.name ?? 'Galene');
</script>

<svelte:head>
	<title>{title} — {brand}</title>
</svelte:head>
