import {test,expect} from 'bun:test';import {plugin} from 'bun';import {readFileSync} from 'node:fs';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';
plugin({name:'history-w18-ssr',setup(build){build.onLoad({filter:/(HistoryOverview|HistoryCaptureControls|FinancialBadge)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const {default:Overview}=await import('./components/HistoryOverview.svelte');const {default:Controls}=await import('./components/HistoryCaptureControls.svelte');
import {fixture,access,accounts,labels,resolveEvidence,now} from '../../qa/history-w18/fixture';
import {BudgetEngine} from './server/budgetEngine/service';import {loadHistoryOverview,historyCaptureOffer} from './server/historyOverviewAdapter';
test('actual history component renders gaps, provenance, chart observations and native date constraints',()=>{
 const db=fixture(':memory:'),engine=new BudgetEngine(db,1);const points=loadHistoryOverview(engine,access,accounts,'2026-11-21','2026-11-25');
 const html=render(Overview,{props:{points,accounts:labels,from:'2026-11-21',to:'2026-11-25',maxDate:'2026-11-25'}}).body;
 for(const text of ['End-date total unknown','Known subtotal','Synthetic debt','Accepted estimate','Reconstructed','Recorded balance','Missing balance evidence','min="2026-11-21"','max="2026-11-25"'])expect(html).toContain(text);
 expect((html.match(/<circle /g)??[]).length).toBe(3);expect(html).not.toContain('<polyline');expect(html).not.toContain('<path');db.close();
});
test('capture component uses opaque offer only and hides unsupported writes',()=>{
 const db=fixture(':memory:'),engine=new BudgetEngine(db,1);const offer=historyCaptureOffer(engine,access,'synthetic-debt-25',resolveEvidence,now);
 const html=render(Controls,{props:{offers:[offer],revision:7,commandKey:'test',canCapture:true,action:'?/capture'}}).body;
 expect(html).toContain('method="POST"');expect(html).toContain('name="history_offer"');expect(html).not.toContain('name="balance');expect(html).not.toContain('name="owner');
 expect(render(Controls,{props:{offers:[offer],revision:7,commandKey:'test',canCapture:false}}).body).not.toContain('<form');db.close();
});
test('loading and error states never show stale totals',()=>{
 expect(render(Overview,{props:{loading:true}}).body).toContain('Loading recorded history');expect(render(Overview,{props:{error:'Try another period'}}).body).toContain('role="alert"');
});
