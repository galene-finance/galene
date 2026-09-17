<script lang="ts">
	import { COLORS } from '$lib/types';

	let {
		value = $bindable(''),
		name = '',
		class: className = ''
	}: {
		value?: string;
		name?: string;
		class?: string;
	} = $props();
</script>

<div class="flex flex-wrap gap-1.5 {className}" role="radiogroup" aria-label="Color">
	<button
		type="button"
		class="size-6 rounded-full border-2 border-border bg-transparent"
		onclick={() => (value = '')}
		aria-label="No color"
	></button>
	{#each COLORS as color (color)}
		<button
			type="button"
			class="size-6 rounded-full {value === color ? 'ring-2 ring-ring ring-offset-2 ring-offset-surface' : ''}"
			style="background: {color}"
			onclick={() => (value = color)}
			aria-label={color}
		></button>
	{/each}
</div>
{#if name}
	<input type="hidden" {name} bind:value />
{/if}
