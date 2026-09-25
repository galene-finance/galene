<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { themeHeadScript } from '$lib/themes';
	import type { Branding } from '$lib/types';

	let {
		data,
		children
	}: {
		data: {
			branding: Branding;
			theme: { value: string; slug: string; css: string; base: string } | null;
		};
		children: Snippet;
	} = $props();

	// The server knows this user's theme; it wins over the localStorage
	// copy applied by app.html. Emitted as a string (a literal <script>
	// inside <svelte:head> is raw text — its {} are never compiled) and
	// runs in <head>, inlining the theme CSS before first paint.
	const headScript = $derived(data.theme ? themeHeadScript(data.theme) : '');
</script>

<svelte:head>
	{#if data.theme}
		{@html headScript}
	{/if}
</svelte:head>

{@render children()}
