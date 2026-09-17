<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { WIDGET_CATALOG_LIST } from '$lib/dashboard';
	import type { DashboardWidgetType } from '$lib/types';

	let {
		open = $bindable(false),
		onAdd
	}: {
		open?: boolean;
		onAdd: (type: DashboardWidgetType) => void;
	} = $props();
</script>

<Dialog bind:open title="Add a widget" description="Pick what to show on your home page.">
	<div class="flex flex-col gap-1.5">
		{#each WIDGET_CATALOG_LIST as entry (entry.type)}
			<button
				type="button"
				class="w-full rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted"
				onclick={() => {
					onAdd(entry.type);
					open = false;
				}}
			>
				<span class="block text-sm font-medium">{entry.label}</span>
				<span class="mt-0.5 block text-xs text-muted-foreground">{entry.description}</span>
			</button>
		{/each}
	</div>
</Dialog>
