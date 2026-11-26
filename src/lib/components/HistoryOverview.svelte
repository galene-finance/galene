<script lang="ts">
 import Badge from './FinancialBadge.svelte';
 import type {HistoryPoint} from '$lib/budget/types';
 import {historyPresentation,historyMoney,historyDate,historySourceLabel,type HistoryAccountLabel} from '$lib/historyOverview';
 let {points=[],accounts=[],from='',to='',maxDate,action='',queryFields={},error=null,loading=false}:{points?:HistoryPoint[];accounts?:HistoryAccountLabel[];from?:string;to?:string;maxDate?:string;action?:string;queryFields?:Record<string,string>;error?:string|null;loading?:boolean}=$props();
 const view=$derived(historyPresentation(points));
 const rows=$derived([...points].sort((a,b)=>b.date.localeCompare(a.date)));
 const accountName=(id:number)=>accounts.find(a=>a.id===id)?.name??'Included account';
 const sourceSummary=(p:HistoryPoint)=>[...new Set(p.sources.map(s=>historySourceLabel[s.source]))].join(' · ');
 const safeFields=$derived(Object.entries(queryFields).filter(([key])=>!['date_from','date_to'].includes(key)));
</script>
<section class="product-panel history-overview" aria-label="Net worth history" aria-busy={loading}>
 <header class="product-panel-header"><div><h2>Net worth over time</h2><p class="product-row-caption">Dated account balances, including debts—not income or spendable cash.</p></div>
 {#if !error&&!loading&&view.status!=='mixed_currency'}<Badge label={view.latest?.complete?'Net worth on selected end date':'End-date total unknown'} value={view.latest?.complete&&view.latest.totalCents!==null&&view.currency?historyMoney(view.latest.totalCents,view.currency):undefined} tone={view.latest?.complete?(view.latest.totalCents!<0?'negative':'neutral'):'attention'}/>{/if}</header>
 <form method="GET" {action} class="history-range">
  {#each safeFields as [name,value]}<input type="hidden" {name} {value}/>{/each}
  <label>From<input type="date" name="date_from" value={from} min="1900-01-01" max={to||maxDate} required/></label>
  <label>Through<input type="date" name="date_to" value={to} min={from||'1900-01-01'} max={maxDate} required/></label>
  <button class="product-button" disabled={loading}>Show history</button>
  <p class="product-row-caption">Choose up to 366 days. Dates use the source’s UTC day.</p>
 </form>
 {#if loading}<p role="status" class="product-panel-body">Loading recorded history…</p>
 {:else if error}<div role="alert" class="product-attention"><Badge label="History unavailable" tone="attention"/><span>{error}</span></div>
 {:else if view.status==='mixed_currency'}<div role="status" class="product-attention"><Badge label="Different currencies" tone="attention"/><span>These balances cannot be compared as one net-worth series. Choose accounts with one currency. No conversion has been assumed.</span></div>
 {:else if !points.length}<div class="product-empty"><strong>No history selected</strong><p>Choose a period to see saved balance evidence. Today’s balance cannot establish past net worth.</p></div>
 {:else}
 <div class="product-panel-body">
  <div class="history-coverage"><Badge label={`${view.completeDays} complete ${view.completeDays===1?'day':'days'}`} tone="neutral"/><Badge label={`${view.gapDays} ${view.gapDays===1?'day':'days'} with gaps`} tone={view.gapDays?'attention':'neutral'}/></div>
  {#if view.plotted.length&&view.currency}
  <figure><figcaption>Recorded net worth · {view.currency}</figcaption>
   <p class="history-axis"><span>Scale low: {historyMoney(view.low,view.currency)}</span><span>High: {historyMoney(view.high,view.currency)}</span></p>
   <svg viewBox="0 0 640 195" role="img" aria-label="Net worth observations. Dots are not joined across dates. Exact amounts and evidence are listed below.">
    <line x1="40" x2="600" y1={view.zeroY} y2={view.zeroY} class="zero-line"/>
    {#each view.plotted as dot}<circle cx={dot.x} cy={dot.y} r="5" class:estimated={dot.point.sources.some(s=>s.source!=='actual')}><title>{historyDate(dot.point.date)}: {historyMoney(dot.point.totalCents!,view.currency)} · {sourceSummary(dot.point)}</title></circle>{/each}
   </svg><div class="history-axis"><span>{historyDate(rows[rows.length-1].date)}</span><span>{historyDate(rows[0].date)}</span></div><p class="product-row-caption">Separate dots show observations, not an uninterrupted balance. Outlined dots include estimates or reconstruction. The horizontal line marks zero.</p>
  </figure>
  {:else}<div class="product-empty"><strong>No complete daily total in this period</strong><p>Known account balances are retained below. Missing accounts are not treated as zero.</p></div>{/if}
 </div>
 <div class="history-days">
 {#each rows as point(point.date)}
  <details class="history-day"><summary><span class="history-day-label"><strong>{historyDate(point.date)}</strong><span class="product-row-caption">{point.sources.length} of {point.includedAccountIds.length} included accounts · {point.complete?sourceSummary(point):'Coverage gap'}</span></span>
   <Badge label={point.complete?'Net worth':point.includedAccountIds.length?'Partial coverage':'No included accounts'} value={point.complete&&point.totalCents!==null&&view.currency?historyMoney(point.totalCents,view.currency):undefined} tone={point.complete?(point.totalCents!<0?'negative':'neutral'):'attention'}/>
  </summary>
  <div class="history-evidence">
   {#if !point.complete&&point.sources.length&&view.currency}<p><strong>Known subtotal: {historyMoney(point.knownSubtotalCents,view.currency)}</strong> — not total net worth.</p>{/if}
   {#if point.missingAccountIds.length}<p>Missing balance evidence: {point.missingAccountIds.map(accountName).join(', ')}.</p>{/if}
   {#if !point.includedAccountIds.length}<p>No accounts are included for this date.</p>{/if}
   <ul>{#each point.sources as source}<li><div class="history-source"><strong>{accountName(source.accountId)}</strong><Badge label={historySourceLabel[source.source]} value={historyMoney(source.balanceCents,source.currency)} tone={source.source==='actual'?'neutral':'attention'}/></div><p class="product-row-caption">As of {source.asOf.replace('T',' ').replace('.000Z',' UTC')} · saved {source.recordedAt.replace('T',' ').replace('.000Z',' UTC')}</p><p>{source.evidence}</p>{#if source.coverageFrom&&source.coverageTo}<p class="product-row-caption">Evidence coverage: {historyDate(source.coverageFrom)} – {historyDate(source.coverageTo)}</p>{/if}</li>{/each}</ul>
  </div></details>
 {/each}
 </div>
 <footer class="product-details">Scope: {accounts.length?accounts.map(a=>a.name).join(', '):'No accounts selected'}. The latest evidence for each account on each UTC day is used; account timestamps may differ. Estimates keep their source labels. Missing dates are never filled with today’s balance.</footer>
 {/if}
</section>
<style>
 .history-range{display:flex;flex-wrap:wrap;gap:12px;align-items:end;padding:18px 22px}.history-range label{display:flex;flex-direction:column;gap:6px;font-size:13px;flex:1;min-width:130px}.history-range input{width:100%;min-height:44px;padding:8px;border:1px solid var(--input);border-radius:var(--radius);background:var(--surface);color:var(--foreground);box-sizing:border-box}.history-range button{min-height:44px}.history-range p{flex-basis:100%;margin:0}.history-coverage{display:flex;gap:8px;flex-wrap:wrap}figure{margin:20px 0 0}figcaption{font-weight:650}svg{width:100%;height:auto;overflow:visible}.history-axis{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted-foreground)}circle{fill:var(--foreground);stroke:var(--foreground);stroke-width:2}circle.estimated{fill:var(--surface)}.zero-line{stroke:var(--border);stroke-dasharray:4 4}.history-day{border-top:1px solid var(--border)}summary{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:16px 22px;cursor:pointer;min-height:44px}summary:before{content:'›';font-size:22px}details[open]>summary:before{content:'⌄'}.history-day-label{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}.history-evidence{padding:0 22px 18px;overflow-wrap:anywhere}.history-evidence ul{list-style:none;margin:0;padding:0}.history-evidence li+li{border-top:1px solid var(--border);padding-top:14px}.history-source{display:flex;gap:10px;justify-content:space-between;align-items:center}.history-source strong{min-width:0;overflow-wrap:anywhere}summary:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--foreground);outline-offset:3px}@media(max-width:480px){summary{padding:14px 12px;flex-wrap:wrap}.history-day-label{flex-basis:70%}.history-range,.history-evidence{padding-left:12px;padding-right:12px}.history-source{align-items:start;flex-direction:column}}
</style>
