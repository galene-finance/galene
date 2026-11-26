<script lang="ts">
 import Balance from '$lib/components/AccountBalance.svelte';
 import type {PageData} from './$types';import Title from '$lib/components/Title.svelte';import {formatMoney,formatDate} from '$lib/utils';
 let {data}:{data:PageData}=$props();let q=$state('');
 const groups=[{name:'Cash accounts',types:['bank','cash']},{name:'Cards & loans',types:['credit']},{name:'Investments & other accounts',types:['investment','other']}];
 const accounts=$derived(data.accounts.filter(a=>a.name.toLowerCase().includes(q.toLowerCase())));
</script>
<Title title="Accounts"/>
<div class="product-page"><header class="product-heading"><div><h1>Accounts</h1><p>Your balances, with the details one click away.</p></div><a class="product-button" href="/settings/accounts">Manage accounts</a></header>
<div class="product-toolbar"><label class="product-field"><span class="product-muted">Find account</span><input type="search" bind:value={q} placeholder="Search accounts"/></label><a class="product-link" href="/settings/sync">Bank connections</a></div>
{#each groups as group}{@const items=accounts.filter(a=>group.types.includes(a.type))}{#if items.length}<section class="product-panel"><header class="product-panel-header"><h2>{group.name}</h2><span class="product-muted">{items.length} {items.length===1?'account':'accounts'}</span></header><ul class="product-list">{#each items as a}<li><a class="product-row" href={`/accounts/${a.id}`}><span class="product-row-main"><span class="product-row-title">{a.name}</span><span class="product-row-caption">{a.source}{a.asOf?` · ${formatDate(a.asOf.slice(0,10))}`:''}</span></span><Balance account={a}/></a></li>{/each}</ul></section>{/if}{/each}
{#if !accounts.length}<section class="product-panel product-empty"><strong>{q?'No matching accounts':'No accounts yet'}</strong><p>{q?'Try another name.':'Add an account or connect a bank to get started.'}</p>{#if !q}<a class="product-button" href="/settings/accounts">Add account</a>{/if}</section>{/if}
<details class="product-panel product-details"><summary>About these balances</summary><p>Bank-reported balances are shown when supplied. Other accounts use the existing working balance only when an opening balance is recorded. These figures may have different as-of dates; they are not added together as money available to spend. Open an account for its source, date and recorded activity.</p></details>
</div>
