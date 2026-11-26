<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import {formatMoney} from '$lib/utils';
 let {amount,kind}:{amount:number;kind:string}=$props();
</script>
<Badge value={formatMoney(amount)} label={`Expected ${kind.toLowerCase()}`} tone={kind==='Transfer'?'movement':'neutral'}/>
