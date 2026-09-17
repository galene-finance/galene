<script lang="ts">
	import { DropdownMenu as BitsMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		class: className = '',
		ariaLabel,
		trigger,
		children
	}: {
		open?: boolean;
		class?: string;
		ariaLabel?: string;
		trigger: Snippet;
		children: Snippet;
	} = $props();
</script>

<BitsMenu.Root bind:open>
	<BitsMenu.Trigger class={className} aria-label={ariaLabel}>
		{@render trigger()}
	</BitsMenu.Trigger>
	<BitsMenu.Portal>
		<BitsMenu.Content class="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-md" sideOffset={4}>
			{@render children()}
		</BitsMenu.Content>
	</BitsMenu.Portal>
</BitsMenu.Root>
