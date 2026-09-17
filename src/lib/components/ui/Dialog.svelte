<script lang="ts">
	import { Dialog as BitsDialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		class: className = '',
		onOpenAutoFocus,
		children
	}: {
		open?: boolean;
		title?: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		onOpenAutoFocus?: (e: Event) => void;
		children: Snippet;
	} = $props();

	const sizes = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };
</script>

<BitsDialog.Root bind:open>
	<BitsDialog.Portal>
		<BitsDialog.Overlay class="fixed inset-0 z-50 bg-black/60" />
		<BitsDialog.Content
			class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-xl {sizes[size]} {className}"
			{onOpenAutoFocus}
		>
			{#if title}
				<BitsDialog.Title class="pr-8 text-lg font-semibold">{title}</BitsDialog.Title>
			{/if}
			{#if description}
				<BitsDialog.Description class="mt-1 text-sm text-muted-foreground">{description}</BitsDialog.Description>
			{/if}
			<div class="mt-4">
				{@render children()}
			</div>
			<BitsDialog.Close
				class="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</BitsDialog.Close>
		</BitsDialog.Content>
	</BitsDialog.Portal>
</BitsDialog.Root>
