import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migrate} from '../db';
import {BudgetEngine} from './service';
function fixture(){const d=new Database(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);d.exec(`INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','a@example.test','x'),(2,'Other','b@example.test','x'); INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Cash','bank'),(2,1,'Card','credit'),(3,2,'Other cash','bank'); INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense'),(2,2,'Other food','expense');`);return d;}
const meta=(expectedRevision:number,idempotencyKey:string)=>({expectedRevision,idempotencyKey});
const baseline={currency:'USD',asOfDate:'2026-10-31',accounts:[{id:1,currency:'USD',scope:'cash' as const,balanceCents:100000},{id:2,currency:'USD',scope:'credit' as const,balanceCents:-10000}],evidence:'accepted synthetic current balances'};
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
 const d=fixture(),e=new BudgetEngine(d,1);const s={accountId:1,currency:'USD',balanceCents:100000,asOf:'2026-11-25T12:00:00.000Z',recordedAt:'2026-11-25T12:00:00.000Z',source:'actual' as const,evidence:'synthetic source'};
 e.recordSnapshot('s1',s,meta(0,'s'));e.recordSnapshot('s1',s,meta(1,'again'));
 expect(e.history([{id:1,included:true}],['2026-11-24','2026-11-25']).map(p=>p.totalCents)).toEqual([null,100000]);
 expect(()=>e.recordSnapshot('s2',{...s,accountId:3},meta(2,'foreign'))).toThrow('owner');expect(()=>e.history([{id:3,included:true}],['2026-11-25'])).toThrow('owner');d.close();
});
test('real register seam reprojects edits and refuses stale allocations',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(1,1,1,1,'2026-11-02',-1000)");
 e.refreshRegister('2026-11-30',[],meta(2,'refresh'));
 expect(e.view('2026-11').coverageComplete).toBe(true);
 d.exec('UPDATE transactions SET amount_cents=-2000 WHERE id=1');
 expect(e.view('2026-11').coverageComplete).toBe(false);
 expect(()=>e.allocate({id:'alloc',date:'2026-11-03',kind:'assign',categoryId:1,amountCents:1000},meta(4,'stale'))).toThrow('stale');
 e.refreshRegister('2026-11-30',[],meta(4,'refresh2'));expect(e.view('2026-11').ledger?.cashCents).toBe(98000);
 expect(e.view('2026-11').coverageComplete).toBe(true);d.close();
});
test('monthly view resets assignment/activity totals, not rolled-over cash',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 e.allocate({id:'alloc',date:'2026-11-01',kind:'assign',categoryId:1,amountCents:10000},meta(1,'alloc'));
 e.saveTarget({id:'food',categoryId:1,cadence:'monthly',behavior:'refill',amountCents:20000,startDate:'2026-11-01'},'2026-11',meta(2,'target'));
 expect(e.view('2026-12').ledger?.categories[0]).toMatchObject({assignedCents:0,availableCents:10000});
 expect(e.plan('2026-12',[]).totalCents).toBe(10000);d.close();
});
test('activation rejects missing cash, mixed currency, omitted accounts and historical reingestion',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);
 expect(()=>e.activate({...baseline,accounts:[{...baseline.accounts[0],balanceCents:null as unknown as number},baseline.accounts[1]]},meta(0,'null'))).toThrow();
 expect(()=>e.activate({...baseline,accounts:baseline.accounts.slice(0,1)},meta(0,'missing'))).toThrow('account coverage');
 expect(()=>e.activate({...baseline,currency:'USD',accounts:baseline.accounts.map((a,i)=>({...a,currency:i?'EUR':'USD'}))},meta(0,'fx'))).toThrow('currency');
 e.activate(baseline,meta(0,'ok'));
 expect(()=>e.replacePosted([{id:'tx:old',date:'2026-10-31',kind:'income',accountId:1,amountCents:1000}],{from:'2026-11-01',through:'2026-11-30',complete:true,evidence:'synthetic'},meta(1,'past'))).toThrow('invalid posted');
 expect(e.view('2026-10').ledger?.cashCents).toBe(100000);expect(e.view('2026-09').ledger).toBeNull();d.close();
});
test('native SQL writers invalidate the optimistic revision, including splits',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(1,1,1,1,'2026-11-02',-1000)");
 expect(e.view('2026-11').revision).toBe(2);
 expect(()=>e.allocate({id:'x',date:'2026-11-02',kind:'assign',categoryId:1,amountCents:100},meta(1,'old'))).toThrow('revision');
 d.exec('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(1,1,1000)');expect(e.view('2026-11').revision).toBe(3);
 d.exec("UPDATE transactions SET amount_cents=-2000 WHERE id=1");expect(e.view('2026-11').revision).toBe(4);
 d.exec('DELETE FROM transaction_splits WHERE transaction_id=1');expect(e.view('2026-11').revision).toBe(5);
 expect(new BudgetEngine(d,2).view('2026-11').revision).toBe(0);d.close();
});
test('new native activity before first refresh and after refreshed window blocks spendable claims',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(1,1,1,1,'2026-11-02',-1000)");
 expect(e.view('2026-11').ledger).toBeNull();
 expect(()=>e.allocate({id:'x',date:'2026-11-03',kind:'assign',categoryId:1,amountCents:100},meta(2,'x'))).toThrow('stale');
 e.refreshRegister('2026-11-10',[],meta(2,'r'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(2,1,1,1,'2026-11-12',-1000)");
 expect(e.view('2026-11').ledger).toBeNull();d.close();
});
test('new account cannot silently disappear from cash coverage',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 d.exec("INSERT INTO accounts(id,user_id,name,type) VALUES(4,1,'New cash','bank')");
 expect(e.view('2026-11').ledger).toBeNull();expect(e.view('2026-11').coverageComplete).toBe(false);d.close();
});
test('income goals cannot become expense targets or funded spending envelopes',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);d.exec("INSERT INTO categories(id,user_id,name,type) VALUES(5,1,'Wages','income')");
 expect(()=>e.saveTarget({id:'salary',categoryId:5,amountCents:10000,cadence:'monthly',behavior:'set_aside',startDate:'2026-11-01'},'2026-11',meta(0,'t'))).toThrow('income');
 e.activate(baseline,meta(0,'a'));expect(()=>e.allocate({id:'incomealloc',date:'2026-11-01',kind:'assign',categoryId:5,amountCents:100},meta(1,'i'))).toThrow('income');d.close();
});
test('target edit must not introduce a future category conflict',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);const t={categoryId:1,amountCents:10000,cadence:'monthly' as const,behavior:'refill' as const,startDate:'2026-11-01'};
 e.saveTarget({...t,id:'later'},'2026-12',meta(0,'later'));
 expect(()=>e.saveTarget({...t,id:'earlier'},'2026-11',meta(1,'earlier'))).toThrow('duplicate');expect(e.targets('2026-11')).toEqual([]);d.close();
});
test('atomic dashboard DTO preserves target-met versus empty cash after reload',()=>{
 const d=fixture(),e=new BudgetEngine(d,1);e.activate(baseline,meta(0,'a'));
 e.saveTarget({id:'t',categoryId:1,amountCents:10000,cadence:'monthly',behavior:'set_aside',startDate:'2026-11-01'},'2026-11',meta(1,'t'));
 e.allocate({id:'a1',date:'2026-11-01',kind:'assign',categoryId:1,amountCents:10000},meta(2,'a1'));
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(1,1,1,1,'2026-11-02',-10000)");
 e.refreshRegister('2026-11-30',[],meta(4,'refresh'));
 const dto=new BudgetEngine(d,1).dashboard('2026-11',[]);expect(dto.categoryStates[0]).toMatchObject({categoryId:1,targetStatus:'met',cashStatus:'empty',availableCents:0});expect(dto.view.ledger?.netExpenseCents).toBe(10000);d.close();
});
