<script lang="ts">
 import type { PageData } from './$types';
 import Title from '$lib/components/Title.svelte';
 import PeriodPicker from '$lib/components/PeriodPicker.svelte';
 import {formatMoney,monthLabel} from '$lib/utils';
 import {scheduleKind} from '$lib/activity';
 let {data}:{data:PageData}=$props();
 const spending=$derived(data.summary.categories.filter(c=>c.type==='expense').sort((a,b)=>a.cents-b.cents).slice(0,5));
 const maxSpend=$derived(Math.max(1,...spending.map(c=>Math.abs(c.cents))));
 const recent=$derived([...data.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id).slice(0,6));
 const periodQuery=$derived(data.period.query);
 const activityQuery=$derived(`date_from=${data.period.from}&date_to=${data.period.dateTo}`);
</script>
<Title title="Overview"/>
<div class="product-page">
 <header class="product-heading"><div><h1>Your finances, at a glance</h1><p>A little clarity for the month ahead.</p></div><a class="product-button" href="/transactions">Review activity</a></header>
 <PeriodPicker month={data.period.month}/>
 <section class="product-summary" aria-label={monthLabel(data.period.from)}>
  <a href={`/income?${periodQuery}`}><span class="metric-label">Income</span><strong class="metric-value">{formatMoney(data.summary.incomeCents)}</strong><span class="metric-context">Received · {monthLabel(data.period.from)}</span></a>
  <a href={`/spending?${periodQuery}`}><span class="metric-label">Spending</span><strong class="metric-value">{formatMoney(data.summary.spendingCents)}</strong><span class="metric-context">Categorized purchases, less refunds</span></a>
  <a href={`/cashflow?from=${data.period.from}&to=${data.period.dateTo}`}><span class="metric-label">Income less spending</span><strong class="metric-value">{formatMoney(data.summary.netCents)}</strong><span class="metric-context">{data.summary.uncategorizedCount?'Not complete yet — activity needs a category':'Not your available bank balance'}</span></a>
 </section>
 {#if data.summary.uncategorizedCount>0}<div class="product-attention"><span><strong>{data.summary.uncategorizedCount} transactions need a category.</strong> Review them to complete this month’s picture.</span><a class="product-link" href={`/transactions?empty=category&${activityQuery}`}>Review transactions →</a></div>{/if}
 <div class="product-columns"><div>
  <section class="product-panel"><header class="product-panel-header"><h2>Where your money went</h2><a href={`/spending?${periodQuery}`}>Explore spending</a></header>
   {#if spending.length}<div class="product-panel-body"><ul class="product-bars">{#each spending as c}<li><a href={`/categories/${c.id}?${periodQuery}`}><div class="product-bar-caption"><span>{c.name}</span><strong>{formatMoney(-c.cents)}</strong></div><div class="product-bar-track" aria-hidden="true"><div class="product-bar-fill" style:width={`${Math.min(100,Math.abs(c.cents)/maxSpend*100)}%`}></div></div></a></li>{/each}</ul></div>{:else}<div class="product-empty"><strong>No categorized spending yet</strong><p>Choose categories for your activity to see your spending here.</p><a class="product-link" href={`/transactions?${activityQuery}`}>Review activity</a></div>{/if}
  </section>
  <section class="product-panel"><header class="product-panel-header"><h2>Recent activity</h2><a href={`/transactions?${activityQuery}`}>See all activity</a></header><ul class="product-list">{#each recent as t}<li><a class="product-row" href={`/transactions/${t.id}?${periodQuery}`}><span class="product-row-main"><span class="product-row-title">{t.merchant||'Transaction'}</span><span class="product-row-caption">{t.account_name} · {t.category_name||'Needs a category'}</span></span><span class="product-row-value">{formatMoney(t.amount_cents)}<small>{t.pending?'Pending':t.date}</small></span></a></li>{:else}<li class="product-empty"><strong>No activity in this month</strong><p>Choose another month or check your account connections.</p><a class="product-link" href="/accounts">View accounts</a></li>{/each}</ul></section>
 </div><div>
  <section class="product-panel"><header class="product-panel-header"><h2>Coming up</h2><a href="/scheduled">Manage recurring</a></header><ul class="product-list">{#each data.upcoming.slice(0,5) as item}{@const s=item.scheduled}{@const type=data.categories.find(c=>c.id===s.category_id)?.type}<li><a class="product-row" href={`/scheduled?edit=${s.id}`}><span class="product-row-main"><span class="product-row-title">{s.name}</span><span class="product-row-caption">{scheduleKind(s.amount_cents,type)} · {item.date}</span></span><span class="product-row-value">{formatMoney(s.amount_cents)}</span></a></li>{:else}<li class="product-empty"><strong>Nothing scheduled in the next 45 days</strong><p>Add expected pay and bills to plan ahead.</p><a href="/scheduled" class="product-link">Add a recurring item</a></li>{/each}</ul><div class="product-details">Expectations only. No payment is sent automatically.</div></section>
  <section class="product-panel"><header class="product-panel-header"><h2>Your accounts</h2><a href="/accounts">See all accounts</a></header><ul class="product-list">{#each data.accounts.filter(a=>a.type==='bank'||a.type==='cash') as a}<li><a class="product-row" href={`/accounts/${a.id}`}><span class="product-row-main"><span class="product-row-title">{a.name}</span><span class="product-row-caption">{a.source}</span></span><span class="product-row-value">{a.displayCents===null?'Not available':formatMoney(a.displayCents)}</span></a></li>{:else}<li class="product-empty">No cash accounts to show.</li>{/each}</ul><div class="product-details"><a class="product-link" href="/accounts">Cards, loans and balance details →</a></div></section>
 </div></div>
 <details class="product-panel product-details"><summary>How these numbers work</summary><p>Income and spending use posted, categorized activity in the selected month. Transfers and card payments aren’t earnings or spending. Refunds reduce spending; income reversals reduce income. Uncategorized and pending transactions aren’t included. Linked accounts show their reported bank balance; manual accounts show the working balance already recorded. Details and dates are available on each account.</p><p><a href="/customize" class="product-link">Open customizable widgets</a></p></details>
</div>
