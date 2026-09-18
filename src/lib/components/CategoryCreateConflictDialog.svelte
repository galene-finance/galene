<script lang="ts">
	import Button from './ui/Button.svelte';
	import Dialog from './ui/Dialog.svelte';
	import type { Category } from '$lib/types';

	let {
		open = $bindable(false),
		existing = null,
		requestedType = 'expense',
		onUseExisting,
		onCreateAnyway
	}: {
		open?: boolean;
		existing?: Category | null;
		requestedType?: 'expense' | 'income';
		onUseExisting?: (cat: Category) => void;
		onCreateAnyway?: () => void;
	} = $props();
</script>

<Dialog
	bind:open
	size="sm"
	title="Category already exists"
	description={existing
		? `“${existing.name}” is already an ${existing.type} category. Use it for this ${requestedType}, or create a separate ${requestedType} category with the same name.`
		: undefined}
>
	{#if existing}
		<div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
			<Button
				type="button"
				variant="secondary"
				onclick={() => {
					open = false;
				}}
			>
				Cancel
			</Button>
			<Button
				type="button"
				variant="secondary"
				onclick={() => {
					const cat = existing;
					open = false;
					if (cat) onCreateAnyway?.();
				}}
			>
				Create as {requestedType} anyway
			</Button>
			<Button
				type="button"
				onclick={() => {
					const cat = existing;
					open = false;
					if (cat) onUseExisting?.(cat);
				}}
			>
				Use existing ({existing.type})
			</Button>
		</div>
	{/if}
</Dialog>
