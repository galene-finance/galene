<script lang="ts">
	import { Select as BitsSelect } from 'bits-ui';

	let {
		value = $bindable(''),
		items = [] as { value: string; label: string }[],
		placeholder = '',
		name = '',
		onValueChange = undefined as ((value: string) => void) | undefined,
		class: className = ''
	} = $props();
</script>

<BitsSelect.Root type="single" bind:value {name} {onValueChange} {items}>
	<BitsSelect.Trigger
		class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm {className}"
	>
		<BitsSelect.Value placeholder={placeholder} />
		<svg class="size-4 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="m6 9 6 6 6-6" />
		</svg>
	</BitsSelect.Trigger>
	<BitsSelect.Portal>
		<BitsSelect.Content class="z-50 min-w-[var(--bits-select-anchor-width)] rounded-md border border-border bg-surface p-1 shadow-md" sideOffset={4}>
			<BitsSelect.Viewport class="max-h-64 overflow-auto p-1">
				{#each items as item (item.value)}
					<BitsSelect.Item
						{...item}
						class="data-[highlighted]:bg-muted flex cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-sm outline-none"
					>
						{item.label}
					</BitsSelect.Item>
				{/each}
			</BitsSelect.Viewport>
		</BitsSelect.Content>
	</BitsSelect.Portal>
</BitsSelect.Root>
