// TEST-ONLY lane: native Plan loader/actions + disposable synthetic SQLite.
// Never imported by production routes. No login bypass exists in the production app.
import {existsSync} from 'node:fs';
if(process.env.ATLAS_SYNTHETIC_BUDGET_QA!=='1'||process.env.GALENE_DB_PATH!=='/scratch/galene-budget-qa/db.sqlite'||!existsSync('/.dockerenv'))throw new Error('Requires the isolated synthetic Docker lane');
const {db}=await import('../src/lib/server/db');
const {BudgetEngine}=await import('../src/lib/server/budgetEngine/service');
const {load,actions}=await import('../src/routes/(app)/budget/+page.server');
const {productOverview}=await import('../src/lib/server/product');
const {load:reflectLoad,actions:reflectActions}=await import('../src/routes/(app)/reflect/+page.server');
const {load:setupLoad,actions:setupActions}=await import('../src/routes/(app)/budget/setup/+page.server');
const setupMode=process.env.ATLAS_QA_START_WITHOUT_BASELINE==='1';
const {load:categoryLoad}=await import('../src/routes/(app)/categories/[id]/+page.server');
const origin=process.env.ATLAS_QA_ORIGIN??'http://127.0.0.1:24863';
if(!['http://127.0.0.1:24863','http://127.0.0.1:24865','http://127.0.0.1:24911','http://127.0.0.1:24912','http://127.0.0.1:24913','http://127.0.0.1:24914'].includes(origin))throw new Error('Unsupported synthetic origin');
const user={id:1,name:'Synthetic owner',email:'fixture@example.test',is_admin:1,role:'owner' as const};
const d=db();
if(!d.query('SELECT id FROM users WHERE id=1').get()){
 d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic owner','fixture@example.test','not-a-real-login');INSERT INTO accounts(id,user_id,name,type,opening_balance_cents,opening_as_of) VALUES(1,1,'Synthetic cash','bank',100000,'2024-01-01'),(2,1,'Synthetic card','credit',-30000,'2024-01-01'),(3,1,'Synthetic savings','bank',0,'2024-01-01');INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Synthetic groceries','expense'),(2,1,'Synthetic annual bills','expense');INSERT INTO categories(id,user_id,name,type,is_transfer) VALUES(3,1,'Synthetic transfer','expense',1);INSERT INTO budgets(id,user_id,category_id,period,limit_cents) VALUES(1,1,2,'year',120000);");
 if(setupMode)d.exec("INSERT INTO accounts(id,user_id,name,type) VALUES(4,1,'Synthetic Apple','credit');UPDATE accounts SET provider='plaid',external_id='synthetic-'||id,provider_balance_cents=CASE WHEN id=1 THEN 100000 ELSE 0 END,provider_balance_as_of='2024-01-02 12:00:00' WHERE id IN(1,3)");
 const engine=new BudgetEngine(d,1);if(!setupMode)engine.activate({currency:'USD',asOfDate:'2023-12-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:100000},{id:2,currency:'USD',scope:'credit',balanceCents:-30000},{id:3,currency:'USD',scope:'cash',balanceCents:0}],evidence:'Synthetic day-end test fixture'}, {expectedRevision:0,idempotencyKey:'fixture-baseline'});
 engine.saveTarget({id:'food',categoryId:1,amountCents:20000,cadence:'monthly',behavior:'set_aside',startDate:'2024-01-01'},'2024-01',{expectedRevision:engine.view('2024-01').revision,idempotencyKey:'fixture-target'});
 if(!setupMode)engine.refreshRegister('2024-02-29',[],{expectedRevision:2,idempotencyKey:'fixture-coverage'});
 if(!setupMode)for(const [i,accountId,balanceCents,day] of [[0,1,100000,'01'],[1,2,-30000,'01'],[2,1,97000,'03'],[3,3,0,'01']] as const)engine.recordSnapshot(`synthetic-evidence:${i}`,{accountId,balanceCents,currency:'USD',asOf:`2024-01-${day}T23:59:00.000Z`,recordedAt:'2024-01-04T00:00:00.000Z',source:'actual',evidence:'Explicit synthetic dated fixture evidence'},{expectedRevision:3+i,idempotencyKey:`synthetic-snapshot:${i}`});
}
// Explicit synthetic evidence, distinct from native observations; never a production source.
const financeEvidence=setupMode?{ownerId:1,timeZone:'UTC',closingCatalog:(owner:number,date:string)=>owner===1&&date==='2023-12-31'?[1,2,3,4].map(id=>({reference:`synthetic-closing-${id}`,ownerId:1,accountId:id,currency:'USD',balanceCents:({1:100000,2:-30000,3:0,4:-5000} as Record<number,number>)[id],asOfDate:date,timeZone:'UTC',cutoff:'end_of_day' as const,source:id===2?'accepted_estimate' as const:'actual' as const,description:id===2?'Explicit synthetic accepted closing estimate':'Explicit synthetic closing evidence',recordedAt:'2024-01-01T12:00:00.000Z'})):[],historyPolicies:[{accountId:1,currency:'USD',source:'plaid' as const,sourceAccountRef:'synthetic-1'},{accountId:2,currency:'USD',source:'mmi' as const,sourceAccountRef:'synthetic-mmi'},{accountId:3,currency:'USD',source:'plaid' as const,sourceAccountRef:'synthetic-3'},{accountId:4,currency:'USD',source:'ynab_apple' as const,sourceAccountRef:'synthetic-apple'}],historyReceipts:[{ownerId:1,accountId:2,source:'mmi' as const,sourceAccountRef:'synthetic-mmi',recordId:'synthetic-mmi-jan2',currency:'USD',balanceCents:-30000,asOf:'2024-01-02T16:00:00.000Z',recordedAt:'2024-01-03T00:00:00.000Z',evidence:'Synthetic statement receipt',accepted:true,method:'Synthetic approved method'},{ownerId:1,accountId:4,source:'ynab_apple' as const,sourceAccountRef:'synthetic-apple',recordId:'synthetic-apple-jan2',currency:'USD',balanceCents:-5000,asOf:'2024-01-02T17:00:00.000Z',recordedAt:'2024-01-03T00:00:00.000Z',evidence:'Synthetic Apple-only ledger receipt'}]}:undefined;
const fixtureLocals={user,viewer:null,apiToken:null,financeEvidence};
Bun.serve({hostname:'127.0.0.1',port:5174,async fetch(request){
 const incoming=new URL(request.url),month=incoming.searchParams.get('date')?.slice(0,7)??incoming.searchParams.get('month')??'2024-01';
 if(incoming.pathname==='/__qa/reflect'||incoming.pathname==='/__qa/setup'){
  const isSetup=incoming.pathname==='/__qa/setup',url=new URL(`${origin}/${isSetup?'budget/setup':'reflect'}${incoming.search}`);let form:unknown;
  try{
   if(request.method==='POST'){
    if(request.headers.get('origin')!==origin)return new Response('Origin refused',{status:403});
    const native=new Request(url,{method:'POST',headers:request.headers,body:await request.arrayBuffer()});
    const result=await(isSetup?setupActions.baselineSetup:reflectActions.captureHistory)({locals:fixtureLocals,request:native,url} as any);form='data'in result?result.data:result;
   }else if(request.method!=='GET')return new Response('Method refused',{status:405});
   return Response.json({fixture:true,form,data:(isSetup?setupLoad:reflectLoad)({locals:fixtureLocals,url} as any)});
  }catch{return Response.json({fixture:true,error:'Synthetic source/setup request failed'},{status:500});}
 }
 if(incoming.pathname==='/__qa/home'&&request.method==='GET')return Response.json({fixture:true,data:productOverview(1,new URL(`${origin}/${incoming.search}`))});
 if(incoming.pathname==='/__qa/category'&&request.method==='GET')return Response.json({fixture:true,data:categoryLoad({locals:{user},params:{id:'1'},url:new URL(`${origin}/categories/1${incoming.search}`)} as any)});
 if(incoming.pathname!=='/__qa/budget'||!/^2024-(0[1-9]|1[0-2])$/.test(month))return new Response('Not found',{status:404});
 const url=new URL(`${origin}/budget${incoming.search}`);if(!url.searchParams.has('date')&&!url.searchParams.has('month'))url.searchParams.set('month',month);const locals={user,viewer:null,apiToken:null};let form:unknown;
 try{
  if(request.method==='POST'){
   if(request.headers.get('origin')!==origin)return new Response('Origin refused',{status:403});
   const action=incoming.searchParams.get('action');
   if(action==='transferFixture'){d.exec("INSERT OR IGNORE INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(10,1,1,3,'2024-01-10',-10000,'Synthetic transfer out'),(11,1,3,3,'2024-01-10',10000,'Synthetic transfer in')");form={ok:true};}
   else if(action==='purchase'||action==='refund'){
    const id=action==='purchase'?1:2,amount=action==='purchase'?-20000:5000,date=action==='purchase'?'2024-01-02':'2024-01-03';
    d.query('INSERT OR IGNORE INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(?,1,1,1,?,?,?)').run(id,date,amount,`Synthetic ${action}`);form={ok:true};
   }else if(action==='allocate'||action==='refresh'||action==='target'||action==='archiveTarget'||action==='moveMoney'||action==='cardReserve'||action==='reviewTransfers'){
    const native=new Request(url,{method:'POST',headers:request.headers,body:await request.arrayBuffer()});
    const result=await actions[action]({locals,request:native,url} as any);form='data'in result?result.data:result;
   }else return new Response('Unknown fixture action',{status:400});
  }else if(request.method!=='GET')return new Response('Method refused',{status:405});
  return Response.json({fixture:true,authScope:'synthetic owner context, not production session acceptance',form,data:load({locals,url} as any)});
 }catch{return Response.json({fixture:true,error:'Synthetic integration request failed'},{status:500});}
}});
const child=Bun.spawn(['bun','run','node_modules/vite/bin/vite.js','--config','ui-preview/vite.config.ts','--host','0.0.0.0','--port','5173'],{stdout:'inherit',stderr:'inherit',env:{...process.env,VITE_NATIVE_BUDGET_QA:'1'}});
process.on('SIGTERM',()=>{child.kill();process.exit(0);});
process.exit(await child.exited);
