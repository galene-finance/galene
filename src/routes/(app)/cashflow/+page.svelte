<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import CashflowFiltersDialog from '$lib/components/CashflowFiltersDialog.svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { formatMoney, monthLabel } from '$lib/utils';
	import type { CashflowSection, CashflowSectionRow } from '$lib/server/finance';
	import type { Account, CashflowViewFilters, Category, Transaction } from '$lib/types';

	let { data }: {
		data: {
			from: string;
			to: string;
			currentMonth: string;
			monthList: string[];
			monthLabels: string[];
			sections: { income: CashflowSection; expense: CashflowSection };
			summary: {
				forecastIncomeCents: number;
				forecastExpenseCents: number;
				actualIncomeCents: number;
				actualExpenseCents: number;
			};
			transactions: Transaction[];
			occurrences: {
				id: number;
				name: string;
				date: string;
				amountCents: number;
				behavior: 'bill' | 'spread';
				categoryId: number | null;
				accountId: number | null;
			}[];
			accounts: Account[];
			categories: Category[];
			filters: CashflowViewFilters;
			filtersActive: boolean;
		};
	} = $props();

	// --- Filter form (URL-driven) ---
	let filterForm = $state<HTMLFormElement | null>(null);
	// untrack is the first paint only. The effect below applies the next URL.
	let selFrom = $state(untrack(() => data.from));
	let selTo = $state(untrack(() => data.to));

	// Keep the pickers in sync with the applied range (covers client-side navigation).
	$effect(() => {
		selFrom = data.from;
		selTo = data.to;
	});

	// --- Gear: per-user account/category include filters (issue #37) ---
	let filtersOpen = $state(false);
	let savingFilters = $state(false);

	function saveFilters(next: CashflowViewFilters) {
		savingFilters = true;
		const body = new FormData();
		body.set('filters', JSON.stringify(next));
		fetch('?/save-filters', { method: 'POST', body })
			.then(async (r) => {
				if (r.ok || r.status === 303 || r.redirected) {
					await goto(window.location.pathname + window.location.search, {
						invalidateAll: true,
						replaceState: true
					});
				}
			})
			.finally(() => {
				savingFilters = false;
			});
	}

	// Remember the last applied range so it survives a refresh or re-login.
	const RANGE_KEY = 'galene_cashflow_range';

	function saveRange() {
		if (!browser) return;
		const from = selFrom.trim();
		const to = selTo.trim();
		if (from === '' || to === '') localStorage.removeItem(RANGE_KEY);
		else localStorage.setItem(RANGE_KEY, JSON.stringify({ from, to }));
	}

	function restoreRange() {
		if (!browser) return;
		const params = new URLSearchParams(window.location.search);
		if (params.has('from') || params.has('to')) return;
		let saved: { from?: string; to?: string } | null = null;
		try {
			const raw = localStorage.getItem(RANGE_KEY);
			if (raw) saved = JSON.parse(raw);
		} catch {
			return;
		}
		if (saved?.from && saved?.to) {
			void goto(`/cashflow?from=${encodeURIComponent(saved.from)}&to=${encodeURIComponent(saved.to)}`, {
				replaceState: true
			});
		}
	}

	// Re-runs on every navigation to this page (data is a new object each load).
	$effect(() => {
		void data;
		restoreRange();
	});

	const rangeLabel = $derived(
		data.monthList.length === 1
			? monthLabel(`${data.monthList[0]}-01`)
			: `${monthLabel(`${data.monthList[0]}-01`)} – ${monthLabel(
					`${data.monthList[data.monthList.length - 1]}-01`
			  )}`
	);

	const netActual = $derived(data.summary.actualIncomeCents - data.summary.actualExpenseCents);
	const netForecast = $derived(data.summary.forecastIncomeCents - data.summary.forecastExpenseCents);
	const noActivity = $derived(
		data.sections.income.rows.length === 0 && data.sections.expense.rows.length === 0
	);

	// --- Surplus / deficit: net per month and total (income positive, expense negative) ---
	const netForecastByMonth = $derived(
		data.monthList.map(
			(_, i) =>
				data.sections.income.monthTotals[i].forecastCents +
				data.sections.expense.monthTotals[i].forecastCents
		)
	);
	const netActualByMonth = $derived(
		data.monthList.map(
			(_, i) =>
				data.sections.income.monthTotals[i].actualCents +
				data.sections.expense.monthTotals[i].actualCents
		)
	);
	const netForecastTotal = $derived(netForecastByMonth.reduce((s, v) => s + v, 0));
	const netActualTotal = $derived(netActualByMonth.reduce((s, v) => s + v, 0));

	// --- Current-month column highlight (top to bottom) ---
	const HL = 'bg-primary/15';
	function isCur(i: number): boolean {
		return data.monthList[i] === data.currentMonth;
	}

	// --- Sign-based coloring, used only on the surplus/deficit and total rows ---
	function signColor(cents: number): string {
		if (cents > 0) return 'text-success';
		if (cents < 0) return 'text-destructive';
		return 'text-muted-foreground';
	}

	// --- Drill-down ---
	type DrillTarget = {
		sectionType: 'income' | 'expense';
		categoryId: number | null;
		categoryName: string;
		kind: 'forecast' | 'actual';
		months: string[];
	};
	let drill = $state<DrillTarget | null>(null);
	let drillOpen = $state(false);

	function openDrill(
		section: CashflowSection,
		row: CashflowSectionRow,
		monthIdx: number | null,
		kind: 'forecast' | 'actual'
	) {
		drill = {
			sectionType: section.type,
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			kind,
			months: monthIdx == null ? data.monthList : [data.monthList[monthIdx]]
		};
		drillOpen = true;
	}

	const drillSign = $derived(drill?.sectionType === 'income' ? 1 : -1);

	type DrillItem = { id: string; date: string; label: string; amountCents: number };

	const drillForecast = $derived.by(() => {
		const d = drill;
		if (!d || d.kind !== 'forecast') return [];
		return data.occurrences
			.filter((o) => o.categoryId === d.categoryId && d.months.includes(o.date.slice(0, 7)))
			.sort((a, b) => a.date.localeCompare(b.date));
	});

	const drillActual = $derived.by(() => {
		const d = drill;
		if (!d || d.kind !== 'actual') return [];
		return data.transactions
			.flatMap<DrillItem>((t) => {
				if (!d.months.includes(t.date.slice(0, 7))) return [];
				if (t.splits && t.splits.length > 0) {
					return t.splits
						.filter((s) => s.category_id === d.categoryId)
						.map((s) => ({
							id: `${t.id}-${s.category_id}`,
							date: t.date,
							label: t.merchant ?? t.account_name ?? 'Transaction',
							amountCents: s.amount_cents * Math.sign(t.amount_cents)
						}));
				}
				return t.category_id === d.categoryId
					? [{
						id: String(t.id),
						date: t.date,
						label: t.merchant ?? t.account_name ?? 'Transaction',
						amountCents: t.amount_cents
					}]
					: [];
			})
			.sort((a, b) => a.date.localeCompare(b.date));
	});

	const drillForecastTotal = $derived(drillForecast.reduce((s, o) => s + o.amountCents, 0) * (drillSign ?? -1));
	const drillActualTotal = $derived(drillActual.reduce((s, a) => s + a.amountCents, 0));

	const drillTitle = $derived(
		drill
			? `${drill.categoryName} · ${drill.kind === 'forecast' ? 'Forecast' : 'Actual'} · ${
					drill.months.length === 1
						? monthLabel(`${drill.months[0]}-01`)
						: `${monthLabel(`${drill.months[0]}-01`)} – ${monthLabel(
								`${drill.months[drill.months.length - 1]}-01`
						  )}`
			  }`
			: ''
	);

	function lastDayOfMonth(month: string): string {
		const [y, m] = month.split('-').map(Number);
		const days = new Date(y, m, 0).getDate();
		return `${month}-${String(days).padStart(2, '0')}`;
	}

	const drillTransactionsHref = $derived.by(() => {
		const d = drill;
		if (!d || d.kind !== 'actual' || d.months.length === 0) return null;
		const params = new URLSearchParams();
		if (d.categoryId != null) params.set('category', String(d.categoryId));
		params.set('date_from', `${d.months[0]}-01`);
		params.set('date_to', lastDayOfMonth(d.months[d.months.length - 1]));
		return `/transactions?${params.toString()}`;
	});

	function daysInMonthOf(iso: string): number {
		const [y, m] = iso.split('-').map(Number);
		return new Date(Date.UTC(y, m, 0)).getUTCDate();
	}

	function occurrenceAmount(o: { amountCents: number; date: string; behavior: 'bill' | 'spread' }): string {
		if (o.behavior === 'spread') {
			const days = daysInMonthOf(o.date);
			return `${formatMoney(Math.round(o.amountCents / days))}/day × ${days} days`;
		}
		return formatMoney(o.amountCents);
	}
