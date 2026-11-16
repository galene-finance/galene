<script lang="ts">
	import { flushSync } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { buildReconcileView, type MissingLine, type ReconcileRow } from '$lib/reconcileMath';
	import { centsToDollars, formatMoney, parseAmountToCents } from '$lib/utils';

	let { form, data } = $props();
	watchFormToast(() => form ?? undefined);

	const readonly = $derived(!!data.viewer);

	let through = $state('');
	let bankText = $state('');
	let showAll = $state(false);
	let showEarlier = $state(false);
	let readyFor = $state<number | null>(null);
	let stagedAddIds = $state<number[]>([]);
	let stagedDeleteIds = $state<number[]>([]);
	let stagedDismissPairs = $state<{ manualId: number; syncedId: number }[]>([]);
	let adjustment = $state<{ cents: number; date: string; note: string } | null>(null);

	let tickId = $state('');
	let tickCleared = $state('1');
	let tickForm = $state<HTMLFormElement | null>(null);
	let tickAllForm = $state<HTMLFormElement | null>(null);
	let unlockId = $state('');
	let unlockForm = $state<HTMLFormElement | null>(null);
	let finishForm = $state<HTMLFormElement | null>(null);
	let planJson = $state('');

	let adjustOpen = $state(false);
	let adjustAmount = $state('');
	let adjustDate = $state('');
	let adjustNote = $state('');
	let duplicate = $state<ReconcileRow | null>(null);
	let duplicateSynced = $state<ReconcileRow | null>(null);
	let missingLine = $state<MissingLine | null>(null);
	let finishOpen = $state(false);
	let unlockRow = $state<ReconcileRow | null>(null);

	$effect(() => {
		if (readyFor === data.account.id) return;
		readyFor = data.account.id;
		through = data.defaultThrough;
		bankText =
			data.account.provider_balance_cents != null ? centsToDollars(data.account.provider_balance_cents) : '';
		stagedAddIds = [];
		stagedDeleteIds = [];
		stagedDismissPairs = [];
		adjustment = null;
		showAll = false;
		showEarlier = false;
	});

	const view = $derived(
		buildReconcileView({
			openingCents: data.account.opening_balance_cents ?? 0,
			openingAsOf: data.account.opening_as_of,
			through,
			bankCents: parseAmountToCents(bankText),
			rows: data.rows,
			missing: data.missing,
			dismissedPairs: data.dismissedPairs,
			lastStatementDate: data.lastStatementDate,
			showAll,
			stagedAddIds,
			stagedDeleteIds,
			stagedAdjustmentCents: adjustment?.cents ?? null,
			stagedAdjustmentDate: adjustment?.date ?? null
		})
	);

	function shortDate(iso: string): string {
		const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
		if (!y || !m || !d) return iso;
		return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	function bankHelp(): string {
		if (data.account.provider && data.account.provider_balance_cents != null) {
			const asOf = data.account.provider_balance_as_of;
			const when = asOf ? shortDate(asOf.slice(0, 10)) : 'the last sync';
			return `From sync, ${when}. Edit to use a paper statement.`;
		}
		return 'Type the balance from your paper statement.';
	}

	function toggle(row: ReconcileRow, next: boolean) {
		if (readonly) return;
		if (row.reconciledAt) {
			unlockRow = row;
			return;
		}
		flushSync(() => {
			tickId = String(row.id);
			tickCleared = next ? '1' : '0';
		});
		tickForm?.requestSubmit();
	}

	function tickAll() {
		if (readonly) return;
		tickAllForm?.requestSubmit();
	}

	function openAdjust() {
		adjustAmount = centsToDollars(view.previewLeftCents ?? 0);
		adjustDate = through;
		adjustNote = through ? `Reconcile ${shortDate(through)}` : 'Reconcile';
		adjustOpen = true;
	}

	function stageAdjust() {
		const cents = parseAmountToCents(adjustAmount);
		if (cents == null || !adjustDate) return;
		adjustment = { cents, date: adjustDate, note: adjustNote };
		adjustOpen = false;
	}

	function stageMissing(line: MissingLine) {
		if (!stagedAddIds.includes(line.id)) stagedAddIds = [...stagedAddIds, line.id];
		missingLine = null;
	}

	function stageDelete(row: ReconcileRow) {
		if (!stagedDeleteIds.includes(row.id)) stagedDeleteIds = [...stagedDeleteIds, row.id];
		duplicate = null;
		duplicateSynced = null;
	}

	function isStagedKeep(manualId: number, syncedId: number): boolean {
		return stagedDismissPairs.some((pair) => pair.manualId === manualId && pair.syncedId === syncedId);
	}

	function keepBoth(manualId: number, syncedId: number) {
		if (!isStagedKeep(manualId, syncedId)) {
			stagedDismissPairs = [...stagedDismissPairs, { manualId, syncedId }];
		}
		duplicate = null;
		duplicateSynced = null;
	}

	function unstageKeep(manualId: number, syncedId: number) {
		stagedDismissPairs = stagedDismissPairs.filter(
			(pair) => pair.manualId !== manualId || pair.syncedId !== syncedId
		);
	}

	function submitUnlock() {
		if (!unlockRow) return;
		flushSync(() => {
			unlockId = String(unlockRow!.id);
		});
		unlockForm?.requestSubmit();
		unlockRow = null;
	}

	const reviewItems = $derived.by(() => {
		const items: { title: string; detail: string }[] = [];
		for (const line of view.missingShown) {
			if (!stagedAddIds.includes(line.id)) continue;
			items.push({
				title: `Add ${line.merchant ?? 'bank line'} ${formatMoney(line.amountCents)}`,
				detail: `${shortDate(line.date)} · the bank has this and Galene does not`
			});
		}
		if (adjustment) {
			items.push({
				title: `Add balance adjustment ${formatMoney(adjustment.cents)}`,
				detail: adjustment.note || 'Explicit adjustment. Excluded from budgets and trends.'
			});
		}
		for (const id of stagedDeleteIds) {
			const row = data.rows.find((item: ReconcileRow) => item.id === id);
			if (!row) continue;
			items.push({
				title: `Delete ${row.merchant ?? 'transaction'} ${formatMoney(row.amountCents)}`,
				detail: 'The entry added by hand. The cleared one stays.'
			});
		}
		for (const pair of stagedDismissPairs) {
			const row = data.rows.find((item: ReconcileRow) => item.id === pair.manualId);
			const who = row?.merchant ?? 'both copies';
			items.push({
				title: `Keep both ${who}${row ? ` ${formatMoney(row.amountCents)}` : ''}`,
				detail: 'Nothing is deleted. The duplicate hint is dismissed when you finish.'
			});
		}
		if (view.markCount > 0) {
			items.push({
				title: `Mark ${view.markCount} transaction${view.markCount === 1 ? '' : 's'} reconciled`,
				detail: `Through ${shortDate(through)} · locks against accidental edits`
			});
		}
		if (view.leaveCount > 0) {
			const who = view.leaveCount === 1 && view.leaveMerchant ? view.leaveMerchant : `${view.leaveCount} items`;
			items.push({
				title: `Leave ${who} open`,
				detail: 'Stays unlocked for next time.'
			});
		}
		if (items.length === 0) {
			items.push({ title: 'Record this statement', detail: 'Cleared rows are already locked. Nothing else changes.' });
		}
		return items;
	});

	function openFinish() {
		if (!view.canFinish || readonly) return;
		flushSync(() => {
			planJson = JSON.stringify({
				bankBalanceCents: parseAmountToCents(bankText),
				statementDate: through,
				adjustment: adjustment
					? { amountCents: adjustment.cents, date: adjustment.date, note: adjustment.note }
					: null,
				addUnimportedIds: stagedAddIds,
				deleteIds: stagedDeleteIds,
				dismissPairs: stagedDismissPairs.map((pair) => ({
					manualId: pair.manualId,
					syncedId: pair.syncedId
				}))
			});
		});
		finishOpen = true;
	}

	function hintFor(row: ReconcileRow): string | null {
		if (view.duplicates.some((pair) => pair.manual.id === row.id)) return 'Possible duplicate';
		if (view.notAtBank.some((item) => item.id === row.id)) return 'Not at bank yet';
		return null;
	}
</script>

<Title title="Reconcile {data.account.name}" />

<div class="reconcile-page settings-stack mx-auto w-full min-w-0 max-w-6xl">
	<a href="/settings/accounts" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
		← Accounts
	</a>
	<div class="flex min-w-0 flex-wrap items-end justify-between gap-3">
		<div class="min-w-0">
			<h1 class="break-words text-2xl font-semibold tracking-tight">Reconcile {data.account.name}</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Tick what the bank shows. Nothing is written until you confirm.
			</p>
		</div>
		{#if data.lastStatementDate}
			<span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
				Last reconciled {shortDate(data.lastStatementDate)}
			</span>
		{/if}
	</div>

	{#if form?.error}
		<p class="text-sm text-destructive" role="alert">{form.error}</p>
	{/if}

	<div class="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
		<div class="flex min-w-0 flex-col gap-4">
			<section class="min-w-0 rounded-lg border border-border bg-surface p-4">
				<div class="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,auto)] sm:items-end">
					<Field class="min-w-0" label="Bank balance">
						<Input
							class="min-w-0"
							type="text"
							inputmode="decimal"
							bind:value={bankText}
							disabled={readonly}
							autocomplete="off"
							aria-describedby="bank-help"
						/>
					</Field>
					<Field class="min-w-0" label="Through">
						<Input class="min-w-0" type="date" bind:value={through} disabled={readonly} />
					</Field>
					<div class="flex min-w-0 flex-col gap-1">
						<span class="text-sm font-medium text-foreground">Show</span>
						<div
							class="flex h-9 w-full min-w-0 overflow-hidden rounded-md border border-border sm:w-auto"
							role="group"
							aria-label="Which rows to show"
						>
							<button
								type="button"
								class="min-w-0 flex-1 truncate px-3 text-sm sm:flex-initial {showAll ? 'text-muted-foreground' : 'bg-primary/15 font-medium text-primary'}"
								aria-pressed={!showAll}
								onclick={() => (showAll = false)}
							>
								Not reconciled ({view.toCheck})
							</button>
							<button
								type="button"
								class="shrink-0 border-l border-border px-3 text-sm {showAll ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground'}"
								aria-pressed={showAll}
								onclick={() => (showAll = true)}
							>
								All
							</button>
						</div>
					</div>
				</div>
				<p id="bank-help" class="mt-2 text-xs text-muted-foreground">{bankHelp()}</p>
			</section>

			<section class="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
				<div class="flex min-w-0 flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
					<p class="min-w-0 text-sm text-muted-foreground">
						{view.toCheck} to check{#if view.reconciledShown} · {view.reconciledShown} reconciled shown{/if}
					</p>
					{#if !readonly}
						<Button type="button" variant="secondary" size="sm" class="w-full min-w-0 sm:w-auto" onclick={tickAll} disabled={!through}>
							Tick all through {through ? shortDate(through) : '…'}
						</Button>
					{/if}
				</div>

				<div class="hidden md:block">
					<table class="w-full text-left text-sm">
						<caption class="sr-only">Transactions to reconcile for {data.account.name}</caption>
						<thead class="text-xs text-muted-foreground">
							<tr class="border-b border-border">
								<th class="px-3 py-2 font-medium" scope="col">Cleared</th>
								<th class="px-3 py-2 font-medium" scope="col">Date</th>
								<th class="px-3 py-2 font-medium" scope="col">Merchant</th>
								<th class="px-3 py-2 font-medium" scope="col">Category</th>
								<th class="px-3 py-2 text-right font-medium" scope="col">Amount</th>
								<th class="px-3 py-2 font-medium" scope="col">Status</th>
							</tr>
						</thead>
						<tbody>
							{#each view.visibleRows as row (row.id)}
								<tr class="min-h-11 border-b border-border last:border-0 {row.reconciledAt ? 'text-muted-foreground' : ''}">
									<td class="px-3 py-2">
										<Checkbox
											checked={row.cleared}
											disabled={readonly || !!row.reconciledAt}
											aria-label="Cleared {row.merchant ?? 'transaction'} on {shortDate(row.date)}"
											onCheckedChange={(value: boolean) => toggle(row, value === true)}
										/>
									</td>
									<td class="whitespace-nowrap px-3 py-2">{shortDate(row.date)}</td>
									<td class="px-3 py-2">
										<span class="font-medium">{row.merchant ?? '—'}</span>
										{#if hintFor(row)}
											<span class="ml-2 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
												{hintFor(row)}
											</span>
										{/if}
									</td>
									<td class="px-3 py-2 text-muted-foreground">{row.categoryName ?? '—'}</td>
									<td class="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums {row.amountCents > 0 ? 'text-success' : ''}">
										{formatMoney(row.amountCents)}
									</td>
									<td class="whitespace-nowrap px-3 py-2 text-xs">
										{#if row.reconciledAt}
											<span class="inline-flex items-center gap-1 text-muted-foreground">
												<svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
													<rect x="5" y="11" width="14" height="9" rx="2" />
													<path d="M8 11V8a4 4 0 0 1 8 0v3" />
												</svg>
												Reconciled
											</span>
											{#if !readonly}
												<button type="button" class="ml-2 text-primary hover:underline" onclick={() => (unlockRow = row)}>
													Unlock…
												</button>
											{/if}
										{:else if row.cleared}
											<span class="text-success">Cleared</span>
										{:else}
											<span class="text-muted-foreground">Not cleared</span>
										{/if}
									</td>
								</tr>
							{:else}
								<tr>
									<td class="px-3 py-8 text-center text-muted-foreground" colspan="6">
										No transactions in this statement.
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<ul class="min-w-0 md:hidden">
					{#each view.visibleRows as row (row.id)}
						<li class="min-w-0 border-b border-border last:border-0">
							<div class="flex min-h-11 min-w-0 items-start gap-3 px-3 py-3 {row.reconciledAt ? 'text-muted-foreground' : ''}">
								<div class="pt-0.5">
									<Checkbox
										checked={row.cleared}
										disabled={readonly || !!row.reconciledAt}
										aria-label="Cleared {row.merchant ?? 'transaction'} on {shortDate(row.date)}"
										onCheckedChange={(value: boolean) => toggle(row, value === true)}
									/>
								</div>
								<button
									type="button"
									class="min-h-11 min-w-0 flex-1 text-left disabled:opacity-100"
									disabled={readonly || !!row.reconciledAt}
									onclick={() => toggle(row, !row.cleared)}
								>
									<div class="flex min-w-0 items-baseline justify-between gap-2">
										<span class="min-w-0 flex-1 truncate font-medium">{row.merchant ?? '—'}</span>
										<span class="shrink-0 font-medium tabular-nums {row.amountCents > 0 && !row.reconciledAt ? 'text-success' : ''}">
											{formatMoney(row.amountCents)}
										</span>
									</div>
									<span class="mt-0.5 block min-w-0 truncate text-xs text-muted-foreground">
										{shortDate(row.date)}{#if row.categoryName} · {row.categoryName}{/if}
									</span>
									{#if hintFor(row)}
										<span class="mt-1 inline-flex rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px]">
											{hintFor(row)}
										</span>
									{/if}
								</button>
							</div>
							{#if row.reconciledAt && !readonly}
								<div class="px-3 pb-3">
									<button type="button" class="text-sm text-primary hover:underline" onclick={() => (unlockRow = row)}>
										Unlock…
									</button>
								</div>
							{/if}
						</li>
					{:else}
						<li class="px-3 py-8 text-center text-sm text-muted-foreground">No transactions in this statement.</li>
					{/each}
				</ul>

				{#if view.collapsedCount > 0}
					<div class="border-t border-border px-4 py-3 text-sm text-muted-foreground">
						{view.collapsedCount} earlier transaction{view.collapsedCount === 1 ? '' : 's'} reconciled through {shortDate(data.lastStatementDate ?? '')}.
						<button type="button" class="font-medium text-primary hover:underline" onclick={() => (showEarlier = !showEarlier)} aria-expanded={showEarlier}>
							{showEarlier ? 'Hide' : 'Show'}
						</button>
						{#if showEarlier}
							<ul class="mt-2 space-y-1 text-xs">
								{#each view.collapsedRows as row (row.id)}
									<li class="flex min-w-0 justify-between gap-3">
										<span class="min-w-0 flex-1 truncate">{shortDate(row.date)} · {row.merchant ?? '—'}</span>
										<span class="shrink-0 tabular-nums">{formatMoney(row.amountCents)}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</section>
		</div>

		<aside class="flex min-w-0 flex-col gap-4">
			<section class="min-w-0 rounded-lg border border-border bg-surface" aria-labelledby="left-heading">
				<div class="border-b border-border px-4 py-3">
					<h2 id="left-heading" class="text-sm font-medium text-muted-foreground">Left to explain</h2>
					<p class="mt-1 text-3xl font-semibold tabular-nums" aria-live="polite">
						{view.previewLeftCents == null ? '—' : formatMoney(view.previewLeftCents)}
					</p>
					<div
						class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={view.progressPct}
						aria-label="Cleared balance compared with the bank balance"
					>
						<div class="h-full rounded-full bg-primary" style="width: {view.progressPct}%"></div>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						{view.ticked} of {view.toCheck} ticked
						{#if view.previewLeftCents != null}
							· cleared {formatMoney(view.previewClearedCents)} of bank {formatMoney(parseAmountToCents(bankText) ?? 0)}
						{/if}
					</p>
				</div>
				<dl class="min-w-0 space-y-1.5 px-4 py-3 text-sm">
					<div class="flex min-w-0 justify-between gap-3">
						<dt class="min-w-0 text-muted-foreground">Ledger (all)</dt>
						<dd class="shrink-0 tabular-nums">{formatMoney(view.ledgerCents)}</dd>
					</div>
					{#if view.afterThroughCents !== 0}
						<div class="flex min-w-0 justify-between gap-3">
							<dt class="min-w-0 text-muted-foreground">After {through ? shortDate(through) : 'statement'}</dt>
							<dd class="shrink-0 tabular-nums">{formatMoney(view.afterThroughCents)}</dd>
						</div>
					{/if}
					<div class="flex min-w-0 justify-between gap-3">
						<dt class="min-w-0 text-muted-foreground">Not cleared ({view.notClearedCount})</dt>
						<dd class="shrink-0 tabular-nums">{formatMoney(view.notClearedEffectCents)}</dd>
					</div>
					{#if view.stagedCents !== 0}
						<div class="flex min-w-0 justify-between gap-3">
							<dt class="min-w-0 text-muted-foreground">On finish</dt>
							<dd class="shrink-0 tabular-nums">{formatMoney(view.stagedCents)}</dd>
						</div>
					{/if}
					<div class="flex min-w-0 justify-between gap-3">
						<dt class="min-w-0 text-muted-foreground">Cleared in Galene</dt>
						<dd class="shrink-0 tabular-nums">{formatMoney(view.previewClearedCents)}</dd>
					</div>
					<div class="flex min-w-0 justify-between gap-3 border-t border-border pt-1.5">
						<dt class="min-w-0 text-muted-foreground">Bank{through ? `, ${shortDate(through)}` : ''}</dt>
						<dd class="shrink-0 tabular-nums">{view.previewLeftCents == null ? '—' : formatMoney(parseAmountToCents(bankText) ?? 0)}</dd>
					</div>
					<div class="flex min-w-0 justify-between gap-3 font-medium">
						<dt class="min-w-0">Left to explain</dt>
						<dd class="shrink-0 tabular-nums">{view.previewLeftCents == null ? '—' : formatMoney(view.previewLeftCents)}</dd>
					</div>
				</dl>
			</section>

			<section class="min-w-0 rounded-lg border border-border bg-surface">
				<div class="border-b border-border px-4 py-3">
					<h2 class="font-medium">Why they differ</h2>
					<p class="text-sm text-muted-foreground">Galene’s best guesses. Nothing changes until you confirm.</p>
				</div>
				<ul class="divide-y divide-border">
					{#each view.missingShown as line (line.id)}
						<li class="flex min-w-0 gap-3 px-4 py-3">
							<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 3l9 5H3z" /></svg>
							</span>
							<div class="min-w-0 flex-1 break-words">
								<div class="flex min-w-0 justify-between gap-2 text-sm font-medium">
									<span>Missing from Galene</span>
									<span class="shrink-0 tabular-nums">{formatMoney(line.amountCents)}</span>
								</div>
								<p class="mt-0.5 text-xs text-muted-foreground">
									The bank shows <span class="font-medium text-foreground">{line.merchant ?? 'a transaction'} {formatMoney(line.amountCents)}</span>
									on {shortDate(line.date)}. Galene has no match.
								</p>
								{#if stagedAddIds.includes(line.id)}
									<p class="mt-2 text-xs text-primary">Will add when you finish.</p>
									{#if !readonly}
										<button type="button" class="mt-1 text-xs text-muted-foreground underline" onclick={() => (stagedAddIds = stagedAddIds.filter((id) => id !== line.id))}>Undo</button>
									{/if}
								{:else if !readonly}
									<Button type="button" size="sm" variant="secondary" class="mt-2" onclick={() => (missingLine = line)}>
										Add transaction…
									</Button>
								{/if}
							</div>
						</li>
					{/each}
					{#each view.duplicates as pair (`${pair.manual.id}-${pair.synced.id}`)}
						<li class="flex min-w-0 gap-3 px-4 py-3">
							<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></svg>
							</span>
							<div class="min-w-0 flex-1 break-words">
								<div class="flex min-w-0 justify-between gap-2 text-sm font-medium">
									<span>Possible duplicate</span>
									<span class="shrink-0 tabular-nums">{formatMoney(pair.manual.amountCents)}</span>
								</div>
								<p class="mt-0.5 text-xs text-muted-foreground">
									Two {pair.manual.merchant} {formatMoney(pair.manual.amountCents)} on {shortDate(pair.manual.date)}. The bank shows one.
								</p>
								{#if stagedDeleteIds.includes(pair.manual.id)}
									<p class="mt-2 text-xs text-primary">Will delete the hand-added copy when you finish.</p>
									{#if !readonly}
										<button type="button" class="mt-1 text-xs text-muted-foreground underline" onclick={() => (stagedDeleteIds = stagedDeleteIds.filter((id) => id !== pair.manual.id))}>Undo</button>
									{/if}
								{:else if isStagedKeep(pair.manual.id, pair.synced.id)}
									<p class="mt-2 text-xs text-primary">Will keep both when you finish.</p>
									{#if !readonly}
										<button type="button" class="mt-1 text-xs text-muted-foreground underline" onclick={() => unstageKeep(pair.manual.id, pair.synced.id)}>Undo</button>
									{/if}
								{:else if !readonly}
									<div class="mt-2 flex flex-wrap gap-2">
										<Button type="button" size="sm" variant="secondary" onclick={() => { duplicate = pair.manual; duplicateSynced = pair.synced; }}>
											Review duplicate…
										</Button>
										<Button type="button" size="sm" variant="ghost" onclick={() => keepBoth(pair.manual.id, pair.synced.id)}>Keep both</Button>
									</div>
								{/if}
							</div>
						</li>
					{/each}
					{#each view.notAtBank as row (row.id)}
						<li class="flex min-w-0 gap-3 px-4 py-3">
							<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">
								<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
							</span>
							<div class="min-w-0 flex-1 break-words">
								<div class="flex min-w-0 justify-between gap-2 text-sm font-medium">
									<span>Not at the bank yet</span>
									<span class="shrink-0 tabular-nums">{formatMoney(row.amountCents)}</span>
								</div>
								<p class="mt-0.5 text-xs text-muted-foreground">
									{row.merchant ?? 'This item'} ({shortDate(row.date)}) hasn’t cleared. Usually fine to leave; it clears on its own.
								</p>
							</div>
						</li>
					{/each}
					{#if view.opening}
						<li class="flex min-w-0 gap-3 px-4 py-3">
							<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md {view.opening.ok ? 'bg-muted text-success' : 'bg-primary/10 text-primary'}" aria-hidden="true">
								{#if view.opening.ok}
									<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7" /></svg>
								{:else}
									<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></svg>
								{/if}
							</span>
							<div class="min-w-0 flex-1 break-words">
								<div class="text-sm font-medium">Opening balance</div>
								{#if view.opening.ok}
									<p class="mt-0.5 text-xs text-muted-foreground">Matches the bank on {shortDate(view.opening.asOf)}. Nothing to do.</p>
								{:else}
									<p class="mt-0.5 text-xs text-muted-foreground">
										Still off by {formatMoney(view.opening.residualCents)} after the bank lines above. That can be the opening balance.
									</p>
									<a class="mt-1 inline-block text-xs font-medium text-primary hover:underline" href="/settings/accounts?edit={data.account.id}">
										Edit opening balance…
									</a>
								{/if}
							</div>
						</li>
					{/if}
				</ul>
				{#if !readonly}
					<p class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
						Still off after this?
						<button type="button" class="font-medium text-primary hover:underline" onclick={openAdjust}>Add an adjustment…</button>
						{#if adjustment}
							<span class="mt-1 block text-primary">
								Balance adjustment {formatMoney(adjustment.cents)} is in the review.
								<button type="button" class="underline" onclick={() => (adjustment = null)}>Undo</button>
							</span>
						{/if}
					</p>
				{/if}
			</section>

			<section class="hidden min-w-0 rounded-lg border border-border bg-surface p-4 lg:block">
				<Button type="button" class="w-full" disabled={!view.canFinish || readonly} onclick={openFinish}>
					Finish reconcile
				</Button>
				<p class="mt-2 text-center text-xs text-muted-foreground">
					{view.canFinish ? 'Review the changes, then lock cleared rows.' : 'Turns on when nothing is left to explain.'}
				</p>
			</section>
		</aside>
	</div>
</div>

{#if !readonly}
	<div class="reconcile-footer fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
		<div class="mx-auto flex min-w-0 max-w-6xl items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-xs text-muted-foreground">Left to explain</p>
				<p class="truncate text-lg font-semibold tabular-nums">{view.previewLeftCents == null ? '—' : formatMoney(view.previewLeftCents)}</p>
			</div>
			<Button type="button" class="shrink-0" disabled={!view.canFinish} onclick={openFinish}>Finish</Button>
		</div>
	</div>
{/if}

<form bind:this={tickForm} method="POST" action="?/set-cleared" use:enhance class="hidden">
	<input name="id" value={tickId} />
	<input name="cleared" value={tickCleared} />
</form>
<form bind:this={tickAllForm} method="POST" action="?/tick-all" use:enhance class="hidden">
	<input name="through" value={through} />
</form>
<form bind:this={unlockForm} method="POST" action="?/unlock" use:enhance class="hidden">
	<input name="id" value={unlockId} />
</form>
<form
	bind:this={finishForm}
	id="finish-form"
	method="POST"
	action="?/finish"
	use:enhance={() =>
		async ({ result, update }) => {
			finishOpen = false;
			if (result.type === 'success' && result.data && typeof result.data === 'object' && 'ok' in result.data && result.data.ok) {
				stagedDismissPairs = [];
			}
			await update();
		}}
	class="hidden"
>
	<input name="plan" value={planJson} />
</form>

<Dialog class="reconcile-dialog" bind:open={adjustOpen} title="Add balance adjustment" description="Adds one transaction to {data.account.name} so it matches the bank. Nothing else changes, and nothing is written until you finish.">
	<div class="flex min-w-0 flex-col gap-4">
		<Field class="min-w-0" label="Amount">
			<Input class="min-w-0" type="text" inputmode="decimal" bind:value={adjustAmount} autocomplete="off" />
		</Field>
		<p class="-mt-2 text-xs text-muted-foreground">Prefilled with what’s left to explain. Positive = money in.</p>
		<div class="grid min-w-0 gap-3 sm:grid-cols-2">
			<Field class="min-w-0" label="Date"><Input class="min-w-0" type="date" bind:value={adjustDate} /></Field>
			<Field class="min-w-0" label="Category">
				<Input class="min-w-0" type="text" value="Balance adjustment" disabled />
			</Field>
		</div>
		<Field class="min-w-0" label="Note"><Input class="min-w-0" type="text" bind:value={adjustNote} /></Field>
		<p class="text-xs text-muted-foreground">Shows in Transactions like any other entry. You can edit or delete it later, after unlocking it.</p>
	</div>
	{#snippet footer()}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="secondary" class="w-full sm:w-auto" onclick={() => (adjustOpen = false)}>Cancel</Button>
			<Button type="button" class="w-full sm:w-auto" onclick={stageAdjust}>Add adjustment</Button>
		</div>
	{/snippet}
</Dialog>

<Dialog
	class="reconcile-dialog"
	bind:open={() => duplicate != null, (open) => { if (!open) { duplicate = null; duplicateSynced = null; } }}
	title="Possible duplicate"
	description="Same merchant, amount, and day. The bank shows only one."
>
	{#if duplicate}
		<div class="flex flex-col gap-3 text-sm">
			{#if duplicateSynced}
				<div class="rounded-md border border-border px-3 py-2">
					<div class="flex min-w-0 justify-between gap-2 font-medium">
						<span class="min-w-0 truncate">{duplicateSynced.merchant}</span>
						<span class="shrink-0 text-success">{formatMoney(duplicateSynced.amountCents)}</span>
					</div>
					<p class="text-xs text-muted-foreground">{shortDate(duplicateSynced.date)} · synced · Cleared</p>
				</div>
			{/if}
			<div class="min-w-0 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
				<div class="flex min-w-0 justify-between gap-2 font-medium">
					<span class="min-w-0 truncate">{duplicate.merchant}</span>
					<span class="shrink-0">{formatMoney(duplicate.amountCents)}</span>
				</div>
				<p class="text-xs text-muted-foreground">{shortDate(duplicate.date)} · added by hand · Not cleared</p>
			</div>
			<p class="text-xs text-muted-foreground">Deleting removes the entry you added by hand when you finish. The cleared one stays. Nothing is deleted yet.</p>
		</div>
	{/if}
	{#snippet footer()}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="ghost" class="w-full sm:w-auto" onclick={() => duplicate && duplicateSynced && keepBoth(duplicate.id, duplicateSynced.id)}>Keep both</Button>
			<Button type="button" class="w-full sm:w-auto" onclick={() => duplicate && stageDelete(duplicate)}>Delete this one</Button>
		</div>
	{/snippet}
</Dialog>

<Dialog
	class="reconcile-dialog"
	bind:open={() => missingLine != null, (open) => { if (!open) missingLine = null; }}
	title="Add transaction"
	description="Adds the bank line to {data.account.name} when you finish. Nothing is written yet."
>
	{#if missingLine}
		<p class="break-words text-sm">
			<span class="font-medium">{missingLine.merchant ?? 'Bank line'}</span>
			{formatMoney(missingLine.amountCents)} on {shortDate(missingLine.date)}.
		</p>
	{/if}
	{#snippet footer()}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="secondary" class="w-full sm:w-auto" onclick={() => (missingLine = null)}>Cancel</Button>
			<Button type="button" class="w-full sm:w-auto" onclick={() => missingLine && stageMissing(missingLine)}>Add transaction</Button>
		</div>
	{/snippet}
</Dialog>

<Dialog class="reconcile-dialog" bind:open={finishOpen} title="Finish reconcile" description="{data.account.name} matches the bank through {through ? shortDate(through) : 'this date'}.">
	<dl class="min-w-0 space-y-1 text-sm">
		<div class="flex min-w-0 justify-between gap-3"><dt class="min-w-0 text-muted-foreground">Bank balance</dt><dd class="shrink-0 tabular-nums">{formatMoney(parseAmountToCents(bankText) ?? 0)}</dd></div>
		<div class="flex min-w-0 justify-between gap-3"><dt class="min-w-0 text-muted-foreground">Cleared in Galene</dt><dd class="shrink-0 tabular-nums">{formatMoney(view.previewClearedCents)}</dd></div>
		<div class="flex min-w-0 justify-between gap-3 border-t border-border pt-1 font-medium"><dt class="min-w-0">Difference</dt><dd class="shrink-0 tabular-nums">{formatMoney(view.previewLeftCents ?? 0)}</dd></div>
	</dl>
	<ul class="mt-4 min-w-0 space-y-3">
		{#each reviewItems as item, i (i)}
			<li class="min-w-0">
				<p class="break-words text-sm font-medium">{item.title}</p>
				<p class="break-words text-xs text-muted-foreground">{item.detail}</p>
			</li>
		{/each}
	</ul>
	{#snippet footer()}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="secondary" class="w-full sm:w-auto" onclick={() => (finishOpen = false)}>Not yet</Button>
			<Button type="submit" form="finish-form" class="w-full sm:w-auto">Finish reconcile</Button>
		</div>
	{/snippet}
</Dialog>

<Dialog
	class="reconcile-dialog"
	bind:open={() => unlockRow != null, (open) => { if (!open) unlockRow = null; }}
	title="Unlock this transaction?"
	description="It was reconciled and is locked against accidental edits. Unlocking does not change the amount."
>
	{#if unlockRow}
		<p class="break-words text-sm">{unlockRow.merchant ?? 'This transaction'} on {shortDate(unlockRow.date)} can be edited or deleted after you unlock it.</p>
	{/if}
	{#snippet footer()}
		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button type="button" variant="secondary" class="w-full sm:w-auto" onclick={() => (unlockRow = null)}>Cancel</Button>
			<Button type="button" class="w-full sm:w-auto" onclick={submitUnlock}>Unlock</Button>
		</div>
	{/snippet}
</Dialog>

<style>
	/* The sticky Finish bar covers the bottom of the scrollport. Pad the page
	   by the bar, and grow both when the iOS home indicator is present. */
	.reconcile-page {
		padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px));
	}
	@media (min-width: 64rem) {
		.reconcile-page {
			padding-bottom: 0;
		}
	}
	.reconcile-footer {
		padding-top: 0.75rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));
	}
	/*
	 * Text and date fields use a large min-content width. As grid/flex items
	 * that minimum widens the card, the list, and the page. Pin fields on this
	 * screen to their column. Dialogs portal outside .reconcile-page, so they
	 * opt in with class="reconcile-dialog" on Dialog. The ancestor class is
	 * required: a bare :global(input) stays in the document after navigation
	 * and would restyle fields on other pages.
	 */
	.reconcile-page :global(input:not([type='checkbox'], [type='radio'], [type='hidden'])) {
		min-width: 0;
		max-width: 100%;
	}
	:global(.reconcile-dialog input:not([type='checkbox'], [type='radio'], [type='hidden'])) {
		min-width: 0;
		max-width: 100%;
	}
	.reconcile-page :global(input[type='date']::-webkit-datetime-edit) {
		min-width: 0;
	}
	:global(.reconcile-dialog input[type='date']::-webkit-datetime-edit) {
		min-width: 0;
	}
</style>
