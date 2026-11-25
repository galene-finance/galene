// Test-only loopback fixture. No import from production routes and no live DB.
import {existsSync,mkdirSync} from 'node:fs';import {Database} from 'bun:sqlite';
if(process.env.ATLAS_SYNTHETIC_MOVE_QA!=='1'||process.env.GALENE_DB_PATH!=='/scratch/move-money/db.sqlite'||!existsSync('/.dockerenv'))throw new Error('Isolated synthetic Docker lane required');
const {migrate}=await import('../src/lib/server/db');const {BudgetEngine}=await import('../src/lib/server/budgetEngine/service');const {movingMoneyModel,movingMoneyCommand}=await import('../src/lib/server/movingMoneyFeature');
mkdirSync('/scratch/move-money',{recursive:true});const d=new Database('/scratch/move-money/db.sqlite');d.exec('PRAGMA foreign_keys=ON');migrate(d);
if(!d.query('SELECT id FROM users WHERE id=1').get()){
 d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic owner','owner@example.test','not-a-login');INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Everyday cash','bank'),(2,1,'Everyday card','credit');INSERT INTO categories(id,user_id,name,type,is_transfer) VALUES(1,1,'Groceries','expense',0),(2,1,'Eating out','expense',0),(4,1,'Card payment','expense',1)");
 const seed=new BudgetEngine(d,1);seed.activate({currency:'USD',asOfDate:'2024-01-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:100000},{id:2,currency:'USD',scope:'credit',balanceCents:-20000}],evidence:'synthetic accepted day-end fixture'},{expectedRevision:0,idempotencyKey:'start'});seed.refreshRegister('2024-02-29',[],{expectedRevision:1,idempotencyKey:'refresh'});seed.allocate({id:'seed',date:'2024-02-01',kind:'assign',categoryId:1,amountCents:30000},{expectedRevision:2,idempotencyKey:'seed'});
}
const e=new BudgetEngine(d,1),origin='http://127.0.0.1:24867',url=new URL(`${origin}/budget?month=2024-02`),locals={user:{id:1,role:'owner'}};
Bun.serve({hostname:'127.0.0.1',port:5174,async fetch(request){
 const incoming=new URL(request.url);if(incoming.pathname!=='/__moveqa')return new Response('Not found',{status:404});
 let result;
 if(request.method==='POST'){
  if(request.headers.get('origin')!==origin)return new Response('Origin refused',{status:403});
  const fixture=incoming.searchParams.get('fixture'),kind=incoming.searchParams.get('kind');
  if(fixture){
   if(fixture==='purchase')d.exec("INSERT OR IGNORE INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(1,1,2,1,'2024-02-02',-10000,'Synthetic purchase')");
   else if(fixture==='refund')d.exec("INSERT OR IGNORE INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(2,1,2,1,'2024-02-03',2500,'Synthetic refund')");
   else if(fixture==='payment')d.exec("INSERT OR IGNORE INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(3,1,1,4,'2024-02-04',-5000,'Synthetic payment'),(4,1,2,4,'2024-02-04',5000,'Synthetic payment')");
   else return new Response('Unknown fixture action',{status:400});
   const pairs=d.query('SELECT id FROM transactions WHERE id=3').get()?[{outflowId:3,inflowId:4}]:[];
   e.refreshRegister('2024-02-29',pairs,{expectedRevision:e.view('2024-02').revision,idempotencyKey:`fixture-${crypto.randomUUID()}`});
  }else if(kind==='move'||kind==='reserve')result=await movingMoneyCommand(kind,{database:d,locals,request,url,today:'2024-02-29'});
  else return new Response('Unknown action',{status:400});
 }else if(request.method!=='GET')return new Response('Method refused',{status:405});
 return Response.json({fixture:true,authScope:'synthetic owner context only',model:movingMoneyModel(d,1,'2024-02','2024-02-29'),commandKey:crypto.randomUUID(),result});
}});
const child=Bun.spawn(['bun','run','node_modules/vite/bin/vite.js','--config','ui-preview/move-money-vite.config.ts'],{stdout:'inherit',stderr:'inherit',env:process.env});process.on('SIGTERM',()=>{child.kill();d.close();process.exit(0);});process.exit(await child.exited);
