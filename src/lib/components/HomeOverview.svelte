<script lang="ts">
 import Balance from './AccountBalance.svelte';
 import Badge from './FinancialBadge.svelte';
 import { formatMoney, formatDate, monthLabel } from '$lib/utils';
 import type { productOverview } from '$lib/server/product';
 let { data }: { data: ReturnType<typeof productOverview> } = $props();
 const query=$derived(data.scopeQuery??data.period.query);
 const account=$derived(data.accounts.find(a=>a.id===data.accountId));
 const periodText=$derived(data.period.custom?`${data.period.from} – ${data.period.dateTo}`:monthLabel(data.period.month));
 const payments=$derived(data.upcoming.filter(o=>o.scheduled.amount_cents<0).slice(0,5));
 const reviewHref=$derived(`/transactions?date_from=${data.period.from}&date_to=${data.period.dateTo}&empty=category&status=posted${data.accountId?`&account=${data.accountId}`:''}`);
</script>

{#if data.summary.uncategorizedCount>0}
 <aside class="product-attention" aria-label="Activity to review"><Badge label={`${data.summary.uncategorizedCount} to review`} tone="attention"/><span>Some activity needs a category. Recorded totals are incomplete.</span><a class="product-link" href={reviewHref}>Review</a></aside>
{/if}
<div class="product-columns">
 <div>
  <section class="product-panel">
   <header class="product-panel-header"><div><h2>Cost to be me</h2><p class="product-row-caption">Your current monthly targets · all accounts</p></div>{#if data.plan.totalCents!==null}<Badge value={formatMoney(data.plan.totalCents)} label="Monthly plan"/>{:else}<Badge label={data.plan.needsReview?'Review targets':'No monthly targets'} tone={data.plan.needsReview?'attention':'neutral'}/>{/if}</header>
   <div class="product-panel-body"><p class="product-muted">Review your targets, then adjust what needs to change.</p><a class="product-button primary" href="/budget">{data.plan.targetIds.length?'Edit monthly plan':'Build your plan'}</a></div>
   <footer class="product-details">{data.plan.targetIds.length} monthly targets. {#if data.plan.otherCadenceCount}{data.plan.otherCadenceCount} limits with other cadences are separate. {/if}This is a plan, not money available.</footer>
  </section>
  <section class="product-panel">
   <header class="product-panel-header"><div><h2>Reflect</h2><p class="product-row-caption">{periodText} · {account?.name??'All accounts'} · posted activity</p></div><a href={`/reflect?${query}`}>Explore reports</a></header>
   <a class="product-row" href={`/income?${query}`}><div class="product-row-main"><strong class="product-row-title">Income</strong><span class="product-row-caption">Recorded earnings, less reversals</span></div><Badge value={formatMoney(data.summary.incomeCents)} label={data.summary.incomeCents<0?'Net reversal':'Posted income'} tone={data.summary.incomeCents<0?'negative':data.summary.incomeCents>0?'positive':'neutral'}/></a>
   <a class="product-row" href={`/spending?${query}`}><div class="product-row-main"><strong class="product-row-title">Spending</strong><span class="product-row-caption">Categorized purchases, less refunds</span></div><Badge value={formatMoney(data.summary.spendingCents)} label={data.summary.spendingCents<0?'Net refunds':'After refunds'} tone={data.summary.spendingCents<0?'positive':'neutral'}/></a>
   <div class="product-row"><div class="product-row-main"><strong class="product-row-title">Income less spending</strong><span class="product-row-caption">{data.summary.pendingCount} pending records excluded</span></div><Badge value={formatMoney(data.summary.netCents)} label={data.summary.netCents<0?'Recorded shortfall':'Recorded difference'} tone={data.summary.netCents<0?'negative':'neutral'}/></div>
   <footer class="product-details">This is not an available bank balance. Transfers and card payments are not new spending.</footer>
  </section>
  <section class="product-panel">
   <header class="product-panel-header"><h2>Recent activity</h2><a href={`/transactions?date_from=${data.period.from}&date_to=${data.period.dateTo}${data.accountId?`&account=${data.accountId}`:''}`}>View activity</a></header>
   {#if data.transactions.length}<ul class="product-list">{#each data.transactions.slice(0,6) as tx}<li><a class="product-row" href={`/transactions/${tx.id}`}><div class="product-row-main"><strong class="product-row-title">{tx.merchant||'Transaction'}</strong><span class="product-row-caption">{formatDate(tx.date)} · {tx.category_name??(tx.splits?.length?'Split transaction':'Needs category')}</span></div><Badge value={formatMoney(tx.amount_cents)} label={tx.pending?'Pending':'Recorded'} tone={tx.pending?'attention':'neutral'}/></a></li>{/each}</ul>{:else}<div class="product-empty"><strong>No activity in this period</strong><p>Choose another month, or view your accounts.</p><a class="product-link" href="/accounts">View accounts</a></div>{/if}
  </section>
 </div>
 <div>
  <section class="product-panel"><header class="product-panel-header"><h2>Next payments</h2><a href="/scheduled">View schedules</a></header>
   {#if payments.length}<ul class="product-list">{#each payments as o}<li><a class="product-row" href={`/calendar?date=${o.date}`}><div class="product-row-main"><strong class="product-row-title">{o.scheduled.name}</strong><span class="product-row-caption">{formatDate(o.date)} · {data.accounts.find(a=>a.id===o.scheduled.account_id)?.name??'No account selected'}</span></div><Badge value={formatMoney(Math.abs(o.scheduled.amount_cents))} label="Expected"/></a></li>{/each}</ul>{:else}<div class="product-empty"><strong>No upcoming payments saved</strong><p>Review your schedules to keep expectations current.</p><a class="product-link" href="/scheduled">Manage schedules</a></div>{/if}
   <footer class="product-details">All accounts · next 45 days. Scheduled expectations, not completed payments.</footer>
  </section>
  <section class="product-panel"><header class="product-panel-header"><h2>Accounts</h2><a href="/accounts">View all</a></header>
   {#if data.accounts.length}<ul class="product-list">{#each data.accounts.slice(0,5) as a}<li><a class="product-row" href={`/accounts/${a.id}`}><div class="product-row-main"><strong class="product-row-title">{a.name}</strong><span class="product-row-caption">{a.asOf?formatDate(a.asOf.slice(0,10)):'Date unavailable'} · {a.source}</span></div><Balance account={a}/></a></li>{/each}</ul>{:else}<div class="product-empty"><strong>No accounts here yet</strong><a class="product-link" href="/accounts">Manage accounts</a></div>{/if}
   <footer class="product-details">Balances use the sources shown above. Working balances are estimates.</footer>
  </section>
 </div>
</div>
