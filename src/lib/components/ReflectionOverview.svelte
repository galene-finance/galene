<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import ReflectTabs from './ReflectTabs.svelte';
 import {formatMoney,monthLabel} from '$lib/utils';
 import type {productActivity,productHistory} from '$lib/server/product';
 let {data}:{data:ReturnType<typeof productActivity>&{history:ReturnType<typeof productHistory>;view:string}}=$props();
 const query=$derived(data.scopeQuery??data.period.query);
 const scope=$derived(data.accounts.find(a=>a.id===data.accountId)?.name??'All accounts');
 const spending=$derived(data.summary.categories.filter(c=>c.type==='expense').sort((a,b)=>a.cents-b.cents));
 const maximum=$derived(Math.max(1,Math.abs(data.summary.incomeCents),Math.abs(data.summary.spendingCents)));
 const periodText=$derived(data.period.custom?`${data.period.from} – ${data.period.dateTo}`:monthLabel(data.period.month));
</script>
<ReflectTabs {query} current={data.view==='trends'?'trends':'summary'}/>
<p class="product-scope">{periodText} · {scope} · posted activity</p>
{#if data.summary.uncategorizedCount}<aside class="product-attention"><Badge label={`${data.summary.uncategorizedCount} to review`} tone="attention"/><span>Recorded totals are incomplete until this activity has categories.</span><a class="product-link" href={`/transactions?date_from=${data.period.from}&date_to=${data.period.dateTo}&empty=category&status=posted${data.accountId?`&account=${data.accountId}`:''}`}>Review</a></aside>{/if}
{#if data.view==='trends'}
 <section class="product-panel"><header class="product-panel-header"><div><h2>Income and spending over time</h2><p class="product-row-caption">Six full months through {monthLabel(data.period.dateTo)} · {scope}</p></div></header>
  <div class="product-table-wrap"><table class="product-table"><caption class="sr-only">Monthly posted income and spending; choose a month to see its contributions.</caption><thead><tr><th scope="col">Month</th><th scope="col" class="amount">Income</th><th scope="col" class="amount">Spending</th><th scope="col" class="amount secondary">Difference</th></tr></thead><tbody>{#each data.history as h}<tr><th scope="row"><a href={`/reflect?month=${h.month}${data.accountId?`&account=${data.accountId}`:''}`}>{monthLabel(h.month)}</a><small class="product-row-caption">{!h.postedCount?'No posted activity':h.uncategorizedCount?`${h.uncategorizedCount} need categories`:'Recorded activity'}</small></th><td class="amount">{h.postedCount?formatMoney(h.incomeCents):'—'}</td><td class="amount">{h.postedCount?formatMoney(h.spendingCents):'—'}</td><td class="amount secondary">{h.postedCount?formatMoney(h.incomeCents-h.spendingCents):'—'}</td></tr>{/each}</tbody></table></div>
  <footer class="product-details">Full calendar months, not just the custom summary range. Missing history is not proof of no spending. Choose a month for its recorded contributions.</footer>
 </section>
{:else}
 <div class="product-columns"><section class="product-panel"><header class="product-panel-header"><h2>Income vs spending</h2></header>
  {#if data.summary.postedCount}
   <div class="product-panel-body"><a class="product-report-line" href={`/income?${query}`}><strong>Income</strong><Badge value={formatMoney(data.summary.incomeCents)} label={data.summary.incomeCents<0?'Net reversal':'Posted income'} tone={data.summary.incomeCents<0?'negative':data.summary.incomeCents>0?'positive':'neutral'}/></a><div class="product-bar-track" aria-hidden="true"><div class="product-bar-fill" style:width={`${Math.abs(data.summary.incomeCents)/maximum*100}%`} style:background={data.summary.incomeCents<0?'var(--destructive)':'var(--success)'}></div></div>
   <a class="product-report-line" href={`/spending?${query}`}><strong>Spending</strong><Badge value={formatMoney(data.summary.spendingCents)} label={data.summary.spendingCents<0?'Net refunds':'After refunds'} tone={data.summary.spendingCents<0?'positive':'neutral'}/></a><div class="product-bar-track" aria-hidden="true"><div class="product-bar-fill" style:width={`${Math.abs(data.summary.spendingCents)/maximum*100}%`} style:background="var(--muted-foreground)"></div></div></div>
   <div class="product-row"><strong>Income less spending</strong><Badge value={formatMoney(data.summary.netCents)} label={data.summary.netCents<0?'Recorded shortfall':'Recorded difference'} tone={data.summary.netCents<0?'negative':'neutral'}/></div>
  {:else}<div class="product-empty"><strong>No posted activity in this period</strong><p>Choose another month or review your account activity.</p><a class="product-link" href="/transactions">View activity</a></div>{/if}
  <footer class="product-details">{data.summary.pendingCount} pending records excluded. This difference is not available cash. Transfers, card payments and forecast wages do not become spending or earnings.</footer>
 </section><section class="product-panel"><header class="product-panel-header"><h2>Spending by category</h2><a href={`/spending?${query}`}>Breakdown</a></header>
  {#if spending.length}<ul class="product-list">{#each spending.slice(0,7) as c}<li><a class="product-row" href={`/categories/${c.id}?${query}`}><div class="product-row-main"><Badge label={c.name}/><span class="product-row-caption">{periodText} · {c.count} recorded contributions</span></div><Badge value={formatMoney(-c.cents)} label={c.cents>0?'Net refunds':'After refunds'} tone={c.cents>0?'positive':'neutral'}/></a></li>{/each}</ul>{:else}<div class="product-empty"><strong>No categorized spending here yet</strong><p>Categories connect the report to its underlying activity.</p><a class="product-link" href="/transactions">Review activity</a></div>{/if}
 </section></div>
{/if}
