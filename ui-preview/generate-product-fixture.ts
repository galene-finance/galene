// Synthetic browser-test fixture generator. Never opens the live Galene database.
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {accounts,categories,transactions,scheduled} from './product-fixtures';
const dir=mkdtempSync(join(tmpdir(),'galene-component-fixture-'));
process.env.GALENE_DB_PATH=join(dir,'synthetic.db');process.env.GALENE_ALLOW_EPHEMERAL_DATA='1';
const {db,closeDbForTests}=await import('../src/lib/server/db');
const f=await import('../src/lib/server/finance');
try{
 const d=db();d.query("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic preview','preview@example.invalid','not-an-authentication-hash')").run();
 for(const a of accounts)d.query('INSERT INTO accounts(id,user_id,name,type,provider,provider_balance_cents,provider_balance_as_of) VALUES(?,1,?,?,?,?,?)').run(a.id,a.name,a.type,a.provider,a.provider_balance_cents,a.provider_balance_as_of);
 for(const c of categories)d.query('INSERT INTO categories(id,user_id,name,type,is_transfer) VALUES(?,1,?,?,?)').run(c.id,c.name,c.type==='transfer'?'expense':c.type,c.type==='transfer'?1:0);
 for(const t of transactions)d.query('INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant,pending) VALUES(?,1,?,?,?,?,?,?)').run(t.id,t.account_id,t.category_id,t.date,t.amount_cents,t.merchant,t.pending?1:0);
 for(const s of scheduled)d.query('INSERT INTO scheduled(id,user_id,name,account_id,category_id,amount_cents,start_date,repeat_interval,repeat_unit,forecast_behavior) VALUES(?,1,?,?,?,?,?,?,?,?)').run(s.id,s.name,s.account_id,s.category_id,s.amount_cents,s.start_date,s.repeat_interval,s.repeat_unit,s.forecast_behavior);
 const months=['2026-11'];
 const data={synthetic:true,cashflow:f.cashflowForMonths(1,months),plannedDrill:scheduled.flatMap(s=>f.expandScheduled(s,'2026-11-01','2026-11-30').map(o=>({id:s.id,month:o.date.slice(0,7),date:o.date,categoryId:s.category_id,name:s.name,amountCents:o.scheduled.amount_cents,behavior:s.forecast_behavior}))),transactions:f.getTransactionsInPeriod(1,'2026-11-01','2026-12-01')};
 writeFileSync(new URL('./native-fixture.json',import.meta.url),JSON.stringify(data,null,2));
 console.log('Synthetic native-calculation fixture generated; no live database accessed.');
}finally{closeDbForTests();rmSync(dir,{recursive:true,force:true});}
