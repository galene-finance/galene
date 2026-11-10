<script lang="ts">
	import { enhance } from '$app/forms';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import {
		daysLatePhrase,
		occurrenceSubtitle,
		paidHint,
		type CalendarOccurrence
	} from '$lib/scheduledPaid';
	import { formatMoney } from '$lib/utils';

	let {
		occurrence,
		bleed = false,
		showClose = false,
		onedit,
		onclose,
		onoptimistic,
		onrevert
	}: {
		occurrence: CalendarOccurrence;
		/** Cancel dialog body padding so the overdue strip is full-bleed. */
		bleed?: boolean;
		showClose?: boolean;
		onedit: () => void;
		onclose?: () => void;
		onoptimistic?: (paid: boolean, paidAt: string | null) => void;
		onrevert?: () => void;
	} = $props();

	let formEl = $state<HTMLFormElement | null>(null);
	let optimistic = $state<boolean | null>(null);
	let submitting = $state(false);
	const hintId = $props.id();

	const checked = $derived(optimistic ?? occurrence.paid);
	const paidAt = $derived(checked ? (occurrence.paidAt ?? new Date().toISOString()) : null);
	const hint = $derived(paidHint(checked, checked ? (occurrence.paidAt ?? paidAt) : null));
	const color = $derived(occurrence.scheduled.color ?? 'var(--color-primary)');
	const subtitle = $derived(
		occurrenceSubtitle(occurrence.date, occurrence.scheduled.repeat_interval, occurrence.scheduled.repeat_unit)
	);

	function onToggle(next: boolean) {
		optimistic = next;
		onoptimistic?.(next, next ? (occurrence.paidAt ?? new Date().toISOString()) : null);
		const input = formEl?.querySelector('input[name="paid"]') as HTMLInputElement | null;
		if (input) input.value = next ? 'on' : 'off';
		submitting = true;
		queueMicrotask(() => formEl?.requestSubmit());
	}
</script>

<div class={bleed ? '-mx-5 -my-4' : ''}>
	{#if occurrence.overdue && !checked}
		<div
			class="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3.5 py-2 text-xs font-semibold text-foreground"
		>
			<svg
				class="size-3.5 shrink-0 text-destructive"
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
			Overdue · {daysLatePhrase(occurrence.daysLate)}
		</div>
	{/if}
	<div class="flex items-start gap-2.5 px-3.5 pb-1 pt-3 {showClose ? '' : 'pr-10'}">
		<span class="mt-0.5 w-[3px] self-stretch rounded-sm" style="background: {color}" aria-hidden="true"></span>
		<div class="min-w-0 flex-1">
			<div class="truncate text-[0.95rem] font-semibold tracking-tight">{occurrence.scheduled.name}</div>
			<div class="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
		</div>
		<div class="shrink-0 text-[0.95rem] font-semibold tabular-nums">{formatMoney(occurrence.scheduled.amount_cents)}</div>
		{#if showClose}
			<button
				type="button"
				class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Close"
				onclick={onclose}
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
					<path d="M6 6l12 12M18 6L6 18" />
				</svg>
			</button>
		{/if}
	</div>
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3.5 pb-3 pl-6 text-xs">
		<div class="contents">
			<dt class="text-muted-foreground">Account</dt>
			<dd class="min-w-0 font-medium">{occurrence.scheduled.account_name ?? 'No account'}</dd>
		</div>
		<div class="contents">
			<dt class="text-muted-foreground">Category</dt>
			<dd class="min-w-0 font-medium">{occurrence.scheduled.category_name ?? 'No category'}</dd>
		</div>
	</dl>
	<form
		method="POST"
		action="?/set-paid"
		bind:this={formEl}
		use:enhance={() => {
			return async ({ result, update }) => {
				submitting = false;
				if (result.type === 'failure' || result.type === 'error') {
					optimistic = null;
					onrevert?.();
				}
				await update({ reset: false });
				if (result.type === 'success') optimistic = null;
			};
		}}
	>
		<input type="hidden" name="id" value={occurrence.scheduled.id} />
		<input type="hidden" name="occurrence_date" value={occurrence.occurrenceDate} />
		<input type="hidden" name="paid" value={checked ? 'on' : 'off'} />
		<div class="border-t border-border px-3.5 py-3">
			<label class="flex min-h-11 w-full cursor-pointer items-start gap-2.5 md:min-h-0">
				<Checkbox
					checked={checked}
					disabled={submitting}
					aria-label="Mark paid"
					aria-describedby={hintId}
					class="mt-0.5"
					onCheckedChange={(value: boolean) => onToggle(value)}
				/>
				<span class="min-w-0">
					<span class="block text-sm font-semibold">Mark paid</span>
					<span id={hintId} class="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
				</span>
			</label>
		</div>
	</form>
	<div class="flex items-center justify-end border-t border-border bg-muted/50 px-3.5 py-2">
		<button type="button" class="text-sm font-medium text-primary hover:underline" onclick={onedit}>
			Edit series
		</button>
	</div>
</div>
