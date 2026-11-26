import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migrate} from '../db';
import {BudgetEngine} from './service';
import {evaluateTarget} from '../../budget/targets';
import type {LedgerEvent,Target} from '../../budget/types';
function fixture(){
 const d=new Database(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);
 d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','qa@example.test','x');INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Cash','bank'),(2,1,'Card','credit');INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense'),(2,1,'Travel','expense')");
 const e=new BudgetEngine(d,1);e.activate({currency:'USD',asOfDate:'2026-10-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:100000},{id:2,currency:'USD',scope:'credit',balanceCents:-100000}],evidence:'synthetic accepted day-end baseline'},{expectedRevision:0,idempotencyKey:'activate'});
 e.refreshRegister('2026-11-30',[],{expectedRevision:1,idempotencyKey:'refresh'});return {d,e};
}
function saved(d:Database){return JSON.stringify({state:d.query('SELECT * FROM budget_engine_state').all(),events:d.query('SELECT * FROM budget_engine_events ORDER BY sequence').all(),receipts:d.query('SELECT * FROM budget_engine_receipts ORDER BY key').all()});}
function put(e:BudgetEngine,event:LedgerEvent){return e.allocate(event,{expectedRevision:e.view('2026-11').revision,idempotencyKey:event.id});}
test('QA-B01 rejects backdated assignment against a later committed assignment atomically',()=>{
 const {d,e}=fixture();try{
  put(e,{id:'late',date:'2026-11-20',kind:'assign',categoryId:1,amountCents:80000});const before=saved(d);
  expect(()=>put(e,{id:'early',date:'2026-11-01',kind:'assign',categoryId:2,amountCents:80000})).toThrow('insufficient');
  expect(saved(d)).toBe(before);expect(e.view('2026-11').ledger?.readyToAssignCents).toBe(20000);expect(e.view('2026-11').coverageComplete).toBe(true);
 }finally{d.close();}
});
const zero={cycleAssignedCents:0,monthAssignedCents:0,cycleStartAvailableCents:0,availableCents:0};
test('QA-B02 weekly first cycle counts only Nov23 and Nov30 after Nov20 activation',()=>{
 const t:Target={id:'weekly',categoryId:1,cadence:'weekly',behavior:'set_aside',amountCents:1000,weekday:1,startDate:'2026-11-20'};
 expect(evaluateTarget(t,'2026-11',zero)).toMatchObject({cycleStart:'2026-11-20',goalCents:2000,plannedCents:2000,neededThisMonthCents:2000});
 expect(evaluateTarget(t,'2026-12',zero).goalCents).toBe(4000);
});
test('backdated reserve cannot consume funds already committed to a later assignment',()=>{
 const {d,e}=fixture();try{
  put(e,{id:'later',date:'2026-11-20',kind:'assign',categoryId:1,amountCents:80000});const before=saved(d);
  expect(()=>put(e,{id:'reserve',date:'2026-11-01',kind:'reserve',accountId:2,amountCents:80000})).toThrow('insufficient');expect(saved(d)).toBe(before);
 }finally{d.close();}
});
test('backdated unassignment and move cannot invalidate a later committed category move',()=>{
 for(const kind of ['assign','move'] as const){const {d,e}=fixture();try{
  put(e,{id:'fund',date:'2026-11-01',kind:'assign',categoryId:1,amountCents:80000});
  put(e,{id:'later',date:'2026-11-20',kind:'move',fromCategoryId:1,toCategoryId:2,amountCents:80000});const before=saved(d);
  const early:LedgerEvent=kind==='assign'?{id:'early',date:'2026-11-10',kind,categoryId:1,amountCents:-40000}:{id:'early',date:'2026-11-10',kind,fromCategoryId:1,toCategoryId:2,amountCents:40000};
  expect(()=>put(e,early)).toThrow('insufficient');expect(saved(d)).toBe(before);
 }finally{d.close();}}
});
test('safe backdated assignment preserves later commitments and exact receipt replay',()=>{
 const {d,e}=fixture();try{
  put(e,{id:'later',date:'2026-11-20',kind:'assign',categoryId:1,amountCents:80000});
  const early:LedgerEvent={id:'early',date:'2026-11-01',kind:'assign',categoryId:2,amountCents:20000};
  const meta={expectedRevision:e.view('2026-11').revision,idempotencyKey:early.id};const receipt=e.allocate(early,meta);
  expect(e.allocate(early,meta)).toEqual(receipt);expect(e.view('2026-11').ledger?.readyToAssignCents).toBe(0);expect(e.view('2026-11').ledger?.categories.map(c=>c.availableCents)).toEqual([80000,20000]);
 }finally{d.close();}
});
test('backdating cannot bypass already known later cash spending even without later assignments',()=>{
 const {d,e}=fixture();try{
  e.replacePosted([{id:'tx:cash',date:'2026-11-20',kind:'purchase',accountId:1,categoryId:1,amountCents:80000}],{from:'2026-11-01',through:'2026-11-30',complete:true,evidence:'synthetic complete source'},{expectedRevision:2,idempotencyKey:'activity'});
  const before=saved(d);expect(()=>put(e,{id:'early',date:'2026-11-01',kind:'assign',categoryId:2,amountCents:80000})).toThrow('insufficient');expect(saved(d)).toBe(before);
 }finally{d.close();}
});
test('a later income cannot hide an intermediate-day overcommit introduced by backdating',()=>{
 const {d,e}=fixture();try{
  e.replacePosted([{id:'tx:expense',date:'2026-11-10',kind:'purchase',accountId:1,categoryId:1,amountCents:80000},{id:'tx:income',date:'2026-11-25',kind:'income',accountId:1,amountCents:80000}],{from:'2026-11-01',through:'2026-11-30',complete:true,evidence:'synthetic complete source'},{expectedRevision:2,idempotencyKey:'activity'});
  const before=saved(d);expect(()=>put(e,{id:'early',date:'2026-11-01',kind:'assign',categoryId:2,amountCents:80000})).toThrow('insufficient');expect(saved(d)).toBe(before);
 }finally{d.close();}
});
test('a new repair is allowed after truthful source correction made an older allocation overcommitted',()=>{
 const {d,e}=fixture();try{
  put(e,{id:'old',date:'2026-11-20',kind:'assign',categoryId:1,amountCents:80000});
  e.replacePosted([{id:'tx:correction',date:'2026-11-10',kind:'income',accountId:1,amountCents:-60000}],{from:'2026-11-01',through:'2026-11-30',complete:true,evidence:'synthetic source correction'},{expectedRevision:3,idempotencyKey:'corrected'});
  expect(e.view('2026-11').ledger?.readyToAssignCents).toBe(-40000);
  put(e,{id:'repair',date:'2026-11-25',kind:'assign',categoryId:1,amountCents:-40000});expect(e.view('2026-11').ledger?.readyToAssignCents).toBe(0);
 }finally{d.close();}
});
test('weekly start includes its matching weekday, handles zero remaining days and leap February',()=>{
 const t:Target={id:'w',categoryId:1,cadence:'weekly',behavior:'set_aside',amountCents:1000,weekday:1,startDate:'2026-11-23'};
 expect(evaluateTarget(t,'2026-11',zero).goalCents).toBe(2000);
 expect(evaluateTarget({...t,startDate:'2026-11-30'},'2026-11',zero).goalCents).toBe(1000);
 expect(evaluateTarget({...t,startDate:'2026-11-30',weekday:2},'2026-11',zero).goalCents).toBe(0);
 expect(evaluateTarget({...t,startDate:'2024-02-28',weekday:4},'2024-02',zero).goalCents).toBe(1000);
});
