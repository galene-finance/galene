<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'budgets' }>;
	let { data }: { data: Data } = $props();
</script>

{#if data.items.length === 0}
	<p class="text-sm text-muted-foreground">
		No budgets match. Add one on the
		<a href="/budget" class="text-primary underline underline-offset-2">Budget</a> page.
	</p>
{:else}
	<ul class="flex flex-col gap-3">
		{#each data.items as b (b.id)}
			{@const over = b.spentCents > b.limitCents}
			{@const pct = Math.min(100, Math.round((b.spentCents / Math.max(1, b.limitCents)) * 100))}
			<li>
				<div class="mb-1 flex min-w-0 items-center justify-between gap-2 text-sm">
					<span class="flex min-w-0 items-center gap-2">
						<span class="size-2.5 shrink-0 rounded-full" style="background: {b.categoryColor ?? 'transparent'}"></span>
						<span class="truncate">{b.categoryName}</span>
					</span>
					<span class="shrink-0 text-xs capitalize text-muted-foreground">{b.period}</span>
				</div>
				<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full {over ? 'bg-destructive' : 'bg-primary'}" style="width: {pct}%"></div>
				</div>
				<p class="mt-1 truncate text-xs text-muted-foreground">
					<span class="font-medium {over ? 'text-destructive' : 'text-foreground'}">{formatMoney(b.spentCents)}</span>
					of {formatMoney(b.limitCents)}{#if over} · over by {formatMoney(b.spentCents - b.limitCents)}{/if}
				</p>
			</li>
		{/each}
	</ul>
{/if}
