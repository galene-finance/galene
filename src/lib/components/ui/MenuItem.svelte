<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		variant = 'default',
		class: className = '',
		children,
		...rest
	}: {
		variant?: 'default' | 'destructive';
		class?: string;
		children: Snippet;
	} & Record<string, unknown> = $props();
</script>

<DropdownMenu.Item
	{...rest}
	class="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm data-[highlighted]:bg-muted {variant === 'destructive' ? 'text-destructive' : ''} {className}"
>
	{@render children()}
</DropdownMenu.Item>
