import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migrate} from '../db';
import {BudgetEngine} from './service';
function fixture(){const d=new Database(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);d.exec(`INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','a@example.test','x'),(2,'Other','b@example.test','x'); INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Cash','bank'),(2,1,'Card','credit'),(3,2,'Other cash','bank'); INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense'),(2,2,'Other food','expense');`);return d;}
const meta=(expectedRevision:number,idempotencyKey:string)=>({expectedRevision,idempotencyKey});
const baseline={asOfDate:'2026-10-31',accounts:[{id:1,scope:'cash' as const,balanceCents:100000},{id:2,scope:'credit' as const,balanceCents:-10000}],evidence:'accepted synthetic current balances'};
test('service activation starts unfunded; transactional assignment survives reread and replay',()=>{
 const d=fixture();const e=new BudgetEngine(d,1);expect(e.view('2026-11').ledger).toBeNull();
 expect(e.activate(baseline,meta(0,'start')).revision).toBe(1);
 const cmd={id:'assign1',date:'2026-11-01',kind:'assign' as const,categoryId:1,amountCents:20000};
 const result=e.allocate(cmd,meta(1,'assign'));expect(result.revision).toBe(2);expect(e.allocate(cmd,meta(1,'assign'))).toEqual(result);
 expect(new BudgetEngine(d,1).view('2026-11').ledger?.readyToAssignCents).toBe(80000);
 expect(()=>e.allocate({...cmd,amountCents:1},meta(1,'assign'))).toThrow('idempotency');
 expect(()=>e.allocate({...cmd,id:'other'},meta(1,'stale'))).toThrow('revision');
 expect(()=>e.allocate({...cmd,id:'foreign',categoryId:2},meta(2,'foreign'))).toThrow('owner');
 expect(new BudgetEngine(d,2).view('2026-11').ledger).toBeNull();d.close();
});
test('targets are versioned; saving a target never assigns cash',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);const t={id:'food',categoryId:1,cadence:'monthly' as const,behavior:'refill' as const,amountCents:20000,startDate:'2026-11-01'};
 e.saveTarget(t,'2026-11',meta(0,'t1'));e.saveTarget({...t,amountCents:30000},'2026-12',meta(1,'t2'));
 expect(e.targets('2026-11')[0].amountCents).toBe(20000);expect(e.targets('2026-12')[0].amountCents).toBe(30000);expect(e.view('2026-11').ledger).toBeNull();
 expect(()=>e.saveTarget({...t,id:'foreign',categoryId:2},'2026-11',meta(2,'t3'))).toThrow('owner');
 e.archiveTarget('food','2027-01',meta(2,'archive'));expect(e.targets('2027-01')).toEqual([]);expect(e.targets('2026-12').length).toBe(1);d.close();
});
test('posted refresh is complete, idempotent and never appends edited expenses twice',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 const coverage={from:'2026-11-01',through:'2026-11-30',complete:true,evidence:'synthetic register'};
 const events=[{id:'tx:1',date:'2026-11-02',kind:'purchase' as const,accountId:1,categoryId:1,amountCents:1000}];
 e.replacePosted(events,coverage,meta(1,'r'));expect(e.view('2026-11').ledger?.cashCents).toBe(99000);
 e.replacePosted([{...events[0],amountCents:2000}],coverage,meta(2,'r2'));expect(e.view('2026-11').ledger?.cashCents).toBe(98000);expect(e.view('2026-11').ledger?.netExpenseCents).toBe(2000);
 expect(e.view('2026-11').coverageComplete).toBe(true);expect(e.view('2026-12').coverageComplete).toBe(false);
 expect(()=>e.replacePosted([], {...coverage,complete:false},meta(3,'bad'))).toThrow('complete');expect(e.view('2026-11').revision).toBe(3);d.close();
});
test('snapshot persistence enforces owner and retains source evidence without invented past',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);const s={accountId:1,balanceCents:100000,asOf:'2026-11-25T12:00:00.000Z',recordedAt:'2026-11-25T12:00:00.000Z',source:'actual' as const,evidence:'synthetic source'};
 e.recordSnapshot('s1',s,meta(0,'s'));e.recordSnapshot('s1',s,meta(1,'again'));
 expect(e.history([{id:1,included:true}],['2026-11-24','2026-11-25']).map(p=>p.totalCents)).toEqual([null,100000]);
 expect(()=>e.recordSnapshot('s2',{...s,accountId:3},meta(2,'foreign'))).toThrow('owner');expect(()=>e.history([{id:3,included:true}],['2026-11-25'])).toThrow('owner');d.close();
});
test('real register seam reprojects edits and refuses stale allocations',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(1,1,1,1,'2026-11-02',-1000)");
 e.refreshRegister('2026-11-30',[],meta(1,'refresh'));
 expect(e.view('2026-11').coverageComplete).toBe(true);
 d.exec('UPDATE transactions SET amount_cents=-2000 WHERE id=1');
 expect(e.view('2026-11').coverageComplete).toBe(false);
 expect(()=>e.allocate({id:'alloc',date:'2026-11-03',kind:'assign',categoryId:1,amountCents:1000},meta(2,'stale'))).toThrow('stale');
 e.refreshRegister('2026-11-30',[],meta(2,'refresh2'));expect(e.view('2026-11').ledger?.cashCents).toBe(98000);
 expect(e.view('2026-11').coverageComplete).toBe(true);d.close();
});
test('monthly view resets assignment/activity totals, not rolled-over cash',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 e.allocate({id:'alloc',date:'2026-11-01',kind:'assign',categoryId:1,amountCents:10000},meta(1,'alloc'));
 e.saveTarget({id:'food',categoryId:1,cadence:'monthly',behavior:'refill',amountCents:20000,startDate:'2026-11-01'},'2026-11',meta(2,'target'));
 expect(e.view('2026-12').ledger?.categories[0]).toMatchObject({assignedCents:0,availableCents:10000});
 expect(e.plan('2026-12',[]).totalCents).toBe(10000);d.close();
});
