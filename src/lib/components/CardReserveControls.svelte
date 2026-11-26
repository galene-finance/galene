<script lang="ts">
 import {onMount} from 'svelte';
 import Badge from './FinancialBadge.svelte';
 import type {MovingMoneyModel,MovingMoneyResult,MovingMoneySubmit} from '$lib/movingMoneyFeatureTypes';
 let {model,commandKey,form,action,submit}:{model:MovingMoneyModel;commandKey:string;form?:MovingMoneyResult|null;action?:string;submit?:MovingMoneySubmit}=$props();
 let selected=$state(''),direction=$state('add'),amount=$state(''),date=$state(''),pending=$state(false),localResult=$state<MovingMoneyResult|null>(null);
 let hydrated=$state(false);onMount(()=>{hydrated=true;});
 const card=$derived(model.cards.find(c=>String(c.id)===(selected||String(model.cards[0]?.id))));
 const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:model.currency}).format(n/100);
 const result=$derived(localResult??(form?.feature==='reserve'?form:null));
 const limit=$derived(!model.known||!card?null:direction==='release'?card.reservedCents:Math.min(model.assignableCents??0,card.unfundedCents??0));
 async function send(event:SubmitEvent){if(!submit)return;event.preventDefault();const fields=new FormData(event.currentTarget as HTMLFormElement);pending=true;localResult=null;try{localResult=await submit('reserve',fields);if(localResult.ok)amount='';}catch{localResult={feature:'reserve',ok:false,status:503,error:'The save could not be confirmed. Reload and check your reserve before retrying.'};}finally{pending=false;}}
</script>
<section class="product-panel reserve-controls" aria-labelledby="card-reserves-title">
 <header class="product-panel-header"><div><h2 id="card-reserves-title">Card payment reserves</h2><p class="product-row-caption">Set cash aside for a card, or return it to Ready to assign.</p></div><Badge label="Budget only · not a payment" tone="movement"/></header>
 <div class="reserve-body">
  {#if !model.known}<p class="product-attention" role="status">{model.reason}</p>{/if}
  {#if !model.cards.length}<p class="product-row-caption">No budget credit cards are configured. Tracking debts do not have a cash-payment reserve here.</p>{:else}
   {#if result}<p class:reserve-success={result.ok} class:reserve-error={!result.ok} role={result.ok?'status':'alert'}>{result.ok?result.notice:result.error}</p>{/if}
   <form method="POST" action={action??`?/cardReserve&month=${model.month}`} onsubmit={send} aria-busy={pending} data-feature-form="reserve">
    <input type="hidden" name="revision" value={model.revision}/><input type="hidden" name="key" value={`${commandKey}:reserve`}/>
    <fieldset disabled={!model.known||pending}><legend class="sr-only">Adjust a card payment reserve</legend>
     <label class="reserve-label">Credit card<select name="account_id" value={selected||String(model.cards[0]?.id)} onchange={event=>selected=event.currentTarget.value} required>{#each model.cards as c(c.id)}<option value={String(c.id)}>{c.name}</option>{/each}</select></label>
     {#each (hydrated?(card?[card]:[]):model.cards) as summary(summary.id)}<div class="reserve-summary" aria-live="polite">{#if !hydrated}<strong>{summary.name}</strong>{/if}<Badge value={summary.cashBackedReserveCents===null?undefined:money(summary.cashBackedReserveCents)} label={summary.cashBackedReserveCents===null?'Cash backing unknown':'Cash reserved'} tone={summary.cashBackedReserveCents===null?'attention':summary.cashBackedReserveCents>0?'positive':'neutral'}/><Badge value={summary.unfundedCents===null?undefined:money(summary.unfundedCents)} label="Debt not yet reserved" tone={summary.unfundedCents===null||summary.unfundedCents>0?'attention':'neutral'}/><Badge value={summary.debtCents===null?undefined:money(summary.debtCents)} label="Card debt"/></div>{/each}
     <div class="reserve-grid"><label class="reserve-label">What would you like to do?<select name="direction" bind:value={direction}><option value="add">Add cash to reserve</option><option value="release">Return reserve to Ready to assign</option></select></label><label class="reserve-label">Amount ({model.currency})<input name="amount" bind:value={amount} inputmode="decimal" placeholder="0.00" pattern="(0|[1-9][0-9]*)([.][0-9][0-9]?)?" required/></label></div>
     <div class="reserve-grid"><label class="reserve-label">Effective date<input name="date" type="date" value={date||model.asOfDate} oninput={event=>date=event.currentTarget.value} min={`${model.month}-01`} max={model.asOfDate} required/></label><div class="reserve-allowance">{#if hydrated}<Badge value={limit===null?undefined:money(limit)} label={direction==='add'?'Can add from unassigned cash':'Can return from reserve'} tone="movement"/>{:else}<p class="product-row-caption">Your selected card, direction and available funds are checked when you submit.</p>{/if}</div></div>
     <div class="reserve-footer"><span class="product-row-caption">No payment is made. Imported card payments update this reserve separately.</span><button class="product-button primary" disabled={!model.known||pending||(hydrated&&(!card||(limit??0)<=0))}>{pending?'Saving…':!hydrated?'Update reserve':direction==='add'?'Add to reserve':'Return reserve'}</button></div>
    </fieldset>
   </form>
  {/if}
 </div>
</section>
<style>
 .reserve-body{padding:20px 22px}.reserve-controls h2{margin:0}.reserve-controls fieldset{border:0;padding:0;margin:0;min-width:0}.reserve-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.reserve-label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:600;color:var(--foreground);min-width:0}.reserve-label input,.reserve-label select{width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px;border:1px solid var(--input);border-radius:var(--radius);background:var(--surface);color:var(--foreground);font:inherit}.reserve-label :is(input,select):focus-visible,.reserve-footer button:focus-visible{outline:3px solid var(--ring);outline-offset:3px}.reserve-summary{display:flex;gap:12px;flex-wrap:wrap;padding:16px;margin-top:16px;background:var(--muted);border-radius:14px}.reserve-allowance{display:flex;align-items:end}.reserve-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:20px}.reserve-footer button{min-height:46px;flex-shrink:0}.reserve-footer button:disabled{opacity:.45;cursor:not-allowed}.reserve-success,.reserve-error{padding:12px 14px;border-radius:12px;font-size:14px}.reserve-success{background:var(--pill-positive-fill);color:var(--pill-positive-ink)}.reserve-error{background:var(--pill-negative-fill);color:var(--pill-negative-ink)}fieldset:disabled{opacity:.65}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:560px){.reserve-body{padding:16px}.reserve-grid{grid-template-columns:1fr}.reserve-footer{align-items:stretch;flex-direction:column}.reserve-footer button{width:100%}}
</style>
