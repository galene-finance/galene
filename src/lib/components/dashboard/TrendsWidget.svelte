<script lang="ts">
	import { formatMoney, monthLabel } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'trends' }>;
	let { data }: { data: Data } = $props();

	// Compact version of the trends page chart: same scale/label helpers,
	// no budget line, smaller canvas.
	const W = 720;
	const H = 240;
	const PAD_L = 48;
	const PAD_R = 8;
	const PAD_T = 16;
	const PAD_B = 28;
	const plotW = W - PAD_L - PAD_R;
	const plotH = H - PAD_T - PAD_B;

	function niceCeil(v: number): number {
		if (v <= 0) return 100;
		const exp = Math.floor(Math.log10(v));
		const f = v / 10 ** exp;
		const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
		return nice * 10 ** exp;
	}

	function compactMoney(cents: number): string {
		if (cents >= 100000000) return `$${(cents / 100000000).toFixed(1).replace(/\.0$/, '')}M`;
		if (cents >= 100000) {
			const k = cents / 100000;
			return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
		}
		return formatMoney(cents);
	}

	const maxSpent = $derived(Math.max(0, ...data.points.map((p) => p.spentCents)));
	const maxVal = $derived(Math.max(100, niceCeil(1.25 * maxSpent)));
	const n = $derived(data.points.length);
	const slotW = $derived(plotW / n);
	const barW = $derived(slotW * 0.55);
	const gridFracs = [0, 0.25, 0.5, 0.75, 1];
	const labelSkip = $derived(Math.max(1, Math.ceil(38 / slotW)));
	const total = $derived(data.points.reduce((s, p) => s + p.spentCents, 0));
	const anySpend = $derived(data.points.some((p) => p.spentCents > 0));
</script>

{#if !anySpend}
	<p class="text-sm text-muted-foreground">No spending recorded in the last {data.months} months.</p>
{:else}
	<svg viewBox="0 0 {W} {H}" class="w-full" role="img" aria-label="Monthly spending bar chart">
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
			{@const h = plotH * (p.spentCents / maxVal)}
			<rect
				x={x}
				y={PAD_T + plotH - Math.max(h, 2)}
				width={barW}
				height={Math.max(h, 2)}
				rx="2"
				fill="var(--color-success)"
			>
				<title>{monthLabel(p.key)}: {formatMoney(p.spentCents)}</title>
			</rect>
			{#if p.spentCents > 0 && slotW >= 44}
				<text
					x={x + barW / 2}
					y={PAD_T + plotH - Math.max(h, 2) - 5}
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
					y={H - 10}
					text-anchor="middle"
					font-size="10"
					fill="var(--color-muted-foreground)"
				>
					{p.label}
				</text>
			{/if}
		{/each}
	</svg>
	<p class="mt-2 text-xs text-muted-foreground">
		Total: <span class="font-medium text-foreground">{formatMoney(total)}</span>
	</p>
{/if}
