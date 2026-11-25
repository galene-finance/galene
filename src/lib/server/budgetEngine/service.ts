import type {Database} from 'bun:sqlite';
import type {BudgetAccount,CommandMeta,LedgerEvent,Target,TargetProgress,BalanceSnapshot,HistoryAccount} from '../../budget/types';
import {targetCycle,evaluateTarget,costToBeMe} from '../../budget/targets';
import {validateSnapshot,netWorthHistory} from '../../budget/history';
import {projectLedger} from '../../budget/ledger';
import {categoryFundingState} from '../../budget/state';
import {add,civil,monthEnd,monthStart} from '../../budget/validation';
import {readRegister,type TransferPair} from './register';
export type Activation={currency:string;asOfDate:string;accounts:BudgetAccount[];evidence:string};
export class BudgetEngine {
 constructor(private database:Database,readonly ownerId:number){
  if(!Number.isSafeInteger(ownerId)||!database.query('SELECT id FROM users WHERE id=?').get(ownerId))throw new Error('unknown owner');
 }
 private state(){return this.database.query('SELECT revision,baseline_json,activity_through,register_json FROM budget_engine_state WHERE owner_id=?').get(this.ownerId) as {revision:number;baseline_json:string|null;activity_through:string|null;register_json:string|null}|null;}
 private own(table:'accounts'|'categories',id:number){if(!this.database.query(`SELECT id FROM ${table} WHERE id=? AND user_id=?`).get(id,this.ownerId))throw new Error('owner scope mismatch');if(table==='categories'&&this.database.query("SELECT id FROM categories WHERE id=? AND type='income' AND is_transfer=0").get(id))throw new Error('income is not a spending envelope');}
 private categories(){return (this.database.query('SELECT id FROM categories WHERE user_id=? ORDER BY id').all(this.ownerId) as {id:number}[]).map(r=>r.id);}
 private events(){return (this.database.query("SELECT payload FROM budget_engine_events WHERE owner_id=? ORDER BY date,CASE WHEN kind='allocation' THEN 0 ELSE 1 END,sequence").all(this.ownerId) as {payload:string}[]).map(r=>JSON.parse(r.payload) as LedgerEvent);}
 private command(kind:string,payload:unknown,meta:CommandMeta,write:()=>void){
  if(!Number.isSafeInteger(meta.expectedRevision)||meta.expectedRevision<0||typeof meta.idempotencyKey!=='string'||!meta.idempotencyKey.trim()||meta.idempotencyKey.length>200)throw new Error('invalid command metadata');
  const encoded=JSON.stringify({kind,payload});
  return this.database.transaction(()=>{
   const old=this.database.query('SELECT payload,result FROM budget_engine_receipts WHERE owner_id=? AND key=?').get(this.ownerId,meta.idempotencyKey) as {payload:string;result:string}|null;
   if(old){if(old.payload!==encoded)throw new Error('idempotency conflict');return JSON.parse(old.result) as {revision:number};}
   const revision=this.state()?.revision??0;if(revision!==meta.expectedRevision)throw new Error('revision conflict');
   this.database.query('INSERT OR IGNORE INTO budget_engine_state(owner_id) VALUES(?)').run(this.ownerId);
   write();const result={revision:revision+1};
   this.database.query('UPDATE budget_engine_state SET revision=? WHERE owner_id=?').run(result.revision,this.ownerId);
   this.database.query('INSERT INTO budget_engine_receipts(owner_id,key,payload,result) VALUES(?,?,?,?)').run(this.ownerId,meta.idempotencyKey,encoded,JSON.stringify(result));
   return result;
  }).immediate();
 }
 activate(baseline:Activation,meta:CommandMeta){return this.command('activate',baseline,meta,()=>{
  civil(baseline.asOfDate);if(this.state()?.baseline_json)throw new Error('already active');if(!baseline.evidence.trim()||!baseline.accounts.length)throw new Error('accepted baseline evidence required');
  const roster=this.database.query('SELECT id FROM accounts WHERE user_id=?').all(this.ownerId) as {id:number}[];
  if(roster.length!==baseline.accounts.length||roster.some(a=>!baseline.accounts.some(b=>b.id===a.id)))throw new Error('complete account coverage required');
  if(!/^[A-Z]{3}$/.test(baseline.currency)||baseline.accounts.some(a=>a.currency!==baseline.currency))throw new Error('single explicit currency required');
  for(const a of baseline.accounts)this.own('accounts',a.id);
  projectLedger(baseline.accounts,this.categories(),[],baseline.asOfDate);
  this.database.query('UPDATE budget_engine_state SET baseline_json=?,activity_through=? WHERE owner_id=?').run(JSON.stringify(baseline),baseline.asOfDate,this.ownerId);
 });}
 allocate(event:LedgerEvent,meta:CommandMeta){return this.command('allocate',event,meta,()=>{
  if(!['assign','move','reserve'].includes(event.kind))throw new Error('allocation command required');
  const state=this.state();if(!state?.baseline_json)throw new Error('not active');const b=JSON.parse(state.baseline_json) as Activation;
  if(event.date<=b.asOfDate)throw new Error('before baseline');
  if('categoryId'in event&&event.categoryId!==undefined)this.own('categories',event.categoryId);if('fromCategoryId'in event){this.own('categories',event.fromCategoryId);this.own('categories',event.toCategoryId);}if('accountId'in event)this.own('accounts',event.accountId);
  civil(event.date);
  // Stage under the command's IMMEDIATE transaction so replay uses exactly the
  // persisted same-day allocation/posting order. Any failed check rolls it back.
  this.database.query('INSERT INTO budget_engine_events(owner_id,event_id,kind,date,payload) VALUES(?,?,?,?,?)').run(this.ownerId,event.id,'allocation',event.date,JSON.stringify(event));
  const events=this.events();
  const horizon=events.reduce((last,e)=>e.date>last?e.date:last,state.activity_through&&state.activity_through>event.date?state.activity_through:event.date);
  if(this.registerStale(horizon))throw new Error('stale register; refresh required');
  const index=events.findIndex(e=>e.id===event.id);
  const affectedIds=events.slice(index).filter(e=>['assign','move','reserve'].includes(e.kind)).map(e=>e.id);
  // Revalidate the new intent AND every later commitment, not only its date.
  // Older source corrections stay truthful; a later corrective command must
  // still be allowed to repair them rather than re-rejecting the old history.
  projectLedger(b.accounts,this.categories(),events,horizon,{validateAllocationIds:affectedIds});
  const before=events.filter(e=>e.id!==event.id);
  const checkpoints=[...new Set([event.date,horizon,...events.filter(e=>e.date>=event.date).map(e=>e.date)])].sort();
  for(const date of checkpoints){
   const old=projectLedger(b.accounts,this.categories(),before,date,{validateAllocationIds:[]});
   const proposed=projectLedger(b.accounts,this.categories(),events,date,{validateAllocationIds:[]});
   if(proposed.cashBackingShortfallCents>old.cashBackingShortfallCents)throw new Error('insufficient funds across committed timeline');
  }
 });}
 saveTarget(target:Target,effectiveMonth:string,meta:CommandMeta){return this.command('target',{target,effectiveMonth},meta,()=>{
  monthStart(effectiveMonth);this.own('categories',target.categoryId);targetCycle(target,effectiveMonth);
  const prior=this.database.query('SELECT category_id FROM budget_engine_targets WHERE owner_id=? AND target_id=? LIMIT 1').get(this.ownerId,target.id) as {category_id:number}|null;
  if(prior&&prior.category_id!==target.categoryId)throw new Error('target category immutable');
  this.database.query('INSERT INTO budget_engine_targets(owner_id,target_id,version,category_id,effective_month,payload) VALUES(?,?,?,?,?,?)').run(this.ownerId,target.id,(this.state()?.revision??0)+1,target.categoryId,effectiveMonth,JSON.stringify(target));
  const months=this.database.query('SELECT DISTINCT effective_month FROM budget_engine_targets WHERE owner_id=? AND effective_month>=?').all(this.ownerId,effectiveMonth) as {effective_month:string}[];
  for(const m of months)this.targets(m.effective_month); // validate future versions too
 });}
 archiveTarget(id:string,effectiveMonth:string,meta:CommandMeta){return this.command('archive-target',{id,effectiveMonth},meta,()=>{
  monthStart(effectiveMonth);const prior=this.database.query('SELECT category_id FROM budget_engine_targets WHERE owner_id=? AND target_id=? ORDER BY version DESC LIMIT 1').get(this.ownerId,id) as {category_id:number}|null;
  if(!prior)throw new Error('unknown target');
  this.database.query('INSERT INTO budget_engine_targets(owner_id,target_id,version,category_id,effective_month,payload) VALUES(?,?,?,?,?,NULL)').run(this.ownerId,id,(this.state()?.revision??0)+1,prior.category_id,effectiveMonth);
 });}
 targets(month:string):Target[]{
  monthStart(month);const rows=this.database.query('SELECT target_id,payload FROM budget_engine_targets WHERE owner_id=? AND effective_month<=? ORDER BY effective_month DESC,version DESC').all(this.ownerId,month) as {target_id:string;payload:string|null}[];
  const seen=new Set<string>(),categories=new Set<number>(),out:Target[]=[];
  for(const r of rows){if(seen.has(r.target_id))continue;seen.add(r.target_id);if(!r.payload)continue;const t=JSON.parse(r.payload) as Target;if(categories.has(t.categoryId))throw new Error('duplicate active category target');categories.add(t.categoryId);out.push(t);}return out;
 }
 legacyTargets(){return this.database.query('SELECT budget_id,category_id,cadence,amount_cents,needs_review FROM budget_engine_legacy_targets WHERE owner_id=? ORDER BY budget_id').all(this.ownerId);}
 replacePosted(events:LedgerEvent[],coverage:{from:string;through:string;complete:boolean;evidence:string},meta:CommandMeta){return this.command('posted-refresh',{events,coverage},meta,()=>{
  const state=this.state();if(!state?.baseline_json)throw new Error('not active');const b=JSON.parse(state.baseline_json) as Activation;
  civil(coverage.from);civil(coverage.through);const next=new Date(civil(b.asOfDate).getTime()+86400000).toISOString().slice(0,10);
  if(coverage.complete!==true||coverage.from!==next||coverage.through<coverage.from||!coverage.evidence.trim())throw new Error('complete baseline-to-current coverage required');
  if(state.activity_through&&coverage.through<state.activity_through)throw new Error('coverage regression');
  for(const event of events){
   if(['assign','move','reserve'].includes(event.kind)||!event.id.startsWith('tx:')||event.date<coverage.from||event.date>coverage.through)throw new Error('invalid posted event');
   if('categoryId'in event&&event.categoryId!==undefined)this.own('categories',event.categoryId);
   if('accountId'in event)this.own('accounts',event.accountId);if('fromAccountId'in event){this.own('accounts',event.fromAccountId);this.own('accounts',event.toAccountId);}
  }
  this.database.query("DELETE FROM budget_engine_events WHERE owner_id=? AND kind='posted'").run(this.ownerId);
  for(const e of events)this.database.query('INSERT INTO budget_engine_events(owner_id,event_id,kind,date,payload) VALUES(?,?,?,?,?)').run(this.ownerId,e.id,'posted',e.date,JSON.stringify(e));
  projectLedger(b.accounts,this.categories(),this.events(),coverage.through,{validateAllocationIds:[]});
  this.database.query('UPDATE budget_engine_state SET activity_through=? WHERE owner_id=?').run(coverage.through,this.ownerId);
 });}
 private registerStale(through:string):boolean {
  const s=this.state();if(!s?.baseline_json)return false;
  const b=JSON.parse(s.baseline_json) as Activation;
  const roster=this.database.query('SELECT id FROM accounts WHERE user_id=?').all(this.ownerId) as {id:number}[];
  if(roster.length!==b.accounts.length||roster.some(a=>!b.accounts.some(x=>x.id===a.id)))return true;
  if(!s.register_json)return !!this.database.query('SELECT 1 FROM transactions WHERE user_id=? AND pending=0 AND date>? AND date<=? LIMIT 1').get(this.ownerId,b.asOfDate,through);
  const r=JSON.parse(s.register_json) as {from:string;through:string;pairs:TransferPair[];fingerprint:string};
  if(readRegister(this.database,this.ownerId,r.from,r.through,r.pairs).fingerprint!==r.fingerprint)return true;
  return !!this.database.query('SELECT 1 FROM transactions WHERE user_id=? AND pending=0 AND date>? AND date<=? LIMIT 1').get(this.ownerId,r.through,through);
 }
 refreshRegister(through:string,pairs:TransferPair[],meta:CommandMeta){
  // Hold the same write lock for native-row capture and derived-event replacement.
  return this.database.transaction(()=>{
   const s=this.state();if(!s?.baseline_json)throw new Error('not active');const b=JSON.parse(s.baseline_json) as Activation;
   const from=new Date(civil(b.asOfDate).getTime()+86400000).toISOString().slice(0,10);
   const r=readRegister(this.database,this.ownerId,from,through,pairs);
   if(r.issues.length)throw new Error('register needs classification or transfer review');
   const result=this.replacePosted(r.events,{from,through,complete:true,evidence:'native-register:'+r.fingerprint},meta);
   this.database.query('UPDATE budget_engine_state SET register_json=? WHERE owner_id=?').run(JSON.stringify({from,through,pairs,fingerprint:r.fingerprint}),this.ownerId);
   return result;
  }).immediate();
 }
 recordSnapshot(sourceKey:string,snapshot:BalanceSnapshot,meta:CommandMeta){return this.command('snapshot',{sourceKey,snapshot},meta,()=>{
  if(!sourceKey.trim())throw new Error('source identity required');validateSnapshot(snapshot);this.own('accounts',snapshot.accountId);
  const old=this.database.query('SELECT payload FROM budget_engine_snapshots WHERE owner_id=? AND source_key=?').get(this.ownerId,sourceKey) as {payload:string}|null;
  const payload=JSON.stringify(snapshot);if(old){if(old.payload!==payload)throw new Error('snapshot identity conflict');return;}
  this.database.query('INSERT INTO budget_engine_snapshots(owner_id,source_key,account_id,as_of,payload) VALUES(?,?,?,?,?)').run(this.ownerId,sourceKey,snapshot.accountId,snapshot.asOf,payload);
 });}
 history(accounts:HistoryAccount[],dates:string[]){
  for(const a of accounts)this.own('accounts',a.id);
  const rows=this.database.query('SELECT payload FROM budget_engine_snapshots WHERE owner_id=? ORDER BY as_of').all(this.ownerId) as {payload:string}[];
  return netWorthHistory(accounts,rows.map(r=>JSON.parse(r.payload) as BalanceSnapshot),dates);
 }
 view(month:string,asOfDate=monthEnd(month)){
  civil(asOfDate);if(asOfDate.slice(0,7)!==month)throw new Error('cutoff outside month');
  const through=asOfDate,state=this.state();const baseline=state?.baseline_json?JSON.parse(state.baseline_json) as Activation:null;
  const stale=this.registerStale(through);
  const ledger=baseline&&through>=baseline.asOfDate&&!stale?projectLedger(baseline.accounts,this.categories(),this.events(),through,{validateAllocationIds:[]}):null;
  if(ledger&&baseline){
   const before=new Date(civil(monthStart(month)).getTime()-86400000).toISOString().slice(0,10);
   const prior=projectLedger(baseline.accounts,this.categories(),this.events(),before,{validateAllocationIds:[]});
   for(const c of ledger.categories){const old=prior.categories.find(p=>p.categoryId===c.categoryId)!;c.assignedCents=add(c.assignedCents,-old.assignedCents);c.activityCents=add(c.activityCents,-old.activityCents);}
   ledger.netExpenseCents=add(ledger.netExpenseCents,-prior.netExpenseCents);
  }
  return {version:1,revision:state?.revision??0,baseline,activityThrough:state?.activity_through??null,coverageComplete:!stale&&!!state?.activity_through&&state.activity_through>=through,registerStale:stale,ledger};
 }
 dashboard(month:string,obligations:{id:string;categoryId:number|null;amountCents:number}[],asOfDate=monthEnd(month)){
  return this.database.transaction(()=>{
   const view=this.view(month,asOfDate),plan=this.plan(month,obligations,asOfDate);
   const categoryStates=this.categories().map(categoryId=>({categoryId,...categoryFundingState(view.ledger?.categories.find(c=>c.categoryId===categoryId)??null,plan.lines.find(l=>l.categoryId===categoryId)??null,view.coverageComplete,view.ledger?.cashBackingShortfallCents??0)}));
   return {version:1 as const,view,plan,categoryStates,legacyTargets:this.legacyTargets()};
  })();
 }
 plan(month:string,obligations:{id:string;categoryId:number|null;amountCents:number}[],asOfDate=monthEnd(month)){
  const view=this.view(month,asOfDate),targets=this.targets(month),progress=new Map<number,TargetProgress>();
  const events=this.events(),b=view.baseline;
  for(const t of targets){
   const cycle=targetCycle(t,month);const before=new Date(civil(cycle.start).getTime()-86400000).toISOString().slice(0,10);
   const prior=b?projectLedger(b.accounts,this.categories(),events,before,{validateAllocationIds:[]}):null;
   let cycleAssignedCents=0,monthAssignedCents=0;
   for(const e of events){if(e.date>asOfDate||e.date<cycle.start)continue;let n=0;if(e.kind==='assign'&&e.categoryId===t.categoryId)n=e.amountCents;if(e.kind==='move')n=e.toCategoryId===t.categoryId?e.amountCents:e.fromCategoryId===t.categoryId?-e.amountCents:0;cycleAssignedCents=add(cycleAssignedCents,n);if(e.date.slice(0,7)===month)monthAssignedCents=add(monthAssignedCents,n);}
   progress.set(t.categoryId,{cycleAssignedCents,monthAssignedCents,cycleStartAvailableCents:prior?.categories.find(c=>c.categoryId===t.categoryId)?.availableCents??0,availableCents:view.ledger?.categories.find(c=>c.categoryId===t.categoryId)?.availableCents??0});
  }
  return {...costToBeMe(targets,month,progress,obligations),fundingKnown:!!view.ledger&&view.coverageComplete,progressStartsAt:b?.asOfDate??null};
 }
}
