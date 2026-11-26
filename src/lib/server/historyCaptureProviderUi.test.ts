import {test,expect} from 'bun:test';import {plugin} from 'bun';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';import {Database} from 'bun:sqlite';
import {migrate} from './db';import {BudgetEngine} from './budgetEngine/service';
import {trustedHistoryCaptureProvider,captureTrustedHistoryEvidence,type HistoryCapturePolicy,type HistoryExternalEvidence} from './historyCaptureProvider';
plugin({name:'history-provider-component-test',setup(build){build.onLoad({filter:/(HistoryOverview|HistoryCaptureControls|FinancialBadge)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const {default:Controls}=await import('../components/HistoryCaptureControls.svelte');const {default:Overview}=await import('../components/HistoryOverview.svelte');

test('actual capture control fields save real provider evidence and reload actual history component',()=>{
 const dir=mkdtempSync(join(tmpdir(),'history-provider-ui-'));let db=new Database(join(dir,'synthetic.sqlite'));migrate(db);
 try{
 db.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','ui@example.test','x');INSERT INTO accounts(id,user_id,name,type,provider,external_id,provider_balance_cents,provider_balance_as_of) VALUES(1,1,'Synthetic bank','bank','plaid','synthetic-bank',10000,'2026-11-25 10:00:00'),(2,1,'Synthetic debt','credit',NULL,NULL,NULL,NULL);");
 const access={ownerId:1,canRead:true,canCapture:true},now='2026-11-25T16:00:00.000Z';
 const policies:HistoryCapturePolicy[]=[{accountId:1,source:'plaid',sourceAccountRef:'synthetic-bank',currency:'USD'},{accountId:2,source:'mmi',sourceAccountRef:'synthetic-debt',currency:'USD'}];
 const receipts:HistoryExternalEvidence[]=[{ownerId:1,accountId:2,source:'mmi',sourceAccountRef:'synthetic-debt',currency:'USD',balanceCents:-15000,asOf:'2026-11-25T11:00:00.000Z',recordedAt:now,recordId:'synthetic-estimate-1',accepted:true,method:'Accepted synthetic statement adjustment',evidence:'Synthetic statement receipt'}];
 const scope=[{id:1,included:true},{id:2,included:true}];
 for(let index=0;index<2;index++){
  const provider=trustedHistoryCaptureProvider(db,access,policies,now,receipts);
  const html=render(Controls,{props:{offers:provider.offers,revision:provider.revision,commandKey:`ui-${index}`,action:'?/captureHistory',canCapture:true}}).body;
  expect(html).toContain('Save this evidence');const nativeForm=html.match(/<form\b[^>]*method="POST"[^>]*>([\s\S]*?)<\/form>/)![1];
  const fields=[...nativeForm.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g)];expect(fields.map(m=>m[1])).toEqual(['history_offer','revision','key']);
  const form=new FormData();for(const field of fields)form.set(field[1],field[2]);captureTrustedHistoryEvidence(db,access,policies,form,now,receipts);
 }
 db.close();db=new Database(join(dir,'synthetic.sqlite'));
 const points=new BudgetEngine(db,1).history(scope,['2026-11-24','2026-11-25']);expect(points.map(p=>p.totalCents)).toEqual([null,-5000]);
 const html=render(Overview,{props:{points,accounts:[{id:1,name:'Synthetic bank'},{id:2,name:'Synthetic debt'}],from:'2026-11-24',to:'2026-11-25'}}).body;
 expect(html).toContain('Accepted estimate');expect(html).toContain('Accepted synthetic statement adjustment');expect(html).toContain('50.00');expect(html).toContain('Coverage gap');
 expect(trustedHistoryCaptureProvider(db,access,policies,now,receipts).offers).toEqual([]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
