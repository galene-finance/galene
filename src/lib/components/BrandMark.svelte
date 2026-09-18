<script lang="ts">
	import { EMBLEM_SRC, iconPaths, isEmblemIcon } from '$lib/icons';

	let {
		icon,
		class: className = 'size-7',
		rounded = true
	}: {
		icon: string;
		class?: string;
		/** Emblem PNG uses rounded-full by default; stroke mark uses rounded-md. */
		rounded?: boolean;
	} = $props();

	const emblem = $derived(isEmblemIcon(icon));
</script>

{#if emblem}
	<img
		src={EMBLEM_SRC}
		alt=""
		width="28"
		height="28"
		class="shrink-0 object-cover {rounded ? 'rounded-full' : ''} {className}"
		decoding="async"
	/>
{:else}
	<span
		class="flex shrink-0 items-center justify-center bg-primary text-primary-foreground {rounded
			? 'rounded-md'
			: ''} {className}"
	>
		<svg
			class="size-[57%]"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{@html iconPaths(icon)}
		</svg>
	</span>
{/if}
