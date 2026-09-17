<script lang="ts">
	import { tick } from 'svelte';
	import { Combobox as BitsCombobox } from 'bits-ui';

	const CREATE_VALUE = '__create__';

	let {
		value = $bindable([] as string[]),
		search = $bindable(''),
		items = [] as { value: string; label: string }[],
		placeholder = '',
		name = '',
		allowCreate = false,
		createLabel = 'Create',
		class: className = '',
		// (value, label, typed): `label` is null for the create option; `typed` is
		// the text in the search box at the moment of selection. Callers creating a
		// new item must use `typed` (the combobox's own state) rather than their
		// bound `search` copy, which only updates on the next reactive flush and
		// can be stale/empty if selection lands in the same flush window as the
		// last keystroke.
		onselect = undefined as ((value: string, label: string | null, typed: string) => void) | undefined,
		/** Close the menu after each add/remove so the selection shows in the input (filters). */
		closeOnSelect = true
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
	// Seeds the input so preselected values are visible (e.g. edit dialogs,
	// active filters); bits-ui only initializes it once, and the dialog remounts on each open.
	const selectedLabels = $derived(
		value.map((v) => (v === CREATE_VALUE ? lastCreated : (items.find((i) => i.value === v)?.label ?? v))).join(', ')
	);

	let container: HTMLDivElement | undefined;
	let open = $state(false);
	function inputEl() {
		return container?.querySelector('input') as HTMLInputElement | null;
	}

	// While closed, the input shows the selected labels (restored after a
	// search, or after values change via navigation). While open it shows
	// the search text, cleared after each selection so the next item can
	// be typed (bits-ui otherwise leaves the picked label in the input and
	// typing would append to it).
	$effect(() => {
		if (open) return;
		const el = inputEl();
		if (el && el.value !== selectedLabels) el.value = selectedLabels;
	});

	let prevValue: string[] = value;

	$effect(() => {
		prevValue = value;
	});

	// Select the on-the-fly create option (see the single Combobox for why
	// bits-ui's own path can't reach it). Keeps a single pending create: the
	// server accepts one `tag_new` per submit, so a new create replaces any
	// previous one instead of accumulating (bits-ui's toggle would otherwise
	// remove the first pending create on a second one).
	function selectCreate() {
		const typed = search.trim();
		if (!typed) return;
		lastCreated = typed;
		onselect?.(CREATE_VALUE, null, typed);
		value = [...value.filter((v) => v !== CREATE_VALUE), CREATE_VALUE];
		prevValue = value;
		search = '';
		if (closeOnSelect) open = false;
		const labels = value
			.map((v) => (v === CREATE_VALUE ? lastCreated : (items.find((i) => i.value === v)?.label ?? v)))
			.join(', ');
		void tick().then(() => {
			const el = inputEl();
			if (!el) return;
			// Stay open (multi-add): clear for next type. Closed: show selection.
			el.value = open ? '' : labels;
		});
	}

	function handleValueChange(newValue: string[]) {
		const added = newValue.find((v) => !prevValue.includes(v));
		const removed = prevValue.find((v) => !newValue.includes(v));
		prevValue = newValue;
		const typed = search.trim();
		if (added === CREATE_VALUE) lastCreated = typed;
		if (added !== undefined) {
			onselect?.(
				added,
				added === CREATE_VALUE ? null : items.find((i) => i.value === added)?.label ?? null,
				typed
			);
		}
		// After any change: if the menu stays open, clear the input for the next
		// search; if we closed (filters), show the selected labels immediately.
		if (added !== undefined || removed !== undefined) {
			if (closeOnSelect) open = false;
			search = '';
			const labels = newValue
				.map((v) => (v === CREATE_VALUE ? lastCreated : (items.find((i) => i.value === v)?.label ?? v)))
				.join(', ');
			void tick().then(() => {
				const el = inputEl();
				if (!el) return;
				el.value = open ? '' : labels;
			});
		}
	}
</script>

<BitsCombobox.Root
	type="multiple"
	bind:value
	bind:open
	{name}
	inputValue={selectedLabels}
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
