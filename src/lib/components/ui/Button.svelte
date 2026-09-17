<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		class: className = '',
		children,
		...rest
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
		size?: 'sm' | 'md';
		type?: 'button' | 'submit';
		class?: string;
		children: Snippet;
	} & Record<string, unknown> = $props();

	const variants = {
		primary: 'bg-primary text-primary-foreground hover:opacity-90',
		secondary: 'border border-border bg-surface text-foreground hover:bg-muted',
		ghost: 'text-foreground hover:bg-muted',
		destructive: 'bg-destructive text-destructive-foreground hover:opacity-90'
	};
</script>

<button
	{...rest}
	{type}
	class="inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 {size === 'sm' ? 'h-8 px-3 text-xs' : 'h-9 px-4 text-sm'} {variants[variant]} {className}"
>
	{@render children()}
</button>
