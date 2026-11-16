<script lang="ts">
 import { formatMoney } from '$lib/utils';
 import { comparisonWidth } from '$lib/financePresentation';
 import type { DashboardWidgetData } from '$lib/types';
 type Data = Extract<DashboardWidgetData, {kind:'month'}>;
 let { data }: {data: Data} = $props();
 const maximum = $derived(Math.max(data.incomeCents, data.expenseCents, 0));
</script>
<div class="month-overview">
 <div class="month-net"><div><p class="finance-eyebrow">{data.label} · recorded net</p><p class="finance-amount" class:text-destructive={data.netCents < 0}>{formatMoney(data.netCents)}</p></div><a href="/cashflow" class="finance-link">Cash flow ↗</a></div>
 <div class="comparison-row"><div><span>Income</span><strong>{formatMoney(data.incomeCents)}</strong></div><div class="comparison-track" aria-hidden="true"><span style:width="{comparisonWidth(data.incomeCents,maximum)}%" style:background="var(--primary)"></span></div></div>
 <div class="comparison-row"><div><span>Expenses</span><strong>{formatMoney(data.expenseCents)}</strong></div><div class="comparison-track" aria-hidden="true"><span style:width="{comparisonWidth(data.expenseCents,maximum)}%" style:background="var(--muted-foreground)"></span></div></div>
 <p class="finance-caption">Income minus expenses, not available cash. {data.prevLabel}: {formatMoney(data.prevIncomeCents)} in / {formatMoney(data.prevExpenseCents)} out.</p>
</div>
