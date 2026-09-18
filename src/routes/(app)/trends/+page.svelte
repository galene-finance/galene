<script lang="ts">
	import { flushSync } from 'svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { formatMoney, monthLabel } from '$lib/utils';
	import type { Category } from '$lib/types';

	let { data }: {
		data: {
			categoryId: number | null;
			categoryName: string | null;
			period: 'week' | 'month' | 'year';
			from: string;
			to: string;
			points: { key: string; label: string; spentCents: number; budgetCents: number | null }[];
			categories: Category[];
		};
	} = $props();

	// --- Filter form (URL-driven) ---
	// Full-page navigation on submit, so the initial value is always the URL's.
	let filterForm = $state<HTMLFormElement | null>(null);
	let selCategory = $state(String(data.categoryId ?? ''));
	let selPeriod = $state(data.period);
	let selFrom = $state(data.from);
	let selTo = $state(data.to);

	// GET form submits are client-side navigations that reuse this component,
	// so re-sync the pickers with the applied (possibly capped) values after each one.
	$effect(() => {
		selCategory = String(data.categoryId ?? '');
		selPeriod = data.period;
		selFrom = data.from;
		selTo = data.to;
	});

	const periodItems = [
		{ value: 'week', label: 'Week' },
		{ value: 'month', label: 'Month' },
		{ value: 'year', label: 'Year' }
	];
	const categoryItems = $derived([
		{ value: '', label: 'All categories' },
		...data.categories.map((c) => ({ value: String(c.id), label: c.name }))
	]);

	const periodWord = $derived(
		data.period === 'week' ? 'weekly' : data.period === 'month' ? 'monthly' : 'yearly'
	);

	const rangeLabel = $derived.by(() => {
		if (data.period === 'month') {
			const a = monthLabel(`${data.from.slice(0, 7)}-01`);
			const b = monthLabel(`${data.to.slice(0, 7)}-01`);
			return a === b ? a : `${a} – ${b}`;
		}
		if (data.period === 'year') {
			const a = data.from.slice(0, 4);
			const b = data.to.slice(0, 4);
			return a === b ? a : `${a} – ${b}`;
		}
		const fmt = (iso: string) =>
			new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		return `${fmt(data.from)} – ${fmt(data.to)}`;
	});

	// --- Chart geometry ---
	const W = 720;
	const H = 320;
	const PAD_L = 56;
	const PAD_R = 12;
	const PAD_T = 16;
	const PAD_B = 32;
	const plotW = W - PAD_L - PAD_R;
	const plotH = H - PAD_T - PAD_B;

	// Leave headroom above the tallest bar: scale the raw max (spending or
	// budget, whichever is larger) by 1.25 and round up to a clean
	// 1/2/2.5/5 × 10^k value so the gridline labels stay tidy.
	function niceCeil(v: number): number {
		if (v <= 0) return 100;
		const exp = Math.floor(Math.log10(v));
		const f = v / 10 ** exp;
		const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
		return nice * 10 ** exp;
	}
	const maxSpent = $derived(Math.max(0, ...data.points.map((p) => p.spentCents)));
	const maxBudget = $derived(Math.max(0, ...data.points.map((p) => p.budgetCents ?? 0)));
	const maxVal = $derived(Math.max(100, niceCeil(1.25 * Math.max(maxSpent, maxBudget))));
	const n = $derived(data.points.length);
	const slotW = $derived(plotW / n);
	const barW = $derived(slotW * 0.55);

	const yOf = (v: number) => PAD_T + plotH * (1 - v / maxVal);
	const gridFracs = [0, 0.25, 0.5, 0.75, 1];

	const totalSpent = $derived(data.points.reduce((s, p) => s + p.spentCents, 0));
	const avgSpent = $derived(n > 0 ? Math.round(totalSpent / n) : 0);
	const anySpend = $derived(data.points.some((p) => p.spentCents > 0));

	// The budget can differ per point when a budget of one period is scaled
	// to the view period (e.g. a weekly budget viewed by month: 28-day vs
	// 31-day months). Equal values draw one straight line; varying values a
	// stepped one.
	const anyBudget = $derived(data.points.some((p) => p.budgetCents !== null));
	const budgetValues = $derived(
		data.points.map((p) => p.budgetCents).filter((v): v is number => v !== null)
	);
	const budgetUniform = $derived(
		budgetValues.length > 0 && budgetValues.every((v) => v === budgetValues[0])
	);
	const lastBudget = $derived(data.points.length ? data.points[data.points.length - 1].budgetCents ?? null : null);
	const uniformBudgetY = $derived(
		budgetValues.length > 0 && budgetUniform ? yOf(budgetValues[0]) : 0
	);
	const budgetLabel = $derived(
		budgetValues.length === 0
			? null
			: budgetUniform
				? `Budget ${compactMoney(budgetValues[0])}`
				: (() => {
						const lo = compactMoney(Math.min(...budgetValues));
						const hi = compactMoney(Math.max(...budgetValues));
						return lo === hi ? `Budget ${lo}` : `Budget ${lo}–${hi}`;
					})()
	);
	const budgetLabelY = $derived(
		budgetValues.length === 0
			? null
			: budgetUniform
				? yOf(budgetValues[0]) - 5
				: lastBudget === null
					? null
					: yOf(lastBudget) - 5
	);

	// Skip x-axis labels when slots are too narrow to fit them.
	const labelSkip = $derived(Math.max(1, Math.ceil(38 / slotW)));

	// Compact axis labels: $500.00 below $1k, $1.5k / $10k in the middle,
	// $1M+ at the top. (cents, not dollars — $1k is 100_000 cents.)
	function compactMoney(cents: number): string {
		if (cents >= 100000000) return `$${(cents / 100000000).toFixed(1).replace(/\.0$/, '')}M`;
		if (cents >= 100000) {
			const k = cents / 100000;
			return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
		}
		return formatMoney(cents);
	}
