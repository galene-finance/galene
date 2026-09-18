<script lang="ts">
	import WidgetCard from './WidgetCard.svelte';
	import { DASHBOARD_SIZE_PRESETS } from '$lib/dashboard';
	import type { DashboardWidget, DashboardWidgetData } from '$lib/types';

	let {
		widgets,
		data,
		editMode,
		draggingId,
		isFiltersActive,
		onDragStart,
		onDragEnd,
		onDragOverCard,
		onDropOnCard,
		onGridDrop,
		onGridDragOver,
		onResizeStart,
		onMoveLeft,
		onMoveRight,
		onRemove,
		onFilters,
		onSizePreset
	}: {
		widgets: DashboardWidget[];
		data: Record<string, DashboardWidgetData>;
		editMode: boolean;
		draggingId: string | null;
		isFiltersActive: (w: DashboardWidget) => boolean;
		onDragStart: (id: string) => void;
		onDragEnd: () => void;
		onDragOverCard: (id: string, before: boolean) => void;
		onDropOnCard: (targetId: string, draggedId: string, before: boolean) => void;
		onGridDrop: (draggedId: string) => void;
		onGridDragOver: () => void;
		onResizeStart: (widget: DashboardWidget, e: PointerEvent, cardEl: HTMLDivElement) => void;
		onMoveLeft: (id: string) => void;
		onMoveRight: (id: string) => void;
		onRemove: (id: string) => void;
		onFilters: (widget: DashboardWidget) => void;
		onSizePreset: (widget: DashboardWidget, preset: (typeof DASHBOARD_SIZE_PRESETS)[number]) => void;
	} = $props();

	let gridEl: HTMLDivElement | undefined;
</script>

<div
	bind:this={gridEl}
	class="db-grid {draggingId ? 'is-dragging' : ''}"
	ondragover={(e) => {
		if (!editMode || !draggingId) return;
		e.preventDefault();
		// The pointer is over the grid itself (a gap or empty cell), not a
		// card: preview the move-to-end that a drop there would commit.
		if (e.target === gridEl) onGridDragOver();
	}}
	ondrop={(e) => {
		e.preventDefault();
		if (!editMode) return;
		// Read the dragged id from the event, not drag state: in some
		// browsers dragend fires before drop, so the state may be cleared.
		const draggedId = e.dataTransfer?.getData('text/plain') ?? '';
		if (draggedId) onGridDrop(draggedId);
	}}
>
	{#each widgets as w (w.id)}
		<WidgetCard
			widget={w}
			data={data[w.id]}
			{editMode}
			dragging={draggingId === w.id}
			filtersActive={isFiltersActive(w)}
			{onDragStart}
			{onDragEnd}
			{onDragOverCard}
			{onDropOnCard}
			{onResizeStart}
			{onMoveLeft}
			{onMoveRight}
			{onRemove}
			{onFilters}
			{onSizePreset}
		/>
	{/each}
</div>

<style>
	.db-grid {
		display: grid;
		width: 100%;
		min-width: 0;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-auto-rows: 96px;
		gap: 16px;
	}
	/* Grid items default to min-width:auto and can force horizontal page overflow
		on narrow viewports when widget content is wide (ADO-21). */
	.db-grid > :global(*) {
		min-width: 0;
		max-width: 100%;
	}
	/* Animate slot changes only while a drag is in progress, so the live
		preview's shift is visible without making resize or commits lag. */
	.db-grid.is-dragging > :global(*) {
		transition: grid-column 150ms ease, grid-row 150ms ease;
	}
	/* Mobile: one column, each widget keeps its height in row units. The
		:global(*) is required because each child root carries its own
		component scoping hash, which a plain scoped selector can't match. */
	@media (max-width: 40rem) {
		.db-grid {
			grid-template-columns: 1fr;
		}
		.db-grid > :global(*) {
			grid-column: 1 / -1 !important;
			grid-row: auto / span var(--dh) !important;
		}
	}
</style>
