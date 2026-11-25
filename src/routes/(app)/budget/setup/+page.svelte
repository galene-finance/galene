<script lang="ts">
 import BaselineAccountSetup from '$lib/components/BaselineAccountSetup.svelte';
 import type {PageData} from './$types';
 import type {BaselineSetupResult} from '$lib/baselineSetupTypes';
 let {data,form}:{data:PageData;form?:BaselineSetupResult|null}=$props();
</script>
<svelte:head><title>Budget starting point — Galene</title></svelte:head>
<section class="product-page"><header class="product-header"><div><p class="product-eyebrow">Plan</p><h1>Accounts &amp; starting point</h1><p class="product-subtitle">Review opening evidence and choose which accounts fund your budget.</p></div><a class="product-button" href="/budget">Back to Plan</a></header>
{#if !data.sourceConfigured}<p class="product-attention" role="status">Setup is not ready for activation: approved account evidence and an accounting timezone must be connected. UTC below is a display default, not a confirmed accounting choice. Instant provider observations cannot substitute for closing evidence.</p>{/if}
<BaselineAccountSetup model={data.setup} commandKey={data.commandKey} {form} action="?/baselineSetup" loadAction="/budget/setup"/>
</section>
