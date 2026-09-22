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
		<!-- preventScroll would set overflow:hidden on body. That resets window
		     scroll under the sticky header, so a fixed menu opened after scroll
		     lands above the viewport and the page stays locked. -->
		<BitsMenu.Content
			class="z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-md"
			sideOffset={4}
			preventScroll={false}
		>
			{@render children()}
		</BitsMenu.Content>
	</BitsMenu.Portal>
</BitsMenu.Root>
