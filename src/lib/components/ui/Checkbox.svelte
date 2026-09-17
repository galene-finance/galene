<script lang="ts">
	import { Checkbox as BitsCheckbox } from 'bits-ui';

	let {
		checked = $bindable(false),
		label,
		class: className = '',
		...rest
	}: {
		checked?: boolean;
		label?: string;
		class?: string;
		[key: string]: unknown;
	} = $props();
</script>

<BitsCheckbox.Root
	bind:checked
	{...rest}
	class="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border {checked
		? 'border-primary bg-primary'
		: 'border-input bg-surface hover:border-muted-foreground'} {className}"
>
	<svg
		class="size-3 text-primary-foreground"
		class:hidden={!checked}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="3"
	>
		<path d="M5 13l4 4L19 7" />
	</svg>
</BitsCheckbox.Root>
{#if label}
	<span class="text-sm">{label}</span>
{/if}
