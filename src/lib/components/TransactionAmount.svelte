<script lang="ts">
 import type {Transaction,Category} from '$lib/types';
 import {transactionPresentation} from '$lib/financialPresentation';
 import {formatMoney} from '$lib/utils';
 import Badge from './FinancialBadge.svelte';
 let {transaction,categories}:{transaction:Transaction;categories:Category[]}=$props();
 const state=$derived(transactionPresentation(transaction,categories));
</script>
<Badge value={formatMoney(transaction.amount_cents)} label={state.label} tone={state.tone} symbol={state.tone==='attention'?'!':state.tone==='movement'?'↔':transaction.amount_cents<0?'−':transaction.amount_cents>0?'+':'•'}/>
