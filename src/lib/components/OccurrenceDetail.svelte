<script lang="ts">
	import { enhance } from '$app/forms';
	import MatchTransactionPicker from '$lib/components/MatchTransactionPicker.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import { amountDeltaHint, transactionHref, type MatchSuggestionView } from '$lib/scheduledMatch';
	import {
		daysLatePhrase,
		formatMonthDay,
		occurrenceSubtitle,
		paidHint,
		type CalendarOccurrence,
		type OccurrenceMatch
	} from '$lib/scheduledPaid';
	import { formatMoney } from '$lib/utils';

	let {
		occurrence,
		suggestion = null,
		bleed = false,
		showClose = false,
		onedit,
		onclose,
		onoptimistic,
		onrevert,
		onmatchchange,
		ondismiss
	}: {
		occurrence: CalendarOccurrence;
		/** Best candidate. Null when there is none, it was dismissed, or this occurrence is matched. */
		suggestion?: MatchSuggestionView | null;
		/** Cancel dialog body padding so the overdue strip is full-bleed. */
		bleed?: boolean;
		showClose?: boolean;
		onedit: () => void;
		onclose?: () => void;
		onoptimistic?: (paid: boolean, paidAt: string | null) => void;
		onrevert?: () => void;
		onmatchchange?: (next: {
			paid: boolean;
			paidAt: string | null;
			matched: boolean;
			match: OccurrenceMatch | null;
		}) => void;
		/** Hide the current suggestion. Called only for Not this. */
		ondismiss?: () => void;
	} = $props();

	let formEl = $state<HTMLFormElement | null>(null);
	let optimistic = $state<boolean | null>(null);
	let submitting = $state(false);
	let picking = $state(false);
	let matchBusy = $state(false);
	let matchError = $state<string | null>(null);
	const hintId = $props.id();

	const checked = $derived(optimistic ?? occurrence.paid);
	const paidAt = $derived(checked ? (occurrence.paidAt ?? new Date().toISOString()) : null);
	const matched = $derived(occurrence.matched && occurrence.match != null);
	const hint = $derived(paidHint(checked, checked ? (occurrence.paidAt ?? paidAt) : null, matched));
	const color = $derived(occurrence.scheduled.color ?? 'var(--color-primary)');
	const subtitle = $derived(
		occurrenceSubtitle(occurrence.date, occurrence.scheduled.repeat_interval, occurrence.scheduled.repeat_unit)
	);

	function onToggle(next: boolean) {
		if (matched || submitting) return;
		optimistic = next;
		onoptimistic?.(next, next ? (occurrence.paidAt ?? new Date().toISOString()) : null);
		const input = formEl?.querySelector('input[name="paid"]') as HTMLInputElement | null;
		if (input) input.value = next ? 'on' : 'off';
		submitting = true;
		queueMicrotask(() => formEl?.requestSubmit());
	}

	function failureMessage(result: { type: string; data?: Record<string, unknown> }): string {
		if (result.type === 'failure') return String(result.data?.error ?? 'Could not update.');
		return 'Could not update.';
	}

	function suggestionMatch(row: MatchSuggestionView): OccurrenceMatch {
		return {
			transactionId: row.transactionId,
			matchedAt: new Date().toISOString(),
			date: row.date,
			amountCents: row.amountCents,
			merchant: row.merchant,
			accountId: row.accountId,
			accountName: row.accountName
		};
	}
</script>

