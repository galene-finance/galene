<script lang="ts">
 import { formatMoney, monthLabel } from '$lib/utils';
 import { comparisonWidth } from '$lib/financePresentation';
 import type { DashboardWidgetData } from '$lib/types';
 type Data = Extract<DashboardWidgetData, {kind:'trends'}>;
 let { data }: {data: Data} = $props();
 const maximum = $derived(Math.max(0,...data.points.map(p => p.spentCents)));
 const total = $derived(data.points.reduce((s,p) => s + p.spentCents,0));
</script>
{#if !data.points.length || !maximum}
 <div class="finance-empty"><strong>No recorded spending to chart</strong><p>Imported or entered expenses will appear here. Missing history is not a forecast.</p><a href="/transactions">Review transactions ↗</a></div>
{:else}
 <div class="trend-summary"><div><p class="finance-eyebrow">Recorded spending · {data.months} months</p><p class="finance-amount">{formatMoney(total)}</p></div><a class="finance-link" href="/trends">Details ↗</a></div>
 <ul class="trend-bars" aria-label="Monthly recorded spending">
 {#each data.points as point (point.key)}
  <li><div><span>{monthLabel(point.key)}</span><strong>{formatMoney(point.spentCents)}</strong></div><div class="comparison-track" aria-hidden="true"><span style:width="{comparisonWidth(point.spentCents,maximum)}%"></span></div></li>
 {/each}
 </ul>
 <p class="finance-caption mt-4">Based on recorded transactions only. Zero may mean no imported history; the current month is partial.</p>
{/if}
