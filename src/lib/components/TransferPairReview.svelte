<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import type {transferReviewModel} from '$lib/server/budgetIntegration';
 let {model,revision,commandKey,month}:{model:NonNullable<ReturnType<typeof transferReviewModel>>;revision:number;commandKey:string;month:string}=$props();
 const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:model.currency}).format(cents/100);
</script>
<details class="product-panel transfer-review" id="transfer-review">
 <summary><div><h2>Review transfer matches</h2><p class="product-row-caption">{model.from} – {model.through} · {model.pairs.length} saved matches</p></div><Badge label={model.status==='needs_review'?'Saved matches need review':model.outflows.length?'Explicit confirmation required':'No posted transfers'} tone={model.status==='needs_review'?'attention':'movement'}/></summary>
 <div class="review-body">
 <p>Only posted records already categorized as transfers appear here. Choose both sides explicitly: the same posted date, equal opposite amounts, and different accounts. Nothing is inferred from a similar amount.</p>
 {#if model.truncated}<p role="alert" class="product-attention">More than 200 transfer records are in this coverage window. This bounded review cannot save them; no matches were changed.</p>
 {:else if !model.outflows.length&&!model.pairs.length}<p>No outgoing transfers need matching in this coverage window.</p>
 {:else}
 <form method="POST" action={`?/reviewTransfers&month=${month}`} data-budget-command="reviewTransfers">
 <input type="hidden" name="revision" value={revision}/><input type="hidden" name="key" value={`${commandKey}:pairs`}/>
 {#each model.outflows as row(row.id)}
 {@const saved=model.pairs.find(p=>p.outflowId===row.id)}
 <fieldset><legend>{row.accountName} · {row.name}</legend><div class="review-row"><p class="product-row-caption">{row.date} · outgoing record {row.id}</p><Badge value={money(row.amountCents)} label="Outgoing transfer" tone="movement"/></div>
 <label>Matching incoming record<select name={`match_${row.id}`} value={saved?String(saved.inflowId):''}><option value="">Not matched</option>{#each model.inflows as incoming}<option value={String(incoming.id)}>{incoming.accountName} · {incoming.date} · {money(incoming.amountCents)} · record {incoming.id}</option>{/each}</select></label>
 <label>Category for a budget/tracking boundary, if required<select name={`category_${row.id}`} value={saved?.categoryId===undefined?'':String(saved.categoryId)}><option value="">No category</option>{#each model.categories as category}<option value={String(category.id)}>{category.name}</option>{/each}</select></label>
 </fieldset>
 {/each}
 <p class="product-row-caption">All transfer records in this window must be resolved before coverage can refresh. Saving replaces the saved matches for this window, including retired matches whose source records no longer exist. It does not edit or delete transactions, recategorize records, or move money.</p>
 <label class="confirmation"><input type="checkbox" name="confirm" value="yes" required/>I reviewed these selections and want to replace the saved matches for this coverage window.</label>
 <button class="product-button primary">Save reviewed matches</button>
 </form>
 {/if}
 </div>
</details>
<style>
 summary{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px;cursor:pointer;min-height:44px}summary h2{font-size:16px;margin:0}.review-body{padding:0 22px 22px;font-size:14px}.review-body>p{margin-bottom:16px}fieldset{min-width:0;margin:18px 0;border:1px solid var(--border);padding:16px;border-radius:var(--radius)}legend{font-weight:650;padding:0 6px}.review-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}label{display:flex;flex-direction:column;gap:7px;margin:14px 0}select{width:100%;min-width:0;min-height:46px;padding:9px;border:1px solid var(--input);border-radius:var(--radius);background:var(--surface);color:var(--foreground)}.confirmation{flex-direction:row;align-items:center;min-height:44px}.confirmation input{width:22px;height:22px;flex-shrink:0}button{min-height:46px}summary:focus-visible,select:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid var(--ring);outline-offset:3px}@media(max-width:560px){summary{align-items:start;flex-direction:column}.review-body{padding:0 12px 16px}.review-row{align-items:start;flex-direction:column}}
</style>
