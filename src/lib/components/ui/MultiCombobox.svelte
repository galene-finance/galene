<script lang="ts">
	import { tick } from 'svelte';
	import { Combobox as BitsCombobox } from 'bits-ui';
	import {
		CREATE_VALUE,
		availableItems,
		removeLastPill,
		removeValue,
		selectedPills,
		shouldRemoveLastOnBackspace
	} from '$lib/multiCombobox';

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
		/** Close the menu after each add so the next type starts from an empty search. */
		closeOnSelect = true
	} = $props();

	const filtered = $derived(availableItems(items, value, search));
	const canCreate = $derived(
		allowCreate &&
			search.trim() !== '' &&
			!items.some((i) => i.label.toLowerCase() === search.trim().toLowerCase())
	);
	let lastCreated = $state('');
	const pills = $derived(selectedPills(value, items, lastCreated));

	let container: HTMLDivElement | undefined;
	let fieldWidth = $state(0);
	let open = $state(false);
	function inputEl() {
		return container?.querySelector('input') as HTMLInputElement | null;
	}

	function measureField() {
		fieldWidth = container?.offsetWidth ?? 0;
	}

	$effect(() => {
		value;
		pills;
		measureField();
	});

	function clearSearchInput() {
		search = '';
		void tick().then(() => {
			const el = inputEl();
			if (el) el.value = '';
		});
	}

	function selectCreate() {
		const typed = search.trim();
		if (!typed) return;
		lastCreated = typed;
		onselect?.(CREATE_VALUE, null, typed);
		value = [...value.filter((v) => v !== CREATE_VALUE), CREATE_VALUE];
		prevValue = value;
		if (closeOnSelect) open = false;
		clearSearchInput();
	}

	let prevValue: string[] = value;

	$effect(() => {
		prevValue = value;
	});

	function handleValueChange(newValue: string[]) {
		const added = newValue.find((v) => !prevValue.includes(v));
		prevValue = newValue;
		const typed = search.trim();
		if (added === CREATE_VALUE) lastCreated = typed;
		if (added !== undefined) {
			onselect?.(
				added,
				added === CREATE_VALUE ? null : items.find((i) => i.value === added)?.label ?? null,
				typed
			);
			if (closeOnSelect) open = false;
			clearSearchInput();
		}
	}

	function removePill(target: string) {
		value = removeValue(value, target);
		prevValue = value;
		if (target === CREATE_VALUE) lastCreated = '';
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.isComposing && open && canCreate && filtered.length === 0) {
			e.preventDefault();
			selectCreate();
			return;
		}
		if (e.key !== 'Backspace' || e.isComposing) return;
		const el = e.currentTarget as HTMLInputElement;
		if (!shouldRemoveLastOnBackspace(el.value, value)) return;
		e.preventDefault();
		const next = removeLastPill(value);
		if (value.at(-1) === CREATE_VALUE) lastCreated = '';
		value = next;
		prevValue = next;
	}
</script>

<BitsCombobox.Root
	type="multiple"
	bind:value
	bind:open
	{name}
	onValueChange={handleValueChange}
	onOpenChange={(o) => {
		if (o) {
			measureField();
			return;
		}
		search = '';
		const el = inputEl();
		if (el) el.value = '';
	}}
>
	<div
		class="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-surface px-2 py-1 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 {className}"
		bind:this={container}
		onclick={(e) => {
			if ((e.target as HTMLElement).closest('button')) return;
			inputEl()?.focus();
			open = true;
		}}
	>
		{#each pills as pill (pill.value)}
			<span
				class="inline-flex max-w-full items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
			>
				<span class="truncate">{pill.label}</span>
				<button
					type="button"
					class="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
					aria-label="Remove {pill.label}"
					onclick={(e) => {
						e.stopPropagation();
						removePill(pill.value);
					}}
				>
					<svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</span>
		{/each}
		<BitsCombobox.Input
			placeholder={pills.length === 0 ? placeholder : ''}
			oninput={(e) => (search = e.currentTarget.value)}
			onfocus={() => {
				open = true;
			}}
			onkeydown={onInputKeydown}
			class="min-w-16 flex-1 border-0 bg-transparent px-0.5 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
		/>
		<BitsCombobox.Trigger class="ms-auto shrink-0">
			<svg class="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="m6 9 6 6 6-6" />
			</svg>
		</BitsCombobox.Trigger>
	</div>
	<BitsCombobox.Portal>
		<BitsCombobox.Content
			class="z-50 max-h-72 min-w-0 overflow-auto rounded-md border border-border bg-surface p-1 shadow-md"
			style="width: {fieldWidth}px"
			customAnchor={container ?? null}
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
						<span class="truncate">{item.label}</span>
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
