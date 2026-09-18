<script lang="ts">
	import BalancesWidget from './BalancesWidget.svelte';
	import BudgetsWidget from './BudgetsWidget.svelte';
	import MonthWidget from './MonthWidget.svelte';
	import NotificationsWidget from './NotificationsWidget.svelte';
	import RecentWidget from './RecentWidget.svelte';
	import TrendsWidget from './TrendsWidget.svelte';
	import UpcomingWidget from './UpcomingWidget.svelte';
	import DropdownMenu from '$lib/components/ui/DropdownMenu.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import { DASHBOARD_SIZE_PRESETS, WIDGET_CATALOG } from '$lib/dashboard';
	import type { DashboardWidget, DashboardWidgetData } from '$lib/types';

	let {
		widget,
		data,
		editMode,
		dragging,
		filtersActive,
		onDragStart,
		onDragEnd,
		onDragOverCard,
		onDropOnCard,
		onResizeStart,
		onMoveLeft,
		onMoveRight,
		onRemove,
		onFilters,
		onSizePreset
	}: {
		widget: DashboardWidget;
		data: DashboardWidgetData | undefined;
		editMode: boolean;
		dragging: boolean;
		filtersActive: boolean;
		onDragStart: (id: string) => void;
		onDragEnd: () => void;
		onDragOverCard: (id: string, before: boolean) => void;
		onDropOnCard: (targetId: string, draggedId: string, before: boolean) => void;
		onResizeStart: (widget: DashboardWidget, e: PointerEvent, cardEl: HTMLDivElement) => void;
		onMoveLeft: (id: string) => void;
		onMoveRight: (id: string) => void;
		onRemove: (id: string) => void;
		onFilters: (widget: DashboardWidget) => void;
		onSizePreset: (widget: DashboardWidget, preset: (typeof DASHBOARD_SIZE_PRESETS)[number]) => void;
	} = $props();

	let cardEl: HTMLDivElement | undefined;
	let sizeMenuOpen = $state(false);

	const entry = WIDGET_CATALOG[widget.type];

	function handleDragStart(e: DragEvent) {
		if (!editMode) return;
		if (e.dataTransfer) {
			e.dataTransfer.setData('text/plain', widget.id);
			e.dataTransfer.effectAllowed = 'move';
			if (cardEl) e.dataTransfer.setDragImage(cardEl, 16, 16);
		}
		onDragStart(widget.id);
	}

	function handleDragOver(e: DragEvent) {
		if (!editMode) return;
		e.preventDefault();
		const rect = cardEl?.getBoundingClientRect();
		const before = rect ? e.clientX < rect.left + rect.width / 2 : true;
		onDragOverCard(widget.id, before);
	}

	function handleDrop(e: DragEvent) {
		if (!editMode) return;
		e.preventDefault();
		// Stop the grid's own drop handler (move-to-end) from also firing.
		e.stopPropagation();
		// Read the dragged id and drop side from the event itself: in some
		// browsers dragend fires before drop, so the page's drag state may
		// already be cleared by the time this runs.
		const rect = cardEl?.getBoundingClientRect();
		const before = rect ? e.clientX < rect.left + rect.width / 2 : true;
		onDropOnCard(widget.id, e.dataTransfer?.getData('text/plain') ?? '', before);
	}
</script>

<div
	bind:this={cardEl}
	class="group relative flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border bg-surface {editMode
		? 'border-dashed'
		: ''} {dragging ? 'opacity-40' : ''}"
	style="grid-column: {widget.x + 1} / span {widget.w}; grid-row: {widget.y + 1} / span {widget.h}; --dh: {widget.h}"
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	<div class="flex min-w-0 items-center gap-1.5 border-b border-border px-3 py-2">
		{#if editMode}
			<div
				role="presentation"
				draggable={true}
				class="shrink-0 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
				ondragstart={handleDragStart}
				ondragend={() => onDragEnd()}
				title="Drag to reorder"
			>
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="9" cy="5" r="1" />
					<circle cx="9" cy="12" r="1" />
					<circle cx="9" cy="19" r="1" />
					<circle cx="15" cy="5" r="1" />
					<circle cx="15" cy="12" r="1" />
					<circle cx="15" cy="19" r="1" />
				</svg>
			</div>
		{/if}
		<h3 class="min-w-0 flex-1 truncate text-sm font-medium" title={entry.label}>{entry.label}</h3>
		<button
			type="button"
			class="relative shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			title="Filters"
			aria-label={`Filters for ${entry.label}`}
			onclick={() => onFilters(widget)}
		>
			<svg
				class="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
				<path d="M21 4H14M10 4H3M21 12H12M8 12H3M21 20H16M12 20H3M14 2V6M8 10V14M16 18V22" />
			</svg>
			{#if filtersActive}
				<span class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary"></span>
			{/if}
		</button>
		{#if editMode}
			<button
				type="button"
				class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				title="Move left"
				aria-label="Move left"
				onclick={() => onMoveLeft(widget.id)}
			>
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="m15 18-6-6 6-6" />
				</svg>
			</button>
			<button
				type="button"
				class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				title="Move right"
				aria-label="Move right"
				onclick={() => onMoveRight(widget.id)}
			>
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="m9 18 6-6-6-6" />
				</svg>
			</button>
			<DropdownMenu
				bind:open={sizeMenuOpen}
				ariaLabel="Change size"
				class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				{#snippet trigger()}
					<svg
						class="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
					</svg>
				{/snippet}
				{#each DASHBOARD_SIZE_PRESETS as preset (preset.id)}
					<MenuItem onclick={() => { sizeMenuOpen = false; onSizePreset(widget, preset); }}>
						{preset.label}
					</MenuItem>
				{/each}
			</DropdownMenu>
			<button
				type="button"
				class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
				title="Remove widget"
				aria-label="Remove widget"
				onclick={() => onRemove(widget.id)}
			>
				<svg
					class="size-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>

	<div class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
		{#if data === undefined}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if data.kind === 'balances'}
			<BalancesWidget {data} />
		{:else if data.kind === 'recent'}
			<RecentWidget {data} />
		{:else if data.kind === 'upcoming'}
			<UpcomingWidget {data} />
		{:else if data.kind === 'budgets'}
			<BudgetsWidget {data} />
		{:else if data.kind === 'month'}
			<MonthWidget {data} />
		{:else if data.kind === 'notifications'}
			<NotificationsWidget {data} />
		{:else}
			<TrendsWidget {data} />
		{/if}
	</div>

	{#if editMode}
		<div
			class="absolute bottom-0 right-0 flex size-5 cursor-se-resize items-end justify-end"
			onpointerdown={(e) => cardEl && onResizeStart(widget, e, cardEl)}
			role="presentation"
		>
			<svg
				class="size-3 text-muted-foreground"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
			>
				<path d="M21 21H8M21 21V10M21 21 14 14" />
			</svg>
		</div>
	{/if}
</div>
