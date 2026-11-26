<script lang="ts">
 import type { PageData } from './$types';
 import Title from '$lib/components/Title.svelte';
 import PeriodPicker from '$lib/components/PeriodPicker.svelte';
 import HomeOverview from '$lib/components/HomeOverview.svelte';
 let {data}:{data:PageData}=$props();
</script>
<Title title="Home"/>
<div class="product-page">
 <header class="product-heading"><div><h1>Home</h1><p>Your plan, recorded activity and what’s coming up.</p></div></header>
 <PeriodPicker month={data.period.month} accountId={data.accountId}/>
 <HomeOverview {data}/>
 <details class="product-panel product-details"><summary>How these numbers work</summary><p>Current monthly targets describe the plan, not funded cash. Posted, categorized activity supplies income and spending for the selected period; refunds and income reversals retain their signs. Pending records and movements do not become earnings or spending. Working balances retain their recorded sources and dates.</p><p><a href="/customize" class="product-link">Open customizable widgets</a></p></details>
</div>
