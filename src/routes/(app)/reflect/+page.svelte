<script lang="ts">
 import type {PageData} from './$types';
 import Title from '$lib/components/Title.svelte';
 import PeriodPicker from '$lib/components/PeriodPicker.svelte';
 import ReflectionOverview from '$lib/components/ReflectionOverview.svelte';
 import ReflectTabs from '$lib/components/ReflectTabs.svelte';
 import HistoryOverview from '$lib/components/HistoryOverview.svelte';
 import HistoryCaptureControls from '$lib/components/HistoryCaptureControls.svelte';
 let {data,form}: {data:PageData;form?:{ok?:boolean;historySaved?:boolean;error?:string}|null} = $props();
</script>
<Title title="Reflect"/>
<div class="product-page"><header class="product-heading"><div><h1>Reflect</h1><p>Understand the activity behind your numbers.</p></div></header><PeriodPicker month={data.period.month} path="/reflect" accountId={data.accountId} view={data.view}/>{#if data.view==='net-worth'&&data.netWorth}
 <ReflectTabs query={data.scopeQuery} current="net-worth"/>
 <HistoryOverview {...data.netWorth} action="/reflect" queryFields={{view:'net-worth',...(data.accountId?{account:String(data.accountId)}:{})}}/>
 {#if data.capture}
 {#if data.capture.canCapture&&!data.capture.offers.length&&!data.capture.gaps.length}<section class="product-panel product-panel-body"><h2>Available evidence saved</h2><p>No new approved source observations are available to save. Existing dates and coverage gaps remain unchanged.</p>{#if form?.error}<p role="alert">{form.error}</p>{/if}</section>{:else}
 <HistoryCaptureControls offers={data.capture.offers} revision={data.capture.revision} commandKey={data.capture.commandKey} canCapture={data.capture.canCapture} action={`?/captureHistory&view=net-worth&date_from=${data.netWorth.from}&date_to=${data.netWorth.to}${data.accountId?`&account=${data.accountId}`:''}`} error={form?.error??null} success={form?.historySaved?'Source evidence saved. Earlier gaps remain unchanged.':null}/>{/if}
 {#if data.capture.gaps.length}<section class="product-panel product-panel-body" aria-label="Missing source evidence"><h2>Evidence still needed</h2><ul>{#each data.capture.gaps as gap}<li><strong>{gap.accountName}</strong>: {gap.reason}</li>{/each}</ul><p>Keep accepted MMI estimates and Apple-only YNAB sources. A current observation is not proof of a past closing balance.</p></section>{/if}
 {:else}<HistoryCaptureControls revision={data.netWorth.revision} commandKey="" canCapture={false}/>{/if}
 {:else}<ReflectionOverview {data}/>{/if}</div>