</script>

<Title title="Trends" />

<div class="mx-auto flex max-w-5xl flex-col gap-4 2xl:max-w-7xl">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Trends</h1>
			<p class="text-sm text-muted-foreground">
				Spending by {data.period}{data.categoryName ? ` for ${data.categoryName}` : ''}, with your
				{periodWord} budget line.
			</p>
		</div>
	</div>

	<form
		method="GET"
		bind:this={filterForm}
		class="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
	>
		<div class="flex w-52 flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">Category</span>
			<Select
				name="category"
				bind:value={selCategory}
				items={categoryItems}
				placeholder="All categories"
				onValueChange={() => {
					// The hidden input bits-ui renders for the form is flushed a tick
					// after this callback, so flush before submitting or the old value wins.
					flushSync();
					filterForm?.requestSubmit();
				}}
			/>
		</div>
		<div class="flex w-32 flex-col gap-1.5">
			<span class="text-xs font-medium text-muted-foreground">Period</span>
			<Select
				name="period"
				bind:value={selPeriod}
				items={periodItems}
				onValueChange={() => {
					flushSync();
					filterForm?.requestSubmit();
				}}
			/>
		</div>
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

	{#if !anySpend}
		<div class="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
			<p class="text-sm text-muted-foreground">
				No spending recorded in {rangeLabel}{data.categoryName ? ` for ${data.categoryName}` : ''}.
			</p>
		</div>
	{:else}
		<div class="rounded-lg border border-border bg-surface p-4">
			<svg viewBox="0 0 {W} {H}" width="100%" class="galene-chart w-full" style="width:100%;max-width:100%;height:auto" role="img" aria-label="Spending bar chart">
				{#each gridFracs as g}
					{@const y = PAD_T + plotH * g}
					{@const val = Math.round(maxVal * (1 - g))}
					<line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="var(--color-border)" stroke-width="1" />
					<text x={PAD_L - 8} y={y + 3.5} text-anchor="end" font-size="10" fill="var(--color-muted-foreground)">
						{compactMoney(val)}
					</text>
				{/each}

				{#each data.points as p, i (p.key)}
					{@const x = PAD_L + slotW * i + (slotW - barW) / 2}
					<!-- Split bar: the part at or under the budget line is the positive
						color, the part above it the negative color. -->
					{@const under = p.budgetCents === null ? p.spentCents : Math.min(p.spentCents, p.budgetCents)}
					{@const over = p.budgetCents === null ? 0 : Math.max(0, p.spentCents - p.budgetCents)}
					{@const hUnder = plotH * (under / maxVal)}
					{@const hOver = plotH * (over / maxVal)}
					{@const tip = `${p.label}: ${formatMoney(p.spentCents)}${
						p.budgetCents !== null ? ` (budget ${formatMoney(p.budgetCents)})` : ''}`}
					{#if hUnder > 0}
						<rect
							x={x}
							y={PAD_T + plotH - hUnder}
							width={barW}
							height={Math.max(hUnder, 2)}
							rx={over > 0 ? 0 : 2}
							fill="var(--color-success)"
						>
							<title>{tip}</title>
						</rect>
					{/if}
					{#if hOver > 0}
						<rect
							x={x}
							y={PAD_T + plotH - hUnder - hOver}
							width={barW}
							height={Math.max(hOver, 2)}
							rx="2"
							fill="var(--color-destructive)"
						>
							<title>{tip}</title>
						</rect>
					{/if}
					{#if p.spentCents > 0}
						<text
							x={x + barW / 2}
							y={PAD_T + plotH - hUnder - hOver - 5}
							text-anchor="middle"
							font-size="10"
							fill="var(--color-muted-foreground)"
						>
							{compactMoney(p.spentCents)}
						</text>
					{/if}
					{#if i % labelSkip === 0}
						<text
							x={PAD_L + slotW * i + slotW / 2}
							y={H - 12}
							text-anchor="middle"
							font-size="10"
							fill="var(--color-muted-foreground)"
						>
							{p.label}
						</text>
					{/if}
				{/each}

				{#if anyBudget}
					{#if budgetUniform}
						<line
							x1={PAD_L}
							x2={W - PAD_R}
							y1={uniformBudgetY}
							y2={uniformBudgetY}
							stroke="var(--color-foreground)"
							stroke-width="1.5"
							stroke-dasharray="6 4"
							opacity="0.7"
						/>
					{:else}
						{#each data.points as p, i (p.key)}
							{#if p.budgetCents !== null}
								<line
									x1={PAD_L + slotW * i}
									x2={PAD_L + slotW * (i + 1)}
									y1={yOf(p.budgetCents)}
									y2={yOf(p.budgetCents)}
									stroke="var(--color-foreground)"
									stroke-width="1.5"
									stroke-dasharray="6 4"
									opacity="0.7"
								/>
							{/if}
						{/each}
					{/if}
					{#if budgetLabel !== null && budgetLabelY !== null}
						<text
							x={W - PAD_R}
							y={budgetLabelY}
							text-anchor="end"
							font-size="10"
							fill="var(--color-foreground)"
							fill-opacity="0.7"
							stroke="var(--color-surface)"
							stroke-width="3"
							paint-order="stroke"
						>
							{budgetLabel}
						</text>
					{/if}
				{/if}
			</svg>

			<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
				<span class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-sm bg-success"></span> Within budget
				</span>
				<span class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-sm bg-destructive"></span> Over budget
				</span>
				{#if anyBudget}
					<span class="flex items-center gap-1.5">
						<span class="h-0 w-4 border-t-2 border-dashed border-foreground/70"></span>
						{periodWord} budget
					</span>
				{/if}
			</div>

			<p class="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
				Total spent: <span class="font-medium text-foreground">{formatMoney(totalSpent)}</span> · Average
				per {data.period}: <span class="font-medium text-foreground">{formatMoney(avgSpent)}</span>
			</p>
		</div>
	{/if}
</div>
