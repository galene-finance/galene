<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import type {MovingMoneyModel,MovingMoneyResult,MovingMoneySubmit} from '$lib/movingMoneyFeatureTypes';
 let {model,commandKey,form,action,submit}:{model:MovingMoneyModel;commandKey:string;form?:MovingMoneyResult|null;action?:string;submit?:MovingMoneySubmit}=$props();
 let from=$state(''),to=$state(''),amount=$state(''),date=$state(''),pending=$state(false),localResult=$state<MovingMoneyResult|null>(null);
 const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:model.currency}).format(n/100);
 const source=$derived(model.categories.find(c=>String(c.id)===from));
 const destination=$derived(model.categories.find(c=>String(c.id)===to));
 const result=$derived(localResult??(form?.feature==='move'?form:null));
 const canMove=$derived(model.known&&!!source&&!!destination&&from!==to&&(source.availableCents??0)>0);
 async function send(event:SubmitEvent){
  if(!submit){pending=true;return;}event.preventDefault();const fields=new FormData(event.currentTarget as HTMLFormElement);pending=true;localResult=null;
  try{localResult=await submit('move',fields);if(localResult.ok)amount='';}catch{localResult={feature:'move',ok:false,status:503,error:'The save could not be confirmed. Reload and check your balances before retrying.'};}finally{pending=false;}
 }
</script>
<section class="product-panel money-controls" aria-labelledby="move-money-title">
 <header class="product-panel-header"><div><h2 id="move-money-title">Move money between categories</h2><p class="product-row-caption">Adjust your plan without moving money at the bank.</p></div><Badge value={model.known&&model.readyToAssignCents!==null?money(model.readyToAssignCents):undefined} label={model.known?'Ready to assign':'Coverage needed'} tone={model.known?'neutral':'attention'}/></header>
 <div class="money-body">
  {#if !model.known}<p class="product-attention" role="status">{model.reason}</p>{:else if model.shortfallCents!==null&&model.shortfallCents>0}<p class="product-attention" role="status">Some allocations are not cash-backed. Move available allocations to cover overspending; no new cash is created.</p>{/if}
  {#if result}<p class:money-success={result.ok} class:money-error={!result.ok} role={result.ok?'status':'alert'}>{result.ok?result.notice:result.error}</p>{/if}
  <form method="POST" action={action??`?/moveMoney&month=${model.month}`} onsubmit={send} aria-busy={pending} data-feature-form="move">
   <input type="hidden" name="revision" value={model.revision}/><input type="hidden" name="key" value={`${commandKey}:move`}/>
   <fieldset disabled={!model.known||pending}>
    <legend class="sr-only">Move a budget allocation</legend>
    <div class="money-grid">
     <label>From category<select name="from_category_id" bind:value={from} required><option value="" disabled>Choose a source</option>{#each model.categories as c(c.id)}<option value={String(c.id)} disabled={(c.availableCents??0)<=0}>{c.name}{c.availableCents!==null?` · ${money(c.availableCents)} allocated`:''}</option>{/each}</select></label>
     <label>To category<select name="to_category_id" bind:value={to} required><option value="" disabled>Choose a destination</option>{#each model.categories as c(c.id)}<option value={String(c.id)} disabled={String(c.id)===from}>{c.name}</option>{/each}</select></label>
    </div>
    {#if source&&destination}<div class="money-summary" aria-live="polite"><Badge value={source.availableCents===null?undefined:money(source.availableCents)} label={`${source.name} allocation`} tone="movement"/><span aria-hidden="true">→</span><Badge value={destination.availableCents===null?undefined:money(destination.availableCents)} label={`${destination.name} allocation`} tone={(destination.availableCents??0)<0?'negative':'neutral'}/></div>{/if}
    {#if (destination?.creditOverspentCents??0)>0}<p class="product-row-caption">This category has unfunded card spending. Money moved here first funds its card-payment reserve.</p>{/if}
    <div class="money-grid"><label>Amount ({model.currency})<input name="amount" bind:value={amount} inputmode="decimal" placeholder="0.00" pattern="(0|[1-9][0-9]*)([.][0-9][0-9]?)?" required/></label><label>Effective date<input name="date" type="date" value={date||model.asOfDate} oninput={event=>date=event.currentTarget.value} min={`${model.month}-01`} max={model.asOfDate} required/></label></div>
    <div class="money-footer"><span class="product-row-caption">Targets and bank balances stay unchanged.</span><button class="product-button primary" disabled={!canMove||pending}>{pending?'Saving…':'Move allocation'}</button></div>
   </fieldset>
  </form>
 </div>
</section>
<style>
 .money-body{padding:20px 22px}.money-controls h2{margin:0}.money-controls fieldset{border:0;padding:0;margin:0;min-width:0}.money-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.money-grid label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600;color:var(--foreground);min-width:0}.money-grid input,.money-grid select{width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px;border:1px solid var(--input);border-radius:var(--radius);background:var(--surface);color:var(--foreground);font:inherit}.money-grid :is(input,select):focus-visible,.money-footer button:focus-visible{outline:3px solid var(--ring);outline-offset:3px}.money-summary{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px;background:var(--muted);border-radius:14px}.money-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px}.money-footer button{min-height:46px;flex-shrink:0}.money-footer button:disabled{opacity:.45;cursor:not-allowed}.money-success,.money-error{padding:12px 14px;border-radius:12px;font-size:14px}.money-success{background:var(--pill-positive-fill);color:var(--pill-positive-ink)}.money-error{background:var(--pill-negative-fill);color:var(--pill-negative-ink)}fieldset:disabled{opacity:.65}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:560px){.money-body{padding:16px}.money-grid{grid-template-columns:1fr}.money-footer{align-items:stretch;flex-direction:column}.money-footer button{width:100%}}
</style>
