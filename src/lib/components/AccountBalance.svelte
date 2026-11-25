<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import {formatMoney} from '$lib/utils';
 let {account}:{account:{type:string;displayCents:number|null}}=$props();
 const owed=$derived(account.type==='credit'&&account.displayCents!==null&&account.displayCents<0);
 const negative=$derived(!owed&&account.displayCents!==null&&account.displayCents<0);
</script>
<Badge value={account.displayCents===null?undefined:formatMoney(owed?-account.displayCents!:account.displayCents!)} label={account.displayCents===null?'Unavailable':owed?'Owed':negative?'Negative balance':'Balance'} tone={account.displayCents===null||negative?'attention':'neutral'}/>
