<script lang="ts">
 import type {PageData} from './$types';
 import Title from '$lib/components/Title.svelte';
 import PeriodPicker from '$lib/components/PeriodPicker.svelte';
 import ReflectionOverview from '$lib/components/ReflectionOverview.svelte';
 let {data}:{data:PageData}=$props();
</script>
<Title title="Reflect"/>
<div class="product-page"><header class="product-heading"><div><h1>Reflect</h1><p>Understand the activity behind your numbers.</p></div></header><PeriodPicker month={data.period.month} path="/reflect" accountId={data.accountId} view={data.view}/><ReflectionOverview {data}/></div>
