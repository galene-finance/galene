<script lang="ts">
	import { Combobox as BitsCombobox } from 'bits-ui';

	const CREATE_VALUE = '__create__';

	let {
		value = $bindable(''),
		search = $bindable(''),
		items = [] as { value: string; label: string }[],
		placeholder = '',
		name = '',
		allowCreate = false,
		createLabel = 'Create',
		class: className = '',
		// (value, label, typed): `label` is null for the create option; `typed` is the
		// text in the search box at the moment of selection. Callers creating a new
		// item must use `typed` (the combobox's own state) rather than their bound
		// `search` copy, which only updates on the next reactive flush and can be
		// stale/empty if selection lands in the same flush window as the last keystroke.
		onselect = undefined as ((value: string, label: string | null, typed: string) => void) | undefined
	} = $props();

	const filtered = $derived(
		search.trim() === ''
			? items
			: items.filter((i) => i.label.toLowerCase().includes(search.trim().toLowerCase()))
	);
	const canCreate = $derived(
		allowCreate &&
			search.trim() !== '' &&
			!items.some((i) => i.label.toLowerCase() === search.trim().toLowerCase())
	);
	// The name of the last on-the-fly created value, kept so the closed input can
	// display it (the create sentinel has no entry in `items`).
	let lastCreated = $state('');
	// Seeds the input so a preselected value is visible (e.g. edit dialogs);
	// bits-ui only initializes it once, and the dialog remounts on each open.
	// An empty selection must render as the placeholder, never as a
	// zero-value item's label (e.g. "No category"), which would otherwise
	// appear as a real value the user can type into mid-string.
	const selectedLabel = $derived(
		value === '' ? '' : (value === CREATE_VALUE ? lastCreated : (items.find((i) => i.value === value)?.label ?? ''))
	);

	let container: HTMLDivElement | undefined;
	let open = $state(false);
	function inputEl() {
		return container?.querySelector('input') as HTMLInputElement | null;
	}

	// While closed, the input shows the selected label (restored after a
	// failed search, or after the value changes via navigation).
	$effect(() => {
		if (open) return;
		const el = inputEl();
		if (el && el.value !== selectedLabel) el.value = selectedLabel;
	});

	// Select the on-the-fly create option. bits-ui's own Enter/click path can't
	// reach it reliably: its highlighted node is resolved against the pre-flush DOM
	// on each keystroke (so it goes stale) and the create item is rendered last, so
	// Enter lands on a stale/first item instead. We drive the create selection
	// directly from the input's keydown and the create item's pointerup.
	function selectCreate() {
		const typed = search.trim();
		if (!typed) return;
		lastCreated = typed;
		onselect?.(CREATE_VALUE, null, typed);
		value = CREATE_VALUE;
		open = false;
		search = '';
	}

	function handleValueChange(newValue: string) {
		if (newValue !== '') {
			// `search` is still the typed text here; it is only cleared when the
			// dropdown closes (onOpenChange), which happens after onselect fires.
			if (newValue === CREATE_VALUE) lastCreated = search.trim();
			onselect?.(
				newValue,
				newValue === CREATE_VALUE ? null : items.find((i) => i.value === newValue)?.label ?? null,
				search.trim()
			);
		}
	}
</script>

<BitsCombobox.Root
	type="single"
	bind:value
	bind:open
	{name}
	inputValue={selectedLabel}
	onValueChange={handleValueChange}
	onOpenChange={(o) => {
		if (!o) search = '';
	}}
>
	<div class="relative" bind:this={container}>
		<BitsCombobox.Input
			placeholder={placeholder}
			oninput={(e) => (search = e.currentTarget.value)}
			onfocus={(e) => {
				e.currentTarget.select();
				open = true;
			}}
			onkeydown={(e) => {
				// Enter with the create option as the sole candidate: select it.
				// preventDefault stops bits-ui's handler, which would otherwise use
				// a stale highlighted node and select the wrong item or nothing.
				if (e.key === 'Enter' && !e.isComposing && open && canCreate && filtered.length === 0) {
					e.preventDefault();
					selectCreate();
				}
			}}
			class="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 {className}"
		/>
		<BitsCombobox.Trigger class="absolute end-2 top-1/2 -translate-y-1/2">
			<svg class="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="m6 9 6 6 6-6" />
			</svg>
		</BitsCombobox.Trigger>
	</div>
	<BitsCombobox.Portal>
		<BitsCombobox.Content
			class="z-50 max-h-72 w-[var(--bits-combobox-anchor-width)] overflow-auto rounded-md border border-border bg-surface p-1 shadow-md"
			sideOffset={4}
		>
			{#if filtered.length === 0 && !canCreate}
				<span class="block px-3 py-2 text-sm text-muted-foreground">No results</span>
			{:else}
				{#each filtered as item (item.value)}
					<BitsCombobox.Item
						{...item}
						class="data-[highlighted]:bg-muted flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm"
					>
						{item.label}
					</BitsCombobox.Item>
				{/each}
				{#if canCreate}
					<BitsCombobox.Item
						value={CREATE_VALUE}
						label={search.trim()}
						onpointerup={(e) => {
							e.preventDefault();
							selectCreate();
						}}
						class="data-[highlighted]:bg-muted flex cursor-pointer items-center rounded-sm px-3 py-2 text-sm text-primary"
					>
						+ {createLabel} “{search.trim()}”
					</BitsCombobox.Item>
				{/if}
			{/if}
		</BitsCombobox.Content>
	</BitsCombobox.Portal>
</BitsCombobox.Root>
