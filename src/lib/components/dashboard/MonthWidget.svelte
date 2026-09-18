<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'month' }>;
	let { data }: { data: Data } = $props();
</script>

<div class="flex min-w-0 items-baseline justify-between gap-2">
	<div class="min-w-0 flex-1">
		<p class="truncate text-xs text-muted-foreground">Income</p>
		<p class="truncate text-lg font-semibold text-success">{formatMoney(data.incomeCents)}</p>
	</div>
	<div class="min-w-0 flex-1 text-right">
		<p class="truncate text-xs text-muted-foreground">Expenses</p>
		<p class="truncate text-lg font-semibold">{formatMoney(data.expenseCents)}</p>
	</div>
</div>

<div class="mt-2 flex min-w-0 items-baseline justify-between gap-2 border-t border-border pt-2">
	<p class="shrink-0 text-xs text-muted-foreground">Net</p>
	<p class="min-w-0 truncate text-sm font-semibold {data.netCents < 0 ? 'text-destructive' : 'text-success'}">
		{formatMoney(data.netCents)}
	</p>
</div>

<p class="mt-2 truncate text-xs text-muted-foreground" title="Last month ({data.prevLabel}): {formatMoney(data.prevIncomeCents)} in, {formatMoney(data.prevExpenseCents)} out">
	Last month ({data.prevLabel}): {formatMoney(data.prevIncomeCents)} in, {formatMoney(data.prevExpenseCents)} out
</p>
