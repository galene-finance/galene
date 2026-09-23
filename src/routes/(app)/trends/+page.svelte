<script lang="ts">
	import { flushSync } from 'svelte';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DatePicker from '$lib/components/ui/DatePicker.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { budgetLinePoints, budgetPolyline, inclusiveEnd, type TrendPoint } from '$lib/trendsChart';
	import { formatMoney, monthLabel } from '$lib/utils';
	import type { TrendDrillRow } from '$lib/trendDrill';
	import type { Category } from '$lib/types';

	let { data }: {
		data: {
			categoryId: number | null;
			categoryName: string | null;
			period: 'week' | 'month' | 'year';
			from: string;
			to: string;
			points: TrendPoint[];
			categories: Category[];
			drillTransactions: TrendDrillRow[];
			hasBudget: boolean;
			avgSpentCents: number;
			categoryType: 'expense' | 'income' | 'transfer' | null;
		};
	} = $props();

	// --- Filter form (URL-driven) ---
	// Full-page navigation on submit, so the initial value is always the URL's.
	let filterForm = $state<HTMLFormElement | null>(null);
	// untrack is the first paint only. The effect below applies the next URL.
	let selCategory = $state(untrack(() => String(data.categoryId ?? '')));
	let selPeriod = $state(untrack(() => data.period));
	let selFrom = $state(untrack(() => data.from));
	let selTo = $state(untrack(() => data.to));

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

	const anyBudget = $derived(data.points.some((p) => p.budgetCents !== null));
	const lineVerts = $derived(
		budgetLinePoints(
			data.points,
			(i) => PAD_L + slotW * i + slotW / 2,
			yOf
		)
	);

	let bar = $state<TrendPoint | null>(null);
	let barOpen = $state(false);

	function openBar(p: TrendPoint) {
		bar = p;
		barOpen = true;
	}

	// Mouse hover shows the amount. Touch toggles it. Keyboard focus shows it
	// without a hover. Nothing here locks page scroll.
	let tip = $state<{ key: string; text: string; left: number; top: number } | null>(null);

	function placeTip(el: Element, p: TrendPoint) {
		if (p.budgetCents === null) return;
		const rect = el.getBoundingClientRect();
		const width = 148;
		let left = rect.right + 8;
		if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 8);
		tip = {
			key: p.key,
			text: `${p.label} · ${formatMoney(p.budgetCents)}`,
			left,
			top: rect.top + rect.height / 2
		};
	}

	function onDotEnter(e: PointerEvent, p: TrendPoint) {
		if (e.pointerType !== 'mouse') return;
		if (e.currentTarget instanceof Element) placeTip(e.currentTarget, p);
	}

	function onDotLeave(e: PointerEvent) {
		if (e.pointerType === 'mouse') tip = null;
	}

	function onDotPointerDown(e: PointerEvent, p: TrendPoint) {
		if (e.pointerType === 'mouse') return;
		e.preventDefault();
		e.stopPropagation();
		if (tip?.key === p.key) {
			tip = null;
			return;
		}
		if (e.currentTarget instanceof Element) placeTip(e.currentTarget, p);
	}

	function onDotFocus(e: FocusEvent, p: TrendPoint) {
		if (!(e.currentTarget instanceof Element) || !e.currentTarget.matches(':focus-visible')) return;
		placeTip(e.currentTarget, p);
	}

	function onDotKeydown(e: KeyboardEvent, p: TrendPoint) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		if (e.currentTarget instanceof Element) placeTip(e.currentTarget, p);
	}

	$effect(() => {
		if (!tip || typeof window === 'undefined') return;
		const close = (e: Event) => {
			const target = e.target;
			if (target instanceof Element && target.closest('[data-budget-dot]')) return;
			tip = null;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') tip = null;
		};
		const onScroll = () => {
			tip = null;
		};
		window.addEventListener('pointerdown', close);
		window.addEventListener('keydown', onKey);
		window.addEventListener('scroll', onScroll, true);
		return () => {
			window.removeEventListener('pointerdown', close);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', onScroll, true);
		};
	});

	const barRows = $derived.by(() => {
		const p = bar;
		if (!p) return [];
		return data.drillTransactions
			.filter((r) => r.date >= p.from && r.date < p.to && r.amountCents < 0)
			.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	});

	function barTransactionsHref(p: TrendPoint): string {
		const params = new URLSearchParams();
		if (data.categoryId != null) params.set('category', String(data.categoryId));
		params.set('date_from', p.from);
		params.set('date_to', inclusiveEnd(p.to));
		const q = params.toString();
		return q ? `/transactions?${q}` : '/transactions';
	}

	const canCreateBudget = $derived(
		data.categoryId != null && data.categoryType !== 'transfer' && !data.hasBudget && data.avgSpentCents > 0
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
							class="pointer-events-none"
						/>
					{/if}
					{#if hOver > 0}
						<rect
							x={x}
							y={PAD_T + plotH - hUnder - hOver}
							width={barW}
							height={Math.max(hOver, 2)}
							rx="2"
							fill="var(--color-destructive)"
							class="pointer-events-none"
						/>
					{/if}
					{#if p.spentCents > 0}
						<text
							x={x + barW / 2}
							y={PAD_T + plotH - hUnder - hOver - 5}
							text-anchor="middle"
							font-size="10"
							fill="var(--color-muted-foreground)"
							class="pointer-events-none"
						>
							{compactMoney(p.spentCents)}
						</text>
					{/if}
					<rect
						x={x}
						y={PAD_T}
						width={barW}
						height={plotH}
						fill="transparent"
						class="cursor-pointer"
						role="button"
						tabindex="0"
						aria-label={tip}
						onclick={() => openBar(p)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								openBar(p);
							}
						}}
					>
						<title>{tip}</title>
					</rect>
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

				{#if anyBudget && lineVerts.length > 0}
					<polyline
						points={budgetPolyline(lineVerts)}
						fill="none"
						stroke="var(--color-foreground)"
						stroke-width="1"
						stroke-linejoin="round"
						stroke-linecap="round"
						opacity="0.85"
					/>
					{#each data.points as p, i (p.key)}
						{#if p.budgetCents !== null}
							{@const cx = PAD_L + slotW * i + slotW / 2}
							{@const cy = yOf(p.budgetCents)}
							<circle
								cx={cx}
								cy={cy}
								r="10"
								fill="transparent"
								class="cursor-pointer"
								data-budget-dot
								role="button"
								tabindex="0"
								aria-label="{p.label} budget {formatMoney(p.budgetCents)}"
								onpointerenter={(e) => onDotEnter(e, p)}
								onpointerleave={onDotLeave}
								onpointerdown={(e) => onDotPointerDown(e, p)}
								onfocus={(e) => onDotFocus(e, p)}
								onblur={() => (tip = null)}
								onkeydown={(e) => onDotKeydown(e, p)}
								onclick={(e) => e.stopPropagation()}
							/>
							<circle
								cx={cx}
								cy={cy}
								r="2.5"
								fill="var(--color-foreground)"
								opacity="0.9"
								class="pointer-events-none"
							/>
						{/if}
					{/each}
				{/if}
			</svg>
		{#if tip}
			<div
				class="pointer-events-none fixed z-40 max-w-[9rem] -translate-y-1/2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-md"
				style:left="{tip.left}px"
				style:top="{tip.top}px"
				role="tooltip"
			>
				{tip.text}
			</div>
		{/if}

			<div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
				<span class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-sm bg-success"></span> Within budget
				</span>
				<span class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-sm bg-destructive"></span> Over budget
				</span>
				{#if anyBudget}
					<span class="flex items-center gap-1.5">
						<span class="h-0 w-4 border-t-2 border-foreground/70"></span>
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
	{#if canCreateBudget}
		<form method="POST" action="?/create-budget" class="flex flex-wrap items-center gap-3">
			<input type="hidden" name="category_id" value={data.categoryId} />
			<input type="hidden" name="period" value={data.period} />
			<input type="hidden" name="limit_cents" value={data.avgSpentCents} />
			<Button type="submit" variant="secondary">
				Create {periodWord} budget at {formatMoney(data.avgSpentCents)}
			</Button>
			<p class="text-xs text-muted-foreground">Average spent per {data.period} in this range.</p>
		</form>
	{/if}
</div>

<Dialog
	bind:open={barOpen}
	size="md"
	title={bar ? `${bar.label} · ${formatMoney(bar.spentCents)}` : 'Transactions'}
	description="Transactions that make up this bar."
>
	{#if bar}
		<div class="flex flex-col gap-4">
			{#if barRows.length === 0}
				<p class="text-sm text-muted-foreground">No transactions in this period.</p>
			{:else}
				<ul class="divide-y divide-border rounded-md border border-border">
					{#each barRows as row (row.id)}
						<li class="flex items-center gap-3 px-3 py-2 text-sm">
							<span class="w-20 shrink-0 text-muted-foreground">
								{new Date(row.date + 'T12:00:00').toLocaleDateString('en-US', {
									month: 'short',
									day: 'numeric'
								})}
							</span>
							<span class="min-w-0 flex-1 truncate">{row.label}</span>
							<span class="shrink-0 font-medium">{formatMoney(row.amountCents)}</span>
						</li>
					{/each}
					<li class="flex items-center justify-between px-3 py-2 text-sm font-medium">
						<span>Total</span>
						<span>{formatMoney(bar.spentCents)}</span>
					</li>
				</ul>
			{/if}
			<a class="text-sm text-primary hover:underline" href={barTransactionsHref(bar)}>
				View on Transactions
			</a>
		</div>
	{/if}
</Dialog>
