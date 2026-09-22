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

	let rootEl = $state<HTMLDivElement | null>(null);

	// Bits marks the first outside pointerdown intercepted: its capture listener
	// sets the flag, and the bubble listener then skips close. Touch waits for
	// a later click, so the first tap on page content does nothing. Close on
	// the bubble ourselves. Ignore the trigger so its pointerdown can toggle.
	function closeIfOutside(e: PointerEvent) {
		if (!open) return;
		const target = e.target;
		if (!(target instanceof Node) || !rootEl) return;
		const triggerEl = rootEl.querySelector('[aria-haspopup="menu"]');
		if (triggerEl?.contains(target)) return;
		if (target instanceof Element && target.closest('[role="menu"]')) return;
		open = false;
	}
</script>

<svelte:document onpointerdown={closeIfOutside} />

<div bind:this={rootEl} class="contents">
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
</div>
