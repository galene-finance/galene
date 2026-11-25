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
import {budgetPeriodSpend,getTransactions,saveTransaction,sanitizeCashflowFilters} from './finance';
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
 test('transaction detail never crosses owner scope',()=>{expect(getProductTransaction(1,foreignId)).toBeNull();});
});