<div class={bleed ? '-mx-5 -my-4' : ''}>
	{#if picking}
		<MatchTransactionPicker
			{occurrence}
			reserveClose={!showClose}
			onback={() => {
				picking = false;
				matchError = null;
			}}
			{onmatchchange}
			{onrevert}
		/>
	{:else}
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

		<div class="border-t border-border px-3.5 py-3">
			{#if matched && occurrence.match}
				<div class="text-[0.66rem] font-bold uppercase tracking-wide text-muted-foreground">Matched transaction</div>
				<a
					class="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 hover:bg-muted"
					href={transactionHref(occurrence.match)}
				>
					<span class="min-w-0 flex-1 text-[0.8125rem]">
						<span class="block truncate font-semibold">{occurrence.match.merchant?.trim() || 'Transaction'}</span>
						<span class="text-[0.72rem] text-muted-foreground">
							{occurrence.match.accountName ?? 'No account'} · {formatMonthDay(occurrence.match.date)}
						</span>
					</span>
					<span class="shrink-0 text-[0.8125rem] font-semibold tabular-nums">{formatMoney(occurrence.match.amountCents)}</span>
				</a>
				<form
					method="POST"
					action="?/match-unmatch"
					class="mt-2"
					use:enhance={() => {
						matchBusy = true;
						matchError = null;
						return async ({ result, update }) => {
							matchBusy = false;
							if (result.type === 'failure' || result.type === 'error') {
								matchError = failureMessage(result);
							} else {
								onmatchchange?.({
									paid: occurrence.paidAt != null,
									paidAt: occurrence.paidAt,
									matched: false,
									match: null
								});
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="id" value={occurrence.scheduled.id} />
					<input type="hidden" name="occurrence_date" value={occurrence.occurrenceDate} />
					<Button type="submit" variant="secondary" size="sm" class="max-md:min-h-11" pending={matchBusy}>Unmatch</Button>
				</form>
			{:else}
				{#if suggestion}
					<div class="text-[0.66rem] font-bold uppercase tracking-wide text-muted-foreground">Suggested match</div>
					<p class="mt-0.5 text-[0.72rem] text-muted-foreground">Not applied until you confirm.</p>
					<div class="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2">
						<span class="min-w-0 flex-1 text-[0.8125rem]">
							<span class="block truncate font-semibold">{suggestion.merchant?.trim() || 'Transaction'}</span>
							<span class="text-[0.72rem] text-muted-foreground">
								{suggestion.accountName ?? 'No account'} · {formatMonthDay(suggestion.date)}
							</span>
						</span>
						<span class="shrink-0 text-right text-[0.8125rem] font-semibold tabular-nums">
							{formatMoney(suggestion.amountCents)}
							<span class="block text-[0.68rem] font-medium text-muted-foreground">
								{amountDeltaHint(occurrence.scheduled.amount_cents, suggestion.amountCents)}
							</span>
						</span>
					</div>
					<div class="mt-2 flex flex-wrap gap-2">
						<form
							method="POST"
							action="?/match-confirm"
							use:enhance={() => {
								matchBusy = true;
								matchError = null;
								const row = suggestion;
								return async ({ result, update }) => {
									matchBusy = false;
									if (result.type === 'failure' || result.type === 'error') {
										matchError = failureMessage(result);
									} else if (row) {
										onmatchchange?.({
											paid: true,
											paidAt: occurrence.paidAt,
											matched: true,
											match: suggestionMatch(row)
										});
									}
									await update({ reset: false });
								};
							}}
						>
							<input type="hidden" name="id" value={occurrence.scheduled.id} />
							<input type="hidden" name="occurrence_date" value={occurrence.occurrenceDate} />
							<input type="hidden" name="transaction_id" value={suggestion.transactionId} />
							<Button type="submit" size="sm" class="max-md:min-h-11" pending={matchBusy}>Confirm</Button>
						</form>
						<form
							method="POST"
							action="?/match-dismiss"
							use:enhance={() => {
								matchBusy = true;
								matchError = null;
								return async ({ result, update }) => {
									matchBusy = false;
									if (result.type === 'failure' || result.type === 'error') {
										matchError = failureMessage(result);
									} else {
										ondismiss?.();
									}
									await update({ reset: false });
								};
							}}
						>
							<input type="hidden" name="id" value={occurrence.scheduled.id} />
							<input type="hidden" name="occurrence_date" value={occurrence.occurrenceDate} />
							<input type="hidden" name="transaction_id" value={suggestion.transactionId} />
							<Button type="submit" variant="secondary" size="sm" class="max-md:min-h-11" disabled={matchBusy}>
								Not this
							</Button>
						</form>
					</div>
				{/if}
				<Button
					type="button"
					variant="secondary"
					size="sm"
					class="max-md:min-h-11 {suggestion ? 'mt-2' : ''}"
					onclick={() => {
						matchError = null;
						picking = true;
					}}
				>
					Match transaction…
				</Button>
			{/if}
			{#if matchError}
				<p class="mt-2 text-xs text-destructive" role="alert">{matchError}</p>
			{/if}
		</div>

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
				<label
					class="flex min-h-11 w-full items-start gap-2.5 md:min-h-0 {matched
						? 'cursor-default'
						: 'cursor-pointer'}"
				>
					<Checkbox
						checked={checked}
						disabled={submitting || matched || matchBusy}
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
	{/if}
</div>
