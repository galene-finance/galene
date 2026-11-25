<script lang="ts">
 import type {PageData} from './$types';
 import Title from '$lib/components/Title.svelte';
 import PeriodPicker from '$lib/components/PeriodPicker.svelte';
 import ReflectionOverview from '$lib/components/ReflectionOverview.svelte';
 import ReflectTabs from '$lib/components/ReflectTabs.svelte';
 import HistoryOverview from '$lib/components/HistoryOverview.svelte';
 import HistoryCaptureControls from '$lib/components/HistoryCaptureControls.svelte';
 let {data}:{data:PageData}=$props();
</script>
<Title title="Reflect"/>
<div class="product-page"><header class="product-heading"><div><h1>Reflect</h1><p>Understand the activity behind your numbers.</p></div></header><PeriodPicker month={data.period.month} path="/reflect" accountId={data.accountId} view={data.view}/>{#if data.view==='net-worth'&&data.netWorth}
 <ReflectTabs query={data.scopeQuery} current="net-worth"/>
 <HistoryOverview {...data.netWorth} action="/reflect" queryFields={{view:'net-worth',...(data.accountId?{account:String(data.accountId)}:{})}}/>
 <HistoryCaptureControls revision={data.netWorth.revision} commandKey="" canCapture={false}/>
 {:else}<ReflectionOverview {data}/>{/if}</div>
