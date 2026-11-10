<script lang="ts">
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import { PICKER_DATE_WINDOW_DAYS, type ListedCandidate } from '$lib/scheduledMatch';
	import { formatMonthDay, type CalendarOccurrence, type OccurrenceMatch } from '$lib/scheduledPaid';
	import { formatMoney } from '$lib/utils';

	let {
		occurrence,
		reserveClose = false,
		onback,
		onmatchchange,
		onrevert
	}: {
		occurrence: CalendarOccurrence;
		reserveClose?: boolean;
		onback: () => void;
		onmatchchange?: (next: {
			paid: boolean;
			paidAt: string | null;
			matched: boolean;
			match: OccurrenceMatch | null;
		}) => void;
		onrevert?: () => void;
	} = $props();

	let query = $state('');
	let candidates = $state<ListedCandidate[]>([]);
	let selectedId = $state<number | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let matchError = $state<string | null>(null);
	let matching = $state(false);
	let searchEl = $state<HTMLInputElement | null>(null);
	let requestId = 0;

	const windowLabel = $derived(
		occurrence.scheduled.account_id != null
			? `Nearby · same account · ±${PICKER_DATE_WINDOW_DAYS} days`
			: `Nearby · ±${PICKER_DATE_WINDOW_DAYS} days`
	);
	const subtitle = $derived(
		`${occurrence.scheduled.name} · ${formatMonthDay(occurrence.date)} · ${formatMoney(occurrence.scheduled.amount_cents)}`
	);
	const selected = $derived(candidates.find((row) => row.id === selectedId) ?? null);

	async function load(q: string) {
		const ticket = ++requestId;
		loading = true;
		loadError = null;
		const body = new FormData();
		body.set('id', String(occurrence.scheduled.id));
		body.set('occurrence_date', occurrence.occurrenceDate);
		body.set('q', q);
		try {
			const res = await fetch('/calendar/candidates', { method: 'POST', body });
			const data = (await res.json()) as { candidates?: ListedCandidate[]; error?: string };
			if (ticket !== requestId) return;
			if (!res.ok || data.error) {
				candidates = [];
				loadError = data.error ?? 'Could not load transactions.';
				return;
			}
			candidates = data.candidates ?? [];
			if (!candidates.some((row) => row.id === selectedId)) selectedId = candidates[0]?.id ?? null;
		} catch {
			if (ticket !== requestId) return;
			candidates = [];
			loadError = 'Could not load transactions.';
		} finally {
			if (ticket === requestId) loading = false;
		}
	}

	$effect(() => {
		if (!browser) return;
		searchEl?.focus();
	});

	$effect(() => {
		if (!browser) return;
		const q = query;
		const handle = window.setTimeout(() => void load(q), q.trim() === '' ? 0 : 200);
		return () => window.clearTimeout(handle);
	});

	function provisional(row: ListedCandidate): OccurrenceMatch {
		return {
			transactionId: row.id,
			matchedAt: new Date().toISOString(),
			date: row.date,
			amountCents: row.amountCents,
			merchant: row.merchant,
			accountId: row.accountId,
			accountName: row.accountName
		};
	}
</script>

<div>
	<div class="flex items-start gap-2 px-3.5 pb-2 pt-3 {reserveClose ? 'pr-10' : ''}">
		<button
			type="button"
			class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Back"
			onclick={onback}
		>
			<svg
				class="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M15 6l-6 6 6 6" />
			</svg>
		</button>
		<div class="min-w-0 flex-1">
			<div class="text-[0.95rem] font-semibold tracking-tight">Match transaction</div>
			<div class="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
		</div>
	</div>
	<div class="px-3.5 pb-3">
		<label class="flex h-11 items-center gap-2 rounded-md border border-input bg-surface px-2.5 text-muted-foreground">
			<svg
				class="size-3.5 shrink-0"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				aria-hidden="true"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="M20 20l-3.5-3.5" />
			</svg>
			<input
				bind:this={searchEl}
				bind:value={query}
				class="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
				placeholder="Search merchant or amount"
				aria-label="Search transactions"
				autocomplete="off"
			/>
		</label>
		<div class="mb-1.5 mt-2.5 text-[0.66rem] font-bold uppercase tracking-wide text-muted-foreground">{windowLabel}</div>
		<div role="radiogroup" aria-label="Nearby transactions" aria-busy={loading}>
			{#if loading}
				<p class="py-3 text-xs text-muted-foreground" role="status">Loading transactions…</p>
			{:else if loadError}
				<p class="py-3 text-xs text-destructive" role="alert">{loadError}</p>
			{:else if candidates.length === 0}
				<p class="py-3 text-xs text-muted-foreground" role="status">No transactions in this window.</p>
			{:else}
				<div class="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
					{#each candidates as row, index (row.id)}
						<label
							class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 {row.id ===
							selectedId
								? 'border-primary/50 bg-primary/8'
								: 'border-border bg-surface'}"
						>
							<input
								type="radio"
								class="size-4 shrink-0 accent-primary"
								name="match-candidate-{occurrence.scheduled.id}-{occurrence.occurrenceDate}"
								value={row.id}
								checked={row.id === selectedId}
								onchange={() => (selectedId = row.id)}
							/>
							<span class="min-w-0 flex-1 text-[0.8125rem]">
								<span class="block truncate font-semibold">{row.merchant?.trim() || 'Transaction'}</span>
								<span class="text-[0.72rem] text-muted-foreground"
									>{row.accountName ?? 'No account'} · {formatMonthDay(row.date)}</span
								>
							</span>
							<span class="shrink-0 text-right text-[0.8125rem] font-semibold tabular-nums">
								{formatMoney(row.amountCents)}
								<span class="block text-[0.68rem] font-medium text-muted-foreground">{row.hint}</span>
							</span>
							<span class="sr-only">{index === 0 ? 'Closest match' : ''}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>
		{#if matchError}
			<p class="mt-2 text-xs text-destructive" role="alert">{matchError}</p>
		{/if}
	</div>
	<form
		method="POST"
		action="?/match-confirm"
		use:enhance={() => {
			matching = true;
			matchError = null;
			const row = selected;
			if (row) {
				onmatchchange?.({
					paid: true,
					paidAt: occurrence.paidAt,
					matched: true,
					match: provisional(row)
				});
			}
			return async ({ result, update }) => {
				matching = false;
				if (result.type === 'failure' || result.type === 'error') {
					matchError = result.type === 'failure' ? String(result.data?.error ?? 'Could not match.') : 'Could not match.';
					onrevert?.();
				}
				await update({ reset: false });
				if (result.type === 'success') onback();
			};
		}}
	>
		<input type="hidden" name="id" value={occurrence.scheduled.id} />
		<input type="hidden" name="occurrence_date" value={occurrence.occurrenceDate} />
		<input type="hidden" name="transaction_id" value={selected?.id ?? ''} />
		<div class="flex items-center justify-between gap-2 border-t border-border bg-muted/50 px-3.5 py-2">
			<span class="text-xs text-muted-foreground">Already-matched transactions are hidden.</span>
			<div class="flex shrink-0 gap-2">
				<Button type="button" variant="ghost" size="sm" class="max-md:min-h-11" onclick={onback}>Cancel</Button>
				<Button type="submit" size="sm" class="max-md:min-h-11" disabled={selected == null} pending={matching}>
					Match
				</Button>
			</div>
		</div>
	</form>
</div>
