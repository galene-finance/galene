<script lang="ts">
 import type {Transaction,Category} from '$lib/types';
 import {formatDate} from '$lib/utils';
 import Amount from './TransactionAmount.svelte';
 let {transactions,categories,month}:{transactions:Transaction[];categories:Category[];month?:string}=$props();
</script>
{#if transactions.length}<ul class="product-list">{#each transactions as t}<li><a class="product-row" href={`/transactions/${t.id}${month?`?month=${month}`:''}`}><span class="product-row-main"><strong class="product-row-title">{t.merchant||'Transaction'}</strong><span class="product-row-caption">{t.splits?.length?'Split across categories':t.category_name||'Needs a category'} · {formatDate(t.date)}</span></span><Amount transaction={t} {categories}/></a></li>{/each}</ul>{:else}<div class="product-empty"><strong>No transactions in this view</strong><p>Try another month or change your filters.</p></div>{/if}
