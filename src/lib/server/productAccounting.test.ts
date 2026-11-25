import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {closeDbForTests,db} from './db';
import {cashflowForMonths,categoryAmountInPeriod,getHomeSummary,getProductTransaction,monthSpendingCents} from './finance';
import {computeDashboardData} from './dashboard';
import {generateComputedAlerts,listNotifications} from './notifications';
import {productPeriod} from './product';
import {load as overviewLoad} from '../../routes/(app)/+page.server';
import {actions as transactionActions} from '../../routes/(app)/transactions/+page.server';
import {actions as calendarActions} from '../../routes/(app)/calendar/+page.server';
import {load as cashflowLoad} from '../../routes/(app)/cashflow/+page.server';
import {budgetPeriodSpend,getTransactions,saveTransaction,sanitizeCashflowFilters,bulkSetCategory} from './finance';
import {parseTransactionFilters} from './transactionFilters';
const previousPath=process.env.GALENE_DB_PATH;
const previousEphemeral=process.env.GALENE_ALLOW_EPHEMERAL_DATA;
const dir=mkdtempSync(join(tmpdir(),'galene-product-'));
const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const start=`${month}-01`,end=new Date(Date.UTC(now.getFullYear(),now.getMonth()+1,1)).toISOString().slice(0,10);
let income:number,expense:number,transfer:number,account:number,foreignId:number,splitId:number;
beforeAll(()=>{
 closeDbForTests();process.env.GALENE_DB_PATH=join(dir,'synthetic.db');process.env.GALENE_ALLOW_EPHEMERAL_DATA='1';
 const d=db();d.query("INSERT INTO users(id,name,email,password_hash) VALUES (1,'Fixture','fixture@example.invalid','not-an-auth-hash'),(2,'Other','other@example.invalid','not-an-auth-hash')").run();
 account=Number(d.query("INSERT INTO accounts(user_id,name,type) VALUES(1,'Fixture checking','bank')").run().lastInsertRowid);
 income=Number(d.query("INSERT INTO categories(user_id,name,type) VALUES(1,'Fixture pay','income')").run().lastInsertRowid);
 expense=Number(d.query("INSERT INTO categories(user_id,name,type) VALUES(1,'Fixture food','expense')").run().lastInsertRowid);
 transfer=Number(d.query("INSERT INTO categories(user_id,name,type,is_transfer) VALUES(1,'Fixture transfer','expense',1)").run().lastInsertRowid);
 function add(amount:number,category:number|null,pending=0,date=start,user=1){return Number(d.query('INSERT INTO transactions(user_id,account_id,category_id,date,amount_cents,pending) VALUES(?,?,?,?,?,?)').run(user,account,category,date,amount,pending).lastInsertRowid);}
 add(100000,income);add(-10000,income);add(-20000,expense);add(5000,expense);add(40000,transfer);add(-40000,transfer);add(12000,null);add(-8000,null);add(90000,income,1);add(-90000,expense,1);add(-90000,expense,0,end);
 const split=splitId=add(-10000,expense);d.query('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(?,?,?)').run(split,expense,6000);d.query('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(?,?,?)').run(split,transfer,4000);
 foreignId=add(55555,income,0,start,2);
});
afterAll(()=>{closeDbForTests();if(previousPath===undefined)delete process.env.GALENE_DB_PATH;else process.env.GALENE_DB_PATH=previousPath;if(previousEphemeral===undefined)delete process.env.GALENE_ALLOW_EPHEMERAL_DATA;else process.env.GALENE_ALLOW_EPHEMERAL_DATA=previousEphemeral;rmSync(dir,{recursive:true,force:true});});
describe('one posted accounting definition across native pages',()=>{
 test('API summary agrees with category and trends amounts',()=>{
  const s=getHomeSummary(1);expect(s.monthIncomeCents).toBe(90000);expect(s.monthExpenseCents).toBe(21000);
  expect(categoryAmountInPeriod(1,expense,start,end)).toBe(-21000);
  expect(monthSpendingCents(1,start,end,null)).toBe(21000);
 });
 test('cashflow keeps refunds with expenses and reversals with income',()=>{
  const c=cashflowForMonths(1,[month]);expect(c.summary.actualIncomeCents).toBe(90000);expect(c.summary.actualExpenseCents).toBe(21000);
 });
 test('customizable monthly widget uses the same classifier',()=>{
  const result=computeDashboardData(1,[{id:'month',type:'month',x:0,y:0,w:8,h:3,filters:{}}]).month;
  expect(result.kind).toBe('month');if(result.kind==='month'){expect(result.incomeCents).toBe(90000);expect(result.expenseCents).toBe(21000);}
 });
 test('budget actuals and income targets preserve signed corrections',()=>{
  expect(budgetPeriodSpend(1,expense,'month').spentCents).toBe(21000);
  expect(budgetPeriodSpend(1,income,'month').spentCents).toBe(90000);
 });
 test('payroll reminder says income instead of bill',()=>{
  db().query("INSERT INTO scheduled(user_id,name,account_id,category_id,amount_cents,start_date,forecast_behavior) VALUES(1,'Fixture salary',?,?,100000,?,'bill')").run(account,income,start);
  generateComputedAlerts(1,new Date(`${start}T12:00:00Z`));
  const rows=listNotifications(1);expect(rows.some(n=>n.title.includes('Income expected')&&n.title.includes('Fixture salary'))).toBe(true);
  expect(rows.some(n=>n.title.includes('Bill due')&&n.title.includes('Fixture salary'))).toBe(false);
 });
 test('inclusive drilldown range preserves leap-year dates and rejects invalid dates',()=>{
  const p=productPeriod(new URL('http://test.invalid/?date_from=2024-01-01&date_to=2024-12-31'));
  expect([p.from,p.to,p.dateTo]).toEqual(['2024-01-01','2025-01-01','2024-12-31']);
  expect(()=>productPeriod(new URL('http://test.invalid/?date_from=2026-02-30&date_to=2026-03-01'))).toThrow();
 });
 test('posted register filter and largest-amount sorting match drilldown scope',()=>{
  const filters=parseTransactionFilters(new URL(`http://test.invalid/?status=posted&sort=amount&date_from=${start}&date_to=${start}`),50);
  const rows=getTransactions(1,filters).items;
  expect(rows.every(t=>!t.pending&&t.date===start)).toBe(true);
  expect(rows.every((t,i)=>i===0||Math.abs(rows[i-1].amount_cents)>=Math.abs(t.amount_cents))).toBe(true);
 });
 test('unknown sort/status parameters fall back to safe allowlisted values',()=>{
  const filters=parseTransactionFilters(new URL('http://test.invalid/?sort=id%3BDROP%20TABLE%20transactions&status=anything'),50);
  expect(filters.sort).toBe('newest');expect(filters.status).toBe('all');
 });
 test('split amount edits are rejected before any transaction mutation',()=>{
  const before=getProductTransaction(1,splitId)!;db().exec('BEGIN');
  try{
   expect(()=>saveTransaction(1,{id:splitId,type:'expense',amountCents:12000,date:start,account,category:expense,merchant:'Changed',notes:null,color:null,tags:[]})).toThrow('split');
   expect(getProductTransaction(1,splitId)).toEqual(before);
  }finally{db().exec('ROLLBACK');}
 });
 test('budget widget uses the same signed progress as the budget page',()=>{
  const d=db();d.exec('BEGIN');
  try{
   for(const id of [income,expense])d.query("INSERT INTO budgets(user_id,category_id,period,limit_cents) VALUES(1,?,'month',100000)").run(id);
   d.query('INSERT INTO transactions(user_id,account_id,category_id,date,amount_cents) VALUES(1,?,?,?,30000)').run(account,expense,start);
   const widget=computeDashboardData(1,[{id:'budget',type:'budgets',x:0,y:0,w:6,h:4,filters:{}}]).budget;
   expect(widget.kind).toBe('budgets');if(widget.kind==='budgets'){
    expect(widget.items.find(i=>i.categoryName==='Fixture pay')?.spentCents).toBe(budgetPeriodSpend(1,income,'month').spentCents);
    expect(widget.items.find(i=>i.categoryName==='Fixture food')?.spentCents).toBe(budgetPeriodSpend(1,expense,'month').spentCents);
   }
  }finally{d.exec('ROLLBACK');}
 });
 test('advisor overview entry redirects to its scoped transaction page',()=>{
  let result:unknown;
  try{overviewLoad({locals:{user:{id:1,name:'Fixture viewer',email:'viewer@example.invalid',is_admin:0,role:'viewer'}},url:new URL('http://test.invalid/'),depends:()=>{}} as Parameters<typeof overviewLoad>[0]);}catch(error){result=error;}
  expect(result).toMatchObject({status:303,location:'/transactions'});
 });
 test('cashflow filters exclude movement categories consistently',()=>{
  expect(sanitizeCashflowFilters(1,{accountIds:[account],categoryIds:[expense,transfer]})).toEqual({accountIds:[account],categoryIds:[expense]});
 });
 for(const [name,save] of [['activity',transactionActions.save],['calendar',calendarActions.save]] as const){
 test(`${name} rejected split edits leave no newly created records`,async()=>{
  const d=db();const counts=()=>['accounts','categories','tags'].map(table=>(d.query(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=1`).get() as {n:number}).n);
  const before=counts();d.exec('BEGIN');
  try{
   const form=new FormData();for(const [k,v]of Object.entries({id:String(splitId),type:'expense',amount:'120.00',date:start,account_new:'Rejected fixture account',category_new:'Rejected fixture category',tag_new:'Rejected fixture tag'}))form.set(k,v);
   const result=await save({request:new Request('http://test.invalid/',{method:'POST',body:form}),locals:{user:{id:1}}} as Parameters<typeof transactionActions.save>[0] & Parameters<typeof calendarActions.save>[0]);
   expect(result).toHaveProperty('error');expect(counts()).toEqual(before);
  }finally{d.exec('ROLLBACK');}
 });
 }
 test('rejected split allocations do not create a category',async()=>{
  const d=db(),count=()=> (d.query('SELECT COUNT(*) AS n FROM categories WHERE user_id=1').get() as {n:number}).n;
  const before=count();d.exec('BEGIN');
  try{
   const form=new FormData();form.set('id',String(splitId));form.set('type','expense');
   form.append('cat_id','');form.append('cat_new','Rejected split category');form.append('amount','1.00');
   form.append('cat_id',String(expense));form.append('cat_new','');form.append('amount','1.00');
   const result=await transactionActions.split({request:new Request('http://test.invalid/',{method:'POST',body:form}),locals:{user:{id:1}}} as Parameters<typeof transactionActions.split>[0]);
   expect(result).toHaveProperty('error');expect(count()).toBe(before);
  }finally{d.exec('ROLLBACK');}
 });
 test('monthly cashflow returns canonical bounds for a legacy day-range request',()=>{
  const data=cashflowLoad({locals:{user:{id:1}},url:new URL(`http://test.invalid/cashflow?from=${month}-15&to=${month}-20`)} as Parameters<typeof cashflowLoad>[0]);
  expect(data.from).toBe(start);
  expect(data.to).toBe(new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10));
  expect(data.monthList).toEqual([month]);
 });
 test('spread monthly forecast equals its occurrence detail without rounding loss',()=>{
  const d=db();d.exec('BEGIN');
  try{
   d.query("INSERT INTO scheduled(user_id,name,account_id,category_id,amount_cents,start_date,forecast_behavior) VALUES(1,'Fixture spread',?,?,-10001,?,'spread')").run(account,expense,start);
   const data=cashflowLoad({locals:{user:{id:1}},url:new URL(`http://test.invalid/cashflow?from=${start}&to=${month}-20`)} as Parameters<typeof cashflowLoad>[0]);
   const row=data.sections.expense.rows.find(r=>r.categoryId===expense)!;
   expect(row.totalForecastCents).toBe(-10001);
   expect(data.occurrences.filter(o=>o.categoryId===expense).reduce((sum,o)=>sum+o.amountCents,0)).toBe(row.totalForecastCents);
  }finally{d.exec('ROLLBACK');}
 });
 for(const type of ['expense','income'] as const){
 test(`${type} cashflow keeps monthly contributions when the range nets to zero`,()=>{
  const d=db();d.exec('BEGIN');
  try{
   const cat=Number(d.query('INSERT INTO categories(user_id,name,type) VALUES(1,?,?)').run('Cancelling fixture',type).lastInsertRowid);
   const amounts=type==='expense'?[-10000,10000]:[10000,-10000];
   for(const [i,date]of ['2030-01-15','2030-02-15'].entries())d.query('INSERT INTO transactions(user_id,account_id,category_id,date,amount_cents) VALUES(1,?,?,?,?)').run(account,cat,date,amounts[i]);
   const section=cashflowForMonths(1,['2030-01','2030-02']).sections[type];
   const row=section.rows.find(r=>r.categoryId===cat);
   expect(row?.cells.map(c=>c.actualCents)).toEqual(amounts);
   expect(section.monthTotals.map(c=>c.actualCents)).toEqual(amounts);
   expect(section.totalActualCents).toBe(0);
  }finally{d.exec('ROLLBACK');}
 });
 }
 test('unsplit action rejects another owner transaction without deleting allocations',async()=>{
  const d=db();d.exec('BEGIN');
  try{
   d.query('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(?,?,55555)').run(foreignId,income);
   const before=getProductTransaction(2,foreignId);
   const form=new FormData();form.set('id',String(foreignId));form.set('unsplit','1');
   const result=await transactionActions.split({request:new Request('http://test.invalid/',{method:'POST',body:form}),locals:{user:{id:1}}} as Parameters<typeof transactionActions.split>[0]);
   expect(result).toHaveProperty('error');expect(getProductTransaction(2,foreignId)).toEqual(before);
  }finally{d.exec('ROLLBACK');}
 });
 test('mixed-owner bulk categorization rejects the whole batch before any mutation',()=>{
  const d=db();d.exec('BEGIN');
  try{
   d.query('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(?,?,55555)').run(foreignId,income);
   const ownBefore=getProductTransaction(1,splitId),otherBefore=getProductTransaction(2,foreignId);
   expect(()=>bulkSetCategory(1,[splitId,foreignId],transfer)).toThrow('Transaction not found');
   expect(getProductTransaction(1,splitId)).toEqual(ownBefore);expect(getProductTransaction(2,foreignId)).toEqual(otherBefore);
  }finally{d.exec('ROLLBACK');}
 });
 test('bulk category form rejection rolls back a newly requested category',async()=>{
  const d=db();d.exec('BEGIN');
  try{
   const count=()=> (d.query('SELECT COUNT(*) AS n FROM categories WHERE user_id=1').get() as {n:number}).n,before=count();
   const form=new FormData();form.append('ids',String(splitId));form.append('ids',String(foreignId));form.set('category_new','Rejected bulk category');
   let result:unknown;try{result=await transactionActions['bulk-category']({request:new Request('http://test.invalid/',{method:'POST',body:form}),locals:{user:{id:1}}} as Parameters<typeof transactionActions['bulk-category']>[0]);}catch(error){result=error;}
   expect(result).toHaveProperty('error');expect(count()).toBe(before);
  }finally{d.exec('ROLLBACK');}
 });
 for(const mode of ['unsplit','bulk'] as const){
 test(`authorized ${mode} still clears owned splits and preserves other owners`,async()=>{
  const d=db();d.exec('BEGIN');
  try{
   d.query('INSERT INTO transaction_splits(transaction_id,category_id,amount_cents) VALUES(?,?,55555)').run(foreignId,income);
   const other=getProductTransaction(2,foreignId),own=getProductTransaction(1,splitId)!;
   if(mode==='bulk')bulkSetCategory(1,[splitId,splitId],transfer);
   else{
    const form=new FormData();form.set('id',String(splitId));form.set('unsplit','1');
    expect(await transactionActions.split({request:new Request('http://test.invalid/',{method:'POST',body:form}),locals:{user:{id:1}}} as Parameters<typeof transactionActions.split>[0])).toEqual({ok:true});
   }
   expect(getProductTransaction(1,splitId)?.splits??[]).toHaveLength(0);
   expect(getProductTransaction(1,splitId)?.amount_cents).toBe(own.amount_cents);
   expect(getProductTransaction(2,foreignId)).toEqual(other);
  }finally{d.exec('ROLLBACK');}
 });
 }
 test('transaction detail never crosses owner scope',()=>{expect(getProductTransaction(1,foreignId)).toBeNull();});
});
