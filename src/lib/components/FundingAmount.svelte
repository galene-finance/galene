<script lang="ts">
 import type {BudgetEngine} from '$lib/server/budgetEngine/service';import {formatMoney} from '$lib/utils';import Badge from './FinancialBadge.svelte';
 let {state}:{state:ReturnType<BudgetEngine['dashboard']>['categoryStates'][number]}=$props();
 const presentation=$derived.by(()=>{
  if(state.cashStatus==='cash_overspent'||state.cashStatus==='credit_overspent')return {label:state.cashStatus==='cash_overspent'?'Cash overspent':'Credit overspent',tone:'negative' as const};
  if(state.cashStatus==='unknown'||state.cashStatus==='unbacked')return {label:state.cashStatus==='unknown'?'Funding unknown':'Cash backing shortfall',tone:'attention' as const};
  if(state.cashStatus==='empty')return {label:'No cash left',tone:state.targetStatus==='needs_funding'?'attention' as const:'neutral' as const};
  return {label:state.targetStatus==='met'?'Funded':state.targetStatus==='needs_funding'?'Underfunded':'Available',tone:state.targetStatus==='needs_funding'?'attention' as const:'positive' as const};
 });
 const cents=$derived(state.cashStatus==='unknown'||state.cashStatus==='unbacked'?null:state.cashStatus==='credit_overspent'?state.creditOverspentCents:state.availableCents);
</script>
<Badge value={cents===null?undefined:formatMoney(cents)} label={presentation.label} tone={presentation.tone}/>
