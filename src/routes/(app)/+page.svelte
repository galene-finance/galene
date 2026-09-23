<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import AddWidgetDialog from '$lib/components/dashboard/AddWidgetDialog.svelte';
	import DashboardGrid from '$lib/components/dashboard/DashboardGrid.svelte';
	import WidgetFiltersDialog from '$lib/components/dashboard/WidgetFiltersDialog.svelte';
	import {
		DASHBOARD_MAX_WIDGETS,
		DASHBOARD_SIZE_PRESETS,
		GRID_GAP,
		GRID_ROW,
		WIDGET_CATALOG,
		clampInt,
		compactLayout,
		genWidgetId,
		reorderLayout,
		type WidgetCatalogEntry
	} from '$lib/dashboard';
	import { toast } from '$lib/toasts';
	import type {
		Account,
		Category,
		DashboardFilters,
		DashboardWidget,
		DashboardWidgetData,
		DashboardWidgetType,
		Tag
	} from '$lib/types';

	let { data }: {
		data: {
			layout: DashboardWidget[];
			widgets: Record<string, DashboardWidgetData>;
			catalog: WidgetCatalogEntry[];
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
		};
	} = $props();

	let layout = $state<DashboardWidget[]>(untrack(() => data.layout));
	let editMode = $state(false);
	// A transient layout shown while a pointer-resize is in flight; null when idle.
	let preview = $state<DashboardWidget[] | null>(null);
	let shown = $derived(preview ?? layout);
	let atMax = $derived(layout.length >= DASHBOARD_MAX_WIDGETS);
	let draggingId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; before: boolean } | null>(null);
	let addOpen = $state(false);
	let filtersOpen = $state(false);
	let filtersWidget = $state<DashboardWidget | null>(null);
	let lastSaved = $state<DashboardWidget[]>(untrack(() => data.layout));

	// Adopt a new server layout (after a reload or another client saved) without
	// clobbering a newer local edit: only overwrite when there's no in-flight
	// preview and the content actually differs. After our own save the server
	// returns the same content, so this is a no-op and there's no visible jump.
	// Plain variable, not $state: the effect re-runs when the reactive `data`
	// prop changes, and the reference check must compare raw arrays (a $state
	// proxy would never be === to the raw prop value, looping the effect).
	let lastDataLayout: DashboardWidget[] | null = null;
	$effect(() => {
		const dl = data.layout;
		if (dl === lastDataLayout) return;
		lastDataLayout = dl;
		if (!preview && JSON.stringify(dl) !== JSON.stringify(layout)) {
			layout = dl;
			lastSaved = dl;
		}
	});

	// Optimistically apply a new layout, persist it, and reload for fresh data.
	// On failure, roll back to the last saved layout.
	function commit(next: DashboardWidget[]) {
		const prev = lastSaved;
		layout = next;
		preview = null;
		fetch('/dashboard', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ layout: next })
		})
			.then(async (r) => {
				const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
				if (r.status === 200 && body?.ok === true) {
					lastSaved = next;
					void invalidateAll();
				} else {
					layout = prev;
					toast("Couldn't save the layout — your changes were reverted.", 'error');
				}
			})
			.catch(() => {
				layout = prev;
				toast("Couldn't save the layout — your changes were reverted.", 'error');
			});
	}

	function moveWidget(draggedId: string, targetId: string | null, before: boolean) {
		// Always compute from the committed layout, never from a preview, so a
		// drop can't apply a move on top of an uncommitted drag preview.
		commit(reorderLayout(layout, draggedId, targetId, before));
	}

	function nudge(id: string, dir: -1 | 1) {
		const list = [...shown];
		const i = list.findIndex((w) => w.id === id);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		commit(compactLayout(list));
	}

	function remove(id: string) {
		commit(shown.filter((w) => w.id !== id));
	}

	function add(type: DashboardWidgetType) {
		const entry = WIDGET_CATALOG[type];
		const w: DashboardWidget = {
			id: genWidgetId(),
			type,
			x: 0,
			y: 0,
			w: entry.w,
			h: entry.h,
			// The server fills per-type defaults on save; empty here is fine.
			filters: {}
		};
		commit([...shown, w]);
	}

	function saveFilters(id: string, filters: DashboardFilters) {
		commit(shown.map((w) => (w.id === id ? { ...w, filters } : w)));
	}

	function onSizePreset(widget: DashboardWidget, preset: (typeof DASHBOARD_SIZE_PRESETS)[number]) {
		commit(shown.map((w) => (w.id === widget.id ? { ...w, w: preset.w, h: preset.h } : w)));
	}

	// Pointer-driven resize: geometry is derived from the card's own rect (a
	// component's bind:this doesn't expose its root element to the grid), so
	// the column width is back-solved from the card width and its span.
	function startResize(widget: DashboardWidget, e: PointerEvent, cardEl: HTMLDivElement) {
		e.preventDefault();
		const rect = cardEl.getBoundingClientRect();
		const colW = (rect.width - (widget.w - 1) * GRID_GAP) / widget.w;
		const pitchX = colW + GRID_GAP;
		const pitchY = GRID_ROW + GRID_GAP;
		const startX = e.clientX;
		const startY = e.clientY;
		const startW = widget.w;
		const startH = widget.h;
		let raf = 0;
		let pending: DashboardWidget[] | null = null;

		function onMove(ev: PointerEvent) {
			const w = clampInt(startW + Math.round((ev.clientX - startX) / pitchX), 1, 12);
			const h = clampInt(startH + Math.round((ev.clientY - startY) / pitchY), 1, 12);
			if (w === startW && h === startH) {
				if (!pending) return;
			}
			pending = compactLayout(shown.map((x) => (x.id === widget.id ? { ...x, w, h } : x)));
			if (!raf) {
				raf = requestAnimationFrame(() => {
					raf = 0;
					if (pending) preview = pending;
				});
			}
		}

		function onUp() {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			if (raf) cancelAnimationFrame(raf);
			if (pending && JSON.stringify(pending) !== JSON.stringify(layout)) commit(pending);
			else preview = null;
			pending = null;
		}

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function onDragStart(id: string) {
		draggingId = id;
	}

	function onDragEnd() {
		draggingId = null;
		dropTarget = null;
		// The live preview reorders the grid DOM under the pointer, which in
		// Chromium usually prevents a reliable `drop` event (or it fires with
		// an empty/wrong target). So the release itself must persist the last
		// previewed slot. If a drop already committed, commit() has nulled
		// `preview` and this is a no-op — no double save.
		if (preview && JSON.stringify(preview) !== JSON.stringify(layout)) commit(preview);
		else preview = null;
	}

	function onDragOverCard(id: string, before: boolean) {
		if (!draggingId || draggingId === id) return;
		if (dropTarget?.id === id && dropTarget.before === before) return;
		dropTarget = { id, before };
		// Live preview: show where the widget will land before the drop. Only
		// update when the compacted result actually changes, so the grid
		// doesn't thrash while the pointer sits on the same slot.
		const next = reorderLayout(layout, draggingId, id, before);
		if (JSON.stringify(next) !== JSON.stringify(shown)) preview = next;
	}

	// The pointer is over the grid itself (a gap or empty cell), not a card:
	// preview the same move-to-end that a drop there would commit.
	function onGridDragOver() {
		if (!draggingId) return;
		dropTarget = null;
		const next = reorderLayout(layout, draggingId, null, false);
		if (JSON.stringify(next) !== JSON.stringify(shown)) preview = next;
	}

	function onDropOnCard(targetId: string, draggedId: string, before: boolean) {
		dropTarget = null;
		draggingId = null;
		// The dragged id comes from the drop event, not drag state: in some
		// browsers dragend fires before drop, so the state may be cleared.
		if (draggedId && draggedId !== targetId && layout.some((w) => w.id === draggedId)) {
			moveWidget(draggedId, targetId, before);
		}
	}

	function onGridDrop(draggedId: string) {
		dropTarget = null;
		draggingId = null;
		if (draggedId && layout.some((w) => w.id === draggedId)) moveWidget(draggedId, null, false);
	}

	function filtersActive(w: DashboardWidget): boolean {
		const f = w.filters;
		switch (w.type) {
			case 'balances':
				return !!f.accountType || (f.accountIds?.length ?? 0) > 0;
			case 'recent':
				return (
					(f.accountIds?.length ?? 0) > 0 ||
					(f.categoryIds?.length ?? 0) > 0 ||
					(f.tagIds?.length ?? 0) > 0 ||
					f.limit !== 10
				);
			case 'upcoming':
				return (f.accountIds?.length ?? 0) > 0 || (f.categoryIds?.length ?? 0) > 0 || f.days !== 14;
			case 'budgets':
				return !!f.period || (f.categoryIds?.length ?? 0) > 0;
			case 'month':
				return (
					(f.accountIds?.length ?? 0) > 0 || (f.categoryIds?.length ?? 0) > 0 || (f.tagIds?.length ?? 0) > 0
				);
			case 'notifications':
				return (f.kinds?.length ?? 0) > 0 || !!f.unreadOnly;
			case 'trends':
				return (f.categoryIds?.length ?? 0) > 0 || f.months !== 6;
		}
	}
</script>

<Title title="Home" />

<div class="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Home</h1>
			<p class="text-sm text-muted-foreground">
				Your dashboard. Turn on edit mode to add, move, resize, or filter widgets.
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if editMode}
				<Button variant="secondary" onclick={() => (editMode = false)}>Done</Button>
				<Button disabled={atMax} onclick={() => (addOpen = true)}>+ Add widget</Button>
			{:else}
				<Button variant="secondary" onclick={() => (editMode = true)}>Edit layout</Button>
			{/if}
		</div>
	</div>

	{#if shown.length === 0}
		<div class="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted-foreground">Your home page is empty.</p>
			{#if editMode}
				<Button class="mt-4" onclick={() => (addOpen = true)}>+ Add widget</Button>
			{:else}
				<p class="mt-2 text-sm text-muted-foreground">
					Turn on <span class="font-medium">Edit layout</span> to add widgets.
				</p>
			{/if}
		</div>
	{:else}
		<DashboardGrid
			widgets={shown}
			data={data.widgets}
			{editMode}
			{draggingId}
			isFiltersActive={filtersActive}
			{onDragStart}
			{onDragEnd}
			{onDragOverCard}
			{onDropOnCard}
			{onGridDrop}
			{onGridDragOver}
			onResizeStart={startResize}
			onMoveLeft={(id) => nudge(id, -1)}
			onMoveRight={(id) => nudge(id, 1)}
			onRemove={remove}
			onFilters={(w) => {
				filtersWidget = w;
				filtersOpen = true;
			}}
			{onSizePreset}
		/>
	{/if}
</div>

{#if addOpen}
	<AddWidgetDialog bind:open={addOpen} onAdd={add} />
{/if}

{#if filtersOpen && filtersWidget}
	<WidgetFiltersDialog
		bind:open={filtersOpen}
		widget={filtersWidget}
		accounts={data.accounts}
		categories={data.categories}
		tags={data.tags}
		onSave={(filters) => {
			const id = filtersWidget!.id;
			filtersOpen = false;
			filtersWidget = null;
			saveFilters(id, filters);
		}}
	/>
{/if}
