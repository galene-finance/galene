<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		pending = false,
		disabled = false,
		class: className = '',
		children,
		...rest
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
		size?: 'sm' | 'md';
		type?: 'button' | 'submit';
		/** Show a spinner and force-disable while a save/POST is in flight. */
		pending?: boolean;
		disabled?: boolean;
		class?: string;
		children: Snippet;
	} & Record<string, unknown> = $props();

	const variants = {
		primary: 'bg-primary text-primary-foreground hover:opacity-90',
		secondary: 'border border-border bg-surface text-foreground hover:bg-muted',
		ghost: 'text-foreground hover:bg-muted',
		destructive: 'bg-destructive text-destructive-foreground hover:opacity-90'
	};

	const isDisabled = $derived(pending || disabled);
</script>

<button
	{...rest}
	{type}
	disabled={isDisabled}
	aria-busy={pending ? 'true' : undefined}
	class="inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 {size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm'} {variants[variant]} {className}"
>
	{#if pending}
		<svg
			class="size-4 shrink-0 animate-spin"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path d="M12 3a9 9 0 1 1-9 9" stroke-linecap="round" />
		</svg>
	{/if}
	{@render children()}
</button>
