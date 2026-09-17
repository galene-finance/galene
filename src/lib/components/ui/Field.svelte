<script lang="ts">
	import type { Snippet } from 'svelte';
	import Label from './Label.svelte';

	let {
		label,
		error,
		hint,
		class: className = '',
		children
	}: {
		label?: string;
		error?: string | null;
		hint?: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-1.5 {className}">
	{#if label}
		<Label>{label}</Label>
	{/if}
	{@render children()}
	{#if error}
		<span class="text-xs text-destructive">{error}</span>
	{:else if hint}
		<span class="text-xs text-muted-foreground">{hint}</span>
	{/if}
</div>
