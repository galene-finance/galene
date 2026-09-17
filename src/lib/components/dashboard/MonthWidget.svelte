<script lang="ts">
	import { formatMoney } from '$lib/utils';
	import type { DashboardWidgetData } from '$lib/types';

	type Data = Extract<DashboardWidgetData, { kind: 'month' }>;
	let { data }: { data: Data } = $props();
</script>

<div class="flex items-baseline justify-between gap-2">
	<div class="min-w-0">
		<p class="text-xs text-muted-foreground">Income</p>
		<p class="truncate text-lg font-semibold text-success">{formatMoney(data.incomeCents)}</p>
	</div>
	<div class="min-w-0 text-right">
		<p class="text-xs text-muted-foreground">Expenses</p>
		<p class="truncate text-lg font-semibold">{formatMoney(data.expenseCents)}</p>
	</div>
</div>

<div class="mt-2 flex items-baseline justify-between gap-2 border-t border-border pt-2">
	<p class="text-xs text-muted-foreground">Net</p>
	<p class="truncate text-sm font-semibold {data.netCents < 0 ? 'text-destructive' : 'text-success'}">
		{formatMoney(data.netCents)}
	</p>
</div>

<p class="mt-2 text-xs text-muted-foreground">
	Last month ({data.prevLabel}): {formatMoney(data.prevIncomeCents)} in, {formatMoney(data.prevExpenseCents)} out
</p>
