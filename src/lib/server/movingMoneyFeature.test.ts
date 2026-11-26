import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {migrate} from './db';
import {BudgetEngine} from './budgetEngine/service';
import {movingMoneyCommand,movingMoneyModel} from './movingMoneyFeature';
function fixture(){const d=new Database(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic owner','owner@example.test','x'),(2,'Other','other@example.test','x');INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Everyday cash','bank'),(2,1,'Everyday card','credit'),(3,2,'Other cash','bank');INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Groceries','expense'),(2,1,'Eating out','expense'),(3,2,'Other category','expense');");const e=new BudgetEngine(d,1);e.activate({currency:'USD',asOfDate:'2024-01-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:100000},{id:2,currency:'USD',scope:'credit',balanceCents:-20000}],evidence:'synthetic fixture'},{expectedRevision:0,idempotencyKey:'start'});e.refreshRegister('2024-02-29',[],{expectedRevision:1,idempotencyKey:'refresh'});e.allocate({id:'seed',date:'2024-02-01',kind:'assign',categoryId:1,amountCents:30000},{expectedRevision:2,idempotencyKey:'seed'});return {d,e};}
const url=new URL('http://synthetic.invalid/budget?month=2024-02');
const user={id:1,role:'owner'};
function request(fields:Record<string,string>){return new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});}
test('feature move command persists and reloads conserved category allocations',async()=>{
 const {d}=fixture();try{const fields={from_category_id:'1',to_category_id:'2',amount:'75.25',date:'2024-02-20',revision:'3',key:'move-one'};
 const result=await movingMoneyCommand('move',{database:d,locals:{user},url,request:request(fields),today:'2024-02-29'});expect(result.ok).toBe(true);
 const model=movingMoneyModel(d,1,'2024-02','2024-02-29');expect(Object.fromEntries(model.categories.map(c=>[c.id,c.availableCents]))).toEqual({1:22475,2:7525});expect(model.readyToAssignCents).toBe(70000);expect(model.cashCents).toBe(100000);
 expect(await movingMoneyCommand('move',{database:d,locals:{user},url,request:request(fields),today:'2024-02-29'})).toEqual(result);
 }finally{d.close();}
});
const baseFields={from_category_id:'1',to_category_id:'2',amount:'10.00',date:'2024-02-20',revision:'3',key:'command'};
function run(d:Database,kind:'move'|'reserve',fields:Record<string,string>,extra:Record<string,unknown>={}){return movingMoneyCommand(kind,{database:d,locals:{user},url,request:request(fields),today:'2024-02-29',...extra});}
test('partial coverage fails closed without saving allocations',async()=>{const {d}=fixture();try{d.exec("UPDATE budget_engine_state SET activity_through='2024-02-10'");expect((await run(d,'move',baseFields)).ok).toBe(false);expect(d.query("SELECT count(*) AS n FROM budget_engine_events WHERE event_id LIKE 'ui-money:%'").get()).toEqual({n:0});}finally{d.close();}});
test('unclassified signed activity withholds every moving-money claim',()=>{const {d,e}=fixture();try{
 e.replacePosted([{id:'tx:unclassified',date:'2024-02-02',kind:'unclassified',accountId:1,amountCents:-1000}],{from:'2024-02-01',through:'2024-02-29',complete:true,evidence:'synthetic signed source'},{expectedRevision:3,idempotencyKey:'unclassified'});
 const model=movingMoneyModel(d,1,'2024-02','2024-02-29');expect(model).toMatchObject({known:false,reason:'Categorize posted activity before moving allocations.',cashCents:null,readyToAssignCents:null,assignableCents:null,shortfallCents:null});expect(model.categories.every(c=>c.availableCents===null&&c.creditOverspentCents===null)).toBe(true);expect(model.cards.every(c=>c.reservedCents===null&&c.debtCents===null)).toBe(true);
 }finally{d.close();}});
test('reserve adds and releases budget funds, never executes a payment',async()=>{const {d}=fixture();try{
 const accountRows=d.query('SELECT * FROM accounts ORDER BY id').all();
 const f={account_id:'2',direction:'add',amount:'50.00',date:'2024-02-20',revision:'3',key:'card-add'};expect((await run(d,'reserve',f)).ok).toBe(true);
 expect(movingMoneyModel(d,1,'2024-02','2024-02-29').cards[0]).toMatchObject({reservedCents:5000,cashBackedReserveCents:5000,debtCents:20000,unfundedCents:15000});
 expect((await run(d,'reserve',{...f,direction:'release',amount:'20.00',revision:'4',key:'card-release'})).ok).toBe(true);
 expect(movingMoneyModel(d,1,'2024-02','2024-02-29')).toMatchObject({readyToAssignCents:67000,cashCents:100000});expect(d.query('SELECT * FROM accounts ORDER BY id').all()).toEqual(accountRows);expect(d.query('SELECT count(*) AS n FROM transactions').get()).toEqual({n:0});
 }finally{d.close();}});
test('stale revision, conflicting retry, same category, overcommit and foreign identities preserve saved state',async()=>{const {d,e}=fixture();try{
 expect((await run(d,'move',baseFields)).ok).toBe(true);const before=e.view('2024-02');
 for(const fields of [{...baseFields,key:'stale'},{...baseFields,amount:'11.00'},{...baseFields,revision:'4',key:'same',to_category_id:'1'},{...baseFields,revision:'4',key:'large',amount:'500.00'},{...baseFields,revision:'4',key:'foreign',to_category_id:'3'}])expect((await run(d,'move',fields)).ok).toBe(false);
 expect(e.view('2024-02')).toEqual(before);
 }finally{d.close();}});
test('auth, demo, origin, methods and malformed or excessive input are refused',async()=>{const {d,e}=fixture();try{const before=e.view('2024-02');
 for(const extra of [{locals:{user:null}},{locals:{user:{...user,role:'viewer'}}},{locals:{user,apiToken:{}}},{demo:true},{request:new Request(url)},{request:new Request(url,{method:'POST',headers:{origin:'http://other.invalid'},body:new URLSearchParams(baseFields)})}])expect((await run(d,'move',baseFields,extra)).ok).toBe(false);
 for(const amount of ['0','-1','1.001','1e2','900719925474099.99'])expect((await run(d,'move',{...baseFields,amount})).ok).toBe(false);
 expect((await run(d,'move',{...baseFields,date:'2024-03-01'})).ok).toBe(false);expect((await run(d,'move',{...baseFields,key:'x'.repeat(9000)})).ok).toBe(false);expect(e.view('2024-02')).toEqual(before);
 }finally{d.close();}});
test('card purchase, refund and payment update the same feature model without double-counting expense',()=>{const {d,e}=fixture();try{
 e.replacePosted([{id:'tx:p',date:'2024-02-02',kind:'purchase',accountId:2,categoryId:1,amountCents:10000},{id:'tx:r',date:'2024-02-03',kind:'refund',accountId:2,categoryId:1,amountCents:2000},{id:'tx:pay',date:'2024-02-04',kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:8000}],{from:'2024-02-01',through:'2024-02-29',complete:true,evidence:'synthetic posted source'},{expectedRevision:3,idempotencyKey:'posted'});
 const m=movingMoneyModel(d,1,'2024-02','2024-02-29');expect(m.cards[0]).toMatchObject({reservedCents:0,debtCents:20000});expect(m.cashCents).toBe(92000);expect(m.categories.find(c=>c.id===1)?.availableCents).toBe(22000);expect(e.view('2024-02').ledger?.netExpenseCents).toBe(8000);
 }finally{d.close();}});
