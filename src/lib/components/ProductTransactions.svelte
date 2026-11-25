<script lang="ts">
 import type {Transaction} from '$lib/types';import {formatMoney} from '$lib/utils';
 let {transactions,month}:{transactions:Transaction[];month?:string}=$props();
</script>
{#if transactions.length}<div class="product-table-wrap"><table class="product-table"><thead><tr><th scope="col">Transaction</th><th scope="col" class="secondary">Category</th><th scope="col" class="amount">Amount</th></tr></thead><tbody>{#each transactions as t}<tr><td><a href={`/transactions/${t.id}${month?`?month=${month}`:''}`}>{t.merchant||'Transaction'}</a><span class="product-row-caption">{t.date}{t.pending?' · Pending':''}</span></td><td class="secondary">{t.category_name||'Needs a category'}{#if t.splits?.length}<span class="product-status">Split</span>{/if}</td><td class="amount">{formatMoney(t.amount_cents)}</td></tr>{/each}</tbody></table></div>{:else}<div class="product-empty"><strong>No transactions in this view</strong><p>Try another month or change your filters.</p></div>{/if}
