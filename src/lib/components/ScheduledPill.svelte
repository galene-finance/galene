<script lang="ts">
	import { softFill } from '$lib/calendarMobile';
	import {
		daysLatePhrase,
		pillState,
		scheduledPillLabel,
		type CalendarOccurrence
	} from '$lib/scheduledPaid';
	import { formatMoney } from '$lib/utils';

	let {
		occurrence,
		today,
		variant,
		active = false,
		onclick,
		onpointerenter,
		onpointerleave,
		onfocus,
		onblur
	}: {
		occurrence: CalendarOccurrence;
		today: string;
		variant: 'grid' | 'agenda';
		active?: boolean;
		onclick: (e: MouseEvent) => void;
		onpointerenter?: (e: PointerEvent) => void;
		onpointerleave?: (e: PointerEvent) => void;
		onfocus?: (e: FocusEvent) => void;
		onblur?: () => void;
	} = $props();

	const state = $derived(pillState(occurrence, today));
	const amount = $derived(formatMoney(occurrence.scheduled.amount_cents));
	const label = $derived(
		scheduledPillLabel(occurrence.scheduled.name, amount, state, occurrence.daysLate, occurrence.matched)
	);
	const color = $derived(occurrence.scheduled.color);

	function itemBorder(): string {
		return color ?? 'color-mix(in oklab, var(--color-primary) 60%, transparent)';
	}
	function itemFill(): string {
		return softFill(color) ?? 'color-mix(in oklab, var(--color-primary) 10%, transparent)';
	}
	function chipBorder(): string {
		return color ?? 'color-mix(in oklab, var(--color-primary) 42%, transparent)';
	}
	function chipFill(): string {
		return softFill(color) ?? 'color-mix(in oklab, var(--color-primary) 12%, transparent)';
	}
</script>

{#snippet check()}
	<svg
		class="size-3 shrink-0 text-success"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="3"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M5 13l4 4L19 7" />
	</svg>
{/snippet}

{#snippet alert()}
	<svg
		class="size-3 shrink-0 text-destructive"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.4"
		stroke-linecap="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7.5v5.5M12 16.5v.01" />
	</svg>
{/snippet}

{#snippet repeat()}
	{#if occurrence.scheduled.repeat_interval}
		<svg
			class="size-3 shrink-0"
			style="color: {color ?? 'var(--color-primary)'}"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</svg>
	{/if}
{/snippet}

{#if variant === 'grid'}
	<button
		type="button"
		class="pointer-events-auto flex cursor-pointer select-none items-center gap-1 rounded border px-1.5 py-0.5 text-left text-xs [-webkit-touch-callout:none] {color
			? 'border-dashed'
			: 'border-dashed border-primary/60 bg-primary/10'}"
		style={color ? `border-color: ${color}; background: ${color}1a` : undefined}
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={active}
		{onclick}
		{onpointerenter}
		{onpointerleave}
		{onfocus}
		{onblur}
	>
		{#if state === 'paid'}
			{@render check()}
		{:else if state === 'overdue'}
			{@render alert()}
		{:else}
			{@render repeat()}
		{/if}
		<span class="truncate">{occurrence.scheduled.name}</span>
		<span class="ml-auto shrink-0 font-medium" style="color: {color ?? 'var(--color-primary)'}">
			{amount}
		</span>
	</button>
{:else}
	<button
		type="button"
		class="pointer-events-auto relative my-1.5 flex min-h-11 select-none items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2.5 pl-3.5 text-left [-webkit-touch-callout:none]"
		style="border-color: {itemBorder()}; background: {itemFill()}"
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={active}
		{onclick}
		{onpointerenter}
		{onpointerleave}
		{onfocus}
		{onblur}
	>
		<span
			class="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r"
			style="background: {color ?? 'var(--color-primary)'}"
			aria-hidden="true"
		></span>
		<div class="min-w-0 flex-1">
			<div class="truncate text-sm font-medium text-foreground">
				{occurrence.scheduled.name}
			</div>
			<div class="mt-1 flex flex-wrap gap-1">
				{#if occurrence.scheduled.category_name}
					<span
						class="inline-flex rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground"
						>{occurrence.scheduled.category_name}</span
					>
				{/if}
				{#if state === 'paid'}
					<span class="inline-flex items-center gap-1 text-[0.62rem] font-semibold text-foreground">
						{@render check()}
						Paid
					</span>
				{:else if state === 'overdue'}
					<span class="inline-flex items-center gap-1 text-[0.62rem] font-semibold text-foreground">
						{@render alert()}
						Overdue · {occurrence.daysLate}d
					</span>
				{:else if state === 'due'}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 text-[0.62rem] font-semibold text-foreground"
					>
						<svg
							class="size-3 shrink-0 text-primary"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							aria-hidden="true"
						>
							<circle cx="12" cy="12" r="9" />
							<path d="M12 7v5l3 2" />
						</svg>
						Due today
					</span>
				{:else}
					<span
						class="inline-flex rounded-full border border-dashed px-2 py-0.5 text-[0.62rem] font-semibold"
						style="border-color: {chipBorder()}; color: {color ?? 'var(--color-primary)'}; background: {chipFill()}"
						>Scheduled</span
					>
				{/if}
			</div>
		</div>
		<div class="shrink-0 text-sm font-medium tabular-nums" style="color: {color ?? 'var(--color-primary)'}">
			{amount}
		</div>
	</button>
{/if}
