<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import {historyMoney,historySourceLabel,type HistoryCaptureOffer} from '$lib/historyOverview';
 let {offers=[],revision,commandKey,action='',canCapture=false,unavailableReason='No source-bound balance evidence is available to capture.',error=null,success=null}:{offers?:HistoryCaptureOffer[];revision:number;commandKey:string;action?:string;canCapture?:boolean;unavailableReason?:string;error?:string|null;success?:string|null}=$props();
 // Capture is intentionally a native POST; the route re-resolves immutable evidence.
 const available=$derived(canCapture&&offers.length>0&&!!action&&!!commandKey);
</script>
<section class="product-panel" aria-label="Save balance evidence">
 <header class="product-panel-header"><div><h2>Save balance evidence</h2><p class="product-row-caption">Append a dated source record, without changing an account or moving money.</p></div></header>
 {#if error}<p role="alert" class="product-attention">{error}</p>{/if}
 {#if success}<p role="status" class="product-panel-body">{success}</p>{/if}
 {#if available}
 <div class="product-panel-body"><p>Review the source and its original timestamp before saving. This does not fill earlier gaps.</p></div>
 <ul class="product-list">{#each offers as offer(offer.reference)}<li class="history-capture-offer">
  <div class="history-capture-heading"><strong>{offer.accountName}</strong><Badge value={historyMoney(offer.balanceCents,offer.currency)} label={historySourceLabel[offer.source]} tone={offer.source==='actual'?'neutral':'attention'}/></div>
  <p class="product-row-caption">As of {offer.asOf.replace('T',' ').replace('.000Z',' UTC')}</p><details><summary>Source evidence</summary><p>{offer.evidence}</p></details>
  <form method="POST" {action} data-history-command="capture"><input type="hidden" name="history_offer" value={offer.reference}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="key" value={`${commandKey}:${offer.reference}`}/><button class="product-button primary" aria-label={`Save balance evidence for ${offer.accountName}`}>Save this evidence</button></form>
 </li>{/each}</ul>
 {:else}<div class="product-panel-body"><Badge label="Capture unavailable" tone="attention"/><p>{canCapture?unavailableReason:'Balance capture is not enabled for this view.'}</p><p class="product-row-caption">History remains readable. A supported source update must supply the amount, account mapping, original timestamp and evidence; no balances are invented here.</p></div>{/if}
</section>
<style>.history-capture-offer{padding:18px 22px;overflow-wrap:anywhere}.history-capture-offer+li{border-top:1px solid var(--border)}.history-capture-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.history-capture-heading strong{min-width:0}.history-capture-offer form{margin-top:14px}.history-capture-offer button,.history-capture-offer summary{min-height:44px}.history-capture-offer summary{cursor:pointer;display:flex;align-items:center}.history-capture-offer summary:before{content:'›';margin-right:8px}.history-capture-offer details[open] summary:before{content:'⌄'}.history-capture-offer button:focus-visible,.history-capture-offer summary:focus-visible{outline:2px solid var(--foreground);outline-offset:3px}@media(max-width:480px){.history-capture-heading{align-items:start;flex-direction:column}.history-capture-offer{padding:16px 12px}}</style>