</script>

<style>
	/* Keep the leftmost (category) column pinned while the month columns
		scroll horizontally. The background must be opaque so scrolling cells
		don't show through; tinted rows use color-mix to match their
		semi-transparent row color over the surface. */
	.cf-sticky {
		position: sticky;
		left: 0;
		z-index: 1;
		border-right: 1px solid var(--border);
		background-color: var(--surface);
	}
	.cf-sticky-muted-20 {
		background-color: color-mix(in srgb, var(--muted) 20%, var(--surface));
	}
	.cf-sticky-muted-30 {
		background-color: color-mix(in srgb, var(--muted) 30%, var(--surface));
	}
	.cf-sticky-muted-40 {
		background-color: color-mix(in srgb, var(--muted) 40%, var(--surface));
	}
	/* The section header row is a full-width cell, so the cell itself cannot
		be pinned; the label is instead pinned inside it. */
	.cf-sticky-label {
		position: sticky;
		left: 0;
		display: inline-block;
		padding-left: 16px;
	}
</style>

<Title title="Cashflow" />

<div class="mx-auto flex max-w-5xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Cashflow</h1>
			<p class="text-sm text-muted-foreground">
				Forecast from your scheduled expectations, checked against what actually happened.
			</p>
		</div>
		<button
			type="button"
			class="relative shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			title="Cashflow filters"
			aria-label="Cashflow filters"
			disabled={savingFilters}
			onclick={() => (filtersOpen = true)}
		>
			<svg
				class="size-5"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path
					d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
				/>
				<path
					d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852 1.01 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
				/>
			</svg>
			{#if data.filtersActive}
				<span class="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary"></span>
			{/if}
		</button>
	</div>

	<form method="GET" bind:this={filterForm} onsubmit={saveRange} class="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
		<div class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">From</span>
			<DatePicker name="from" bind:value={selFrom} placeholder="Any date" />
		</div>
		<div class="flex flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">To</span>
			<DatePicker name="to" bind:value={selTo} placeholder="Any date" />
		</div>
		<Button type="submit">Apply</Button>
	</form>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-lg border border-border bg-surface p-4">
			<p class="text-sm text-muted-foreground">Income · {rangeLabel}</p>
			<p class="mt-1 text-2xl font-semibold text-success">{formatMoney(data.summary.actualIncomeCents)}</p>
			<p class="text-xs text-muted-foreground">Forecast {formatMoney(data.summary.forecastIncomeCents)}</p>
		</div>
		<div class="rounded-lg border border-border bg-surface p-4">
			<p class="text-sm text-muted-foreground">Spending · {rangeLabel}</p>
			<p class="mt-1 text-2xl font-semibold">{formatMoney(data.summary.actualExpenseCents)}</p>
			<p class="text-xs text-muted-foreground">Forecast {formatMoney(data.summary.forecastExpenseCents)}</p>
		</div>
		<div class="rounded-lg border border-border bg-surface p-4">
			<p class="text-sm text-muted-foreground">Net cashflow · {rangeLabel}</p>
			<p class="mt-1 text-2xl font-semibold {netActual < 0 ? 'text-destructive' : 'text-success'}">
				{formatMoney(netActual)}
			</p>
			<p class="text-xs text-muted-foreground">Forecast {formatMoney(netForecast)}</p>
		</div>
	</div>

	{#if noActivity}
		<div class="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted-foreground">
				No activity in {rangeLabel}. Add transactions or scheduled expectations to see the
				forecast vs. actual.
			</p>
		</div>
	{:else}
		<div class="galene-scroll-x min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-surface">
			<table class="w-full min-w-max text-sm">
				<thead>
					<tr class="text-xs uppercase tracking-wide text-muted-foreground">
						<th rowspan="2" class="cf-sticky px-4 py-2.5 text-left font-medium">Category</th>
						{#each data.monthLabels as label, i (i)}
							<th
								colspan="2"
								class="{i > 0 ? 'border-l border-border' : ''} px-3 py-2.5 text-center font-medium {isCur(i) ? HL : ''}"
							>
								{label}
							</th>
						{/each}
						<th colspan="2" class="border-l border-border px-3 py-2.5 text-center font-medium">
							Total
						</th>
					</tr>
					<tr class="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
						{#each data.monthLabels as _, i (i)}
							<th class="{i > 0 ? 'border-l border-border' : ''} px-3 py-1.5 text-right font-medium {isCur(i) ? HL : ''}">
								Forecast
							</th>
							<th class="px-3 py-1.5 text-right font-medium {isCur(i) ? HL : ''}">Actual</th>
						{/each}
						<th class="border-l border-border px-3 py-1.5 text-right font-medium">Forecast</th>
						<th class="px-3 py-1.5 text-right font-medium">Actual</th>
					</tr>
				</thead>
				<tbody>
					<!-- Surplus / deficit: net forecast and actual per month, above the income section -->
					<tr class="border-b-2 border-border bg-muted/20">
						<td class="cf-sticky cf-sticky-muted-20 px-4 py-2.5 font-medium">Surplus / Deficit</td>
						{#each data.monthList as _, i (i)}
							<td
								class="whitespace-nowrap {i > 0 ? 'border-l border-border' : ''} px-3 py-2.5 text-right font-medium {isCur(i) ? HL : ''} {signColor(netForecastByMonth[i])}"
							>
								{netForecastByMonth[i] !== 0 ? formatMoney(netForecastByMonth[i]) : '—'}
							</td>
							<td
								class="whitespace-nowrap px-3 py-2.5 text-right font-medium {isCur(i) ? HL : ''} {signColor(netActualByMonth[i])}"
							>
								{netActualByMonth[i] !== 0 ? formatMoney(netActualByMonth[i]) : '—'}
							</td>
						{/each}
						<td class="whitespace-nowrap border-l border-border px-3 py-2.5 text-right font-medium {signColor(netForecastTotal)}">
							{netForecastTotal !== 0 ? formatMoney(netForecastTotal) : '—'}
						</td>
						<td class="whitespace-nowrap px-3 py-2.5 text-right font-medium {signColor(netActualTotal)}">
							{netActualTotal !== 0 ? formatMoney(netActualTotal) : '—'}
						</td>
					</tr>

					{#each [data.sections.income, data.sections.expense] as section (section.type)}
						<tr class="border-t border-border">
							<td
								colspan={2 * data.monthList.length + 3}
								class="cf-sticky-muted-40 py-2 pr-4 pl-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
							>
								<span class="cf-sticky-label">{section.type === 'income' ? 'Income' : 'Expenses'}</span>
							</td>
						</tr>
						{#if section.rows.length === 0}
							<tr>
								<td
									colspan={2 * data.monthList.length + 3}
									class="px-4 py-4 text-center text-sm text-muted-foreground"
								>
									No {section.type === 'income' ? 'income' : 'expenses'} in {rangeLabel}.
								</td>
							</tr>
						{:else}
							{#each section.rows as r (r.categoryId ?? -1)}
								<tr class="border-b border-border">
									<td class="cf-sticky whitespace-nowrap px-4 py-2.5">
										<span class="flex items-center gap-2">
											<span
												class="size-2.5 shrink-0 rounded-full"
												style="background: {r.categoryColor ?? 'transparent'}"
											></span>
											<span class="font-medium">{r.categoryName}</span>
										</span>
									</td>
									{#each r.cells as c, i (i)}
										<td class="whitespace-nowrap {i > 0 ? 'border-l border-border' : ''} px-3 py-2.5 text-right {isCur(i) ? HL : ''}">
											{#if c.forecastCents !== 0}
												<button
													type="button"
													class="hover:underline"
													onclick={() => openDrill(section, r, i, 'forecast')}
												>
													{formatMoney(c.forecastCents)}
												</button>
											{:else}
												<span class="text-muted-foreground">—</span>
											{/if}
										</td>
										<td class="whitespace-nowrap px-3 py-2.5 text-right {isCur(i) ? HL : ''}">
											{#if c.actualCents !== 0}
												<button
													type="button"
													class="hover:underline"
													onclick={() => openDrill(section, r, i, 'actual')}
												>
													{formatMoney(c.actualCents)}
												</button>
											{:else}
												<span class="text-muted-foreground">—</span>
											{/if}
										</td>
									{/each}
									<td class="whitespace-nowrap border-l border-border px-3 py-2.5 text-right">
										{#if r.totalForecastCents !== 0}
											<button
												type="button"
												class="hover:underline"
												onclick={() => openDrill(section, r, null, 'forecast')}
											>
												{formatMoney(r.totalForecastCents)}
											</button>
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</td>
									<td class="whitespace-nowrap px-3 py-2.5 text-right">
										{#if r.totalActualCents !== 0}
											<button
												type="button"
												class="hover:underline"
												onclick={() => openDrill(section, r, null, 'actual')}
											>
												{formatMoney(r.totalActualCents)}
											</button>
										{:else}
											<span class="text-muted-foreground">—</span>
										{/if}
									</td>
								</tr>
							{/each}
						{/if}
						<!-- Section total row: colored by the sign of each value -->
						<tr class="border-t-2 border-border bg-muted/30">
							<td class="cf-sticky cf-sticky-muted-30 px-4 py-2.5 font-medium">Total</td>
							{#each section.monthTotals as c, i (i)}
								<td
									class="whitespace-nowrap {i > 0 ? 'border-l border-border' : ''} px-3 py-2.5 text-right font-medium {isCur(i) ? HL : ''} {signColor(c.forecastCents)}"
								>
									{c.forecastCents !== 0 ? formatMoney(c.forecastCents) : '—'}
								</td>
								<td
									class="whitespace-nowrap px-3 py-2.5 text-right font-medium {isCur(i) ? HL : ''} {signColor(c.actualCents)}"
								>
									{c.actualCents !== 0 ? formatMoney(c.actualCents) : '—'}
								</td>
							{/each}
							<td class="whitespace-nowrap border-l border-border px-3 py-2.5 text-right font-medium {signColor(section.totalForecastCents)}">
								{section.totalForecastCents !== 0 ? formatMoney(section.totalForecastCents) : '—'}
							</td>
							<td class="whitespace-nowrap px-3 py-2.5 text-right font-medium {signColor(section.totalActualCents)}">
								{section.totalActualCents !== 0 ? formatMoney(section.totalActualCents) : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<p class="text-xs text-muted-foreground">
			Forecast comes from scheduled expectations: “bill” books the full amount on its date, “spread”
			divides it across the month. Click a value to see what makes up that number.
		</p>
	{/if}
</div>

<Dialog
	bind:open={drillOpen}
	size="md"
	title={drillTitle}
	description="What makes up this amount."
>
	{#if drill}
		<div class="flex flex-col gap-4">
			{#if drill.kind === 'forecast'}
				{#if drillForecast.length === 0}
					<p class="text-sm text-muted-foreground">No scheduled expectations in this period.</p>
				{:else}
					<ul class="divide-y divide-border rounded-md border border-border">
						{#each drillForecast as o (o.id + o.date)}
							<li class="flex items-center gap-3 px-3 py-2 text-sm">
								<span class="w-20 shrink-0 text-muted-foreground">
									{new Date(o.date + 'T12:00:00').toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric'
									})}
								</span>
								<span class="min-w-0 flex-1 truncate">{o.name}</span>
								<span class="shrink-0 font-medium {drillSign === 1 ? 'text-success' : ''}">
									{drillSign === 1 ? '+' : '−'}{occurrenceAmount(o)}
								</span>
							</li>
						{/each}
						<li class="flex items-center justify-between px-3 py-2 text-sm font-medium">
							<span>Total</span>
							<span>{formatMoney(drillForecastTotal)}</span>
						</li>
					</ul>
				{/if}
			{:else}
				{#if drillActual.length === 0}
					<p class="text-sm text-muted-foreground">No transactions in this period.</p>
				{:else}
					<ul class="divide-y divide-border rounded-md border border-border">
						{#each drillActual as a (a.id)}
							<li class="flex items-center gap-3 px-3 py-2 text-sm">
								<span class="w-20 shrink-0 text-muted-foreground">
									{new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric'
									})}
								</span>
								<span class="min-w-0 flex-1 truncate">{a.label}</span>
								<span class="shrink-0 font-medium {a.amountCents > 0 ? 'text-success' : ''}">
									{formatMoney(a.amountCents)}
								</span>
							</li>
						{/each}
						<li class="flex items-center justify-between px-3 py-2 text-sm font-medium">
							<span>Total</span>
							<span>{formatMoney(drillActualTotal)}</span>
						</li>
					</ul>
				{/if}
			{/if}
			{#if drillTransactionsHref}
				<a class="text-sm text-primary hover:underline" href={drillTransactionsHref}>
					View on Transactions
				</a>
			{/if}
		</div>
	{/if}
</Dialog>

<CashflowFiltersDialog
	bind:open={filtersOpen}
	accounts={data.accounts}
	categories={data.categories}
	filters={data.filters}
	onSave={saveFilters}
/>

