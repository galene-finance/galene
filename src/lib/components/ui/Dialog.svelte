<script lang="ts">
	import { Dialog as BitsDialog } from 'bits-ui';
	import type { Snippet } from 'svelte';
	import { lockPageScroll, unlockPageScroll } from '$lib/dialogScrollLock';

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		busy = false,
		class: className = '',
		onOpenAutoFocus,
		onCloseAutoFocus,
		footer,
		children
	}: {
		open?: boolean;
		title?: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		/** When true, block escape / overlay / close while a save is in flight. */
		busy?: boolean;
		class?: string;
		onOpenAutoFocus?: (e: Event) => void;
		onCloseAutoFocus?: (e: Event) => void;
		/**
		 * Cancel / Save row rendered outside the scroll body. Submit buttons
		 * inside it use form="id" to submit the form in `children`.
		 */
		footer?: Snippet;
		children: Snippet;
	} = $props();

	const sizes = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };

	/**
	 * Desktop (sm+): centered with translate. Below 640px: a bottom sheet.
	 * Positioning is Tailwind utilities, not unlayered CSS — lightningcss
	 * drops `translate: none` from a hand-written rule, and the -translate-*
	 * utilities (layered) then keep the sheet shifted by half its size.
	 */
	const sheet =
		'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none';

	/**
	 * Height: 100vh is the large viewport on iOS (toolbar hidden), so a box
	 * capped with it and centered with translate overflows the visible area.
	 * 100dvh tracks the visible viewport; vh remains as a fallback.
	 *
	 * `footer` renders outside the scroll body (the footer element carries
	 * .dialog-actions). A .dialog-actions row left inside children sticks to
	 * the bottom of that body instead and stays in its form.
	 */
	// bits-ui keeps Content mounted after close (presence transition), so the
	// lock follows `open`, not mount. Nested dialogs each take a count.
	$effect(() => {
		if (!open) return;
		lockPageScroll();
		return () => unlockPageScroll();
	});
</script>

<BitsDialog.Root bind:open>
	<BitsDialog.Portal>
		<BitsDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<BitsDialog.Content
			class="dialog-content fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl {sizes[size]} {sheet} {className}"
			{onOpenAutoFocus}
			{onCloseAutoFocus}
			interactOutsideBehavior={busy ? 'ignore' : 'close'}
			escapeKeydownBehavior={busy ? 'ignore' : 'close'}
			aria-busy={busy ? 'true' : undefined}
		>
			<div class="dialog-header shrink-0 px-5 pb-0 pt-5">
				{#if title}
					<BitsDialog.Title class="pr-8 text-lg font-semibold">{title}</BitsDialog.Title>
				{/if}
				{#if description}
					<BitsDialog.Description class="mt-1 text-sm text-muted-foreground">{description}</BitsDialog.Description>
				{/if}
			</div>
			<div class="dialog-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
				{@render children()}
			</div>
			{#if footer}
				<div class="dialog-footer dialog-actions shrink-0">
					{@render footer()}
				</div>
			{/if}
			{#if !busy}
				<BitsDialog.Close
					class="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					aria-label="Close"
				>
					<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</BitsDialog.Close>
			{:else}
				<span
					class="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-40"
					aria-hidden="true"
				>
					<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</span>
			{/if}
		</BitsDialog.Content>
	</BitsDialog.Portal>
</BitsDialog.Root>
