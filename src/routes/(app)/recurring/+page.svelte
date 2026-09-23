<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import AddScheduledDialog from '$lib/components/AddScheduledDialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatMoney, formatDate } from '$lib/utils';
	import { toastFormResult } from '$lib/toasts';
	import type { Account, Category, RecurringSuggestion, RepeatUnit, Tag } from '$lib/types';

	let {
		form,
		data
	}: {
		form: { error?: string | null; ok?: boolean; message?: string } | undefined;
		data: {
			suggestions: RecurringSuggestion[];
			accounts: Account[];
			categories: Category[];
			tags: Tag[];
		};
	} = $props();

	let dialogOpen = $state(false);
	let dismissKey = $state('');
	let prefill = $state<{
		name?: string;
		amount_cents?: number;
		start_date?: string;
		account_id?: number | null;
		category_id?: number | null;
		repeat_interval?: number | null;
		repeat_unit?: RepeatUnit | null;
		forecast_behavior?: 'bill' | 'spread';
		notes?: string | null;
	} | null>(null);

	const extraHidden = $derived<Record<string, string>>(dismissKey ? { dismiss_key: dismissKey } : {});

	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
		if (form?.ok) {
			dialogOpen = false;
			prefill = null;
			dismissKey = '';
			invalidateAll();
		}
	});

	function cadenceLabel(s: RecurringSuggestion) {
		if (s.repeatInterval === 1) {
			if (s.repeatUnit === 'week') return 'weekly';
			if (s.repeatUnit === 'month') return 'monthly';
			if (s.repeatUnit === 'year') return 'yearly';
			return 'daily';
		}
		if (s.repeatUnit === 'week' && s.repeatInterval === 2) return 'every 2 weeks';
		return `every ${s.repeatInterval} ${s.repeatUnit}s`;
	}

	function accept(s: RecurringSuggestion) {
		dismissKey = s.key;
		prefill = {
			name: s.merchant,
			amount_cents: s.medianAmountCents,
			start_date: s.nextDate,
			account_id: s.accountId,
			category_id: s.categoryId,
			repeat_interval: s.repeatInterval,
			repeat_unit: s.repeatUnit,
			forecast_behavior: 'bill',
			notes: `Suggested from ${s.hitCount} past charges (last ${s.lastDate}).`
		};
		dialogOpen = true;
	}
</script>

<Title title="Recurring" />

<div class="mx-auto flex max-w-3xl flex-col gap-6 2xl:max-w-5xl">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Recurring</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Likely bills and subscriptions from your expense history. Nothing is added until you confirm —
			Accept opens a normal scheduled expectation as a bill.
		</p>
	</div>

	{#if form?.error}
		<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
	{/if}

	{#if data.suggestions.length === 0}
		<div class="rounded-lg border border-border bg-surface p-6 text-sm text-muted-foreground">
			No suggestions right now. Need at least three similar expense charges (non-transfer) over the
			last year with a recognizable merchant, and they must not already match a scheduled expectation.
		</div>
	{:else}
		<ul class="flex flex-col gap-3">
			{#each data.suggestions as s (s.key)}
				<li class="rounded-lg border border-border bg-surface p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="font-medium">{s.merchant}</p>
							<p class="mt-0.5 text-sm text-muted-foreground">
								{formatMoney(-s.medianAmountCents)} · {cadenceLabel(s)} · {s.hitCount} hits · confidence
								{Math.round(s.confidence * 100)}%
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								Next {formatDate(s.nextDate)}
								{#if s.accountName}
									· {s.accountName}
								{/if}
								{#if s.categoryName}
									· {s.categoryName}
								{/if}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								Recent: {s.sampleDates.map((d) => formatDate(d)).join(', ')}
							</p>
						</div>
						<div class="flex shrink-0 flex-wrap gap-2">
							<Button type="button" onclick={() => accept(s)}>Accept</Button>
							<form method="POST" action="?/dismiss" use:enhance>
								<input type="hidden" name="key" value={s.key} />
								<Button type="submit" variant="secondary">Dismiss</Button>
							</form>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<AddScheduledDialog
	bind:open={dialogOpen}
	{prefill}
	{extraHidden}
	accounts={data.accounts}
	categories={data.categories}
	tags={data.tags}
	{form}
	action="?/save-scheduled"
	onclose={() => {
		prefill = null;
		dismissKey = '';
	}}
/>
