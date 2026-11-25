<script lang="ts">
 import type {productCategory} from '$lib/server/productInsights';
 import PeriodPicker from './PeriodPicker.svelte';
 import ContributionList from './ContributionList.svelte';
 import Badge from './FinancialBadge.svelte';
 import {formatMoney,formatDate,monthLabel} from '$lib/utils';
 let {data}:{data:ReturnType<typeof productCategory>}=$props();
 const expense=$derived(data.category.type==='expense');
 const query=$derived(`category=${data.category.id}&date_from=${data.period.from}&date_to=${data.period.dateTo}&status=posted${data.accountId?`&account=${data.accountId}`:''}`);
 const net=$derived(expense?-data.totalCents:data.totalCents);
 const label=$derived(expense?'Net spending':data.category.type==='income'?'Net income':'Net movement');
</script>
<div class="product-page"><a class="product-breadcrumb" href="/budget">← Plan</a><header class="product-heading"><div><h1>{data.category.name}</h1><p>{data.category.type==='income'?'Income and reversals':data.category.type==='transfer'?'Money moved, not new earnings or spending':'Spending and refunds'} · {data.period.custom?`${formatDate(data.period.from)} – ${formatDate(data.period.dateTo)}`:monthLabel(data.period.from)}</p></div><a class="product-button" href={`/transactions?${query}`}>Open full register</a></header>
<PeriodPicker month={data.period.month} path={`/categories/${data.category.id}`} accountId={data.accountId??null}/>
<section class="product-panel"><header class="product-panel-header"><div><h2>{label}</h2><p class="product-muted">Posted activity · matching split portions only{data.accountId?' · selected account':''}</p></div><Badge value={data.contributions.length?formatMoney(net):undefined} label={data.contributions.length?label:'No posted activity'} tone={data.category.type==='transfer'?'movement':expense?'neutral':net<0?'negative':'neutral'}/></header>
<ContributionList rows={data.contributions} {expense} kind={data.category.type}/></section></div>
