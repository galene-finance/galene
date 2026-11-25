import {beforeAll,afterAll,test,expect} from 'bun:test';
import {plugin} from 'bun';import {readFileSync} from 'node:fs';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';
plugin({name:'budget-ui-ssr',setup(build){build.onLoad({filter:/(TargetEditor|TargetSettings|FundingOverview|FundingAmount|FinancialBadge|CategoryPill)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {db,closeDbForTests} from './db';import {BudgetEngine} from './budgetEngine/service';
import {productOverview} from './product';
import {load,actions} from '../../routes/(app)/budget/+page.server';
import {load as categoryLoad} from '../../routes/(app)/categories/[id]/+page.server';
const user={id:1,name:'Synthetic owner',email:'owner@example.test',is_admin:1,role:'owner' as const};
const url=new URL('https://synthetic.invalid/budget?month=2024-01');let dir:string;let prior:Record<string,string|undefined>;
beforeAll(()=>{prior={GALENE_DATA_DIR:process.env.GALENE_DATA_DIR,GALENE_DB_PATH:process.env.GALENE_DB_PATH,GALENE_ALLOW_EPHEMERAL_DATA:process.env.GALENE_ALLOW_EPHEMERAL_DATA};closeDbForTests();dir=mkdtempSync(join(tmpdir(),'budget-ui-'));process.env.GALENE_DATA_DIR=dir;process.env.GALENE_DB_PATH=join(dir,'test.sqlite');process.env.GALENE_ALLOW_EPHEMERAL_DATA='1';const d=db();d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic owner','owner@example.test','unused'),(2,'Other','other@example.test','unused');INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Synthetic cash','bank');INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense'),(2,2,'Other food','expense');");});
afterAll(()=>{closeDbForTests();rmSync(dir,{recursive:true,force:true});for(const [k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;});
function event(fields:Record<string,string>,who:any=user,origin=url.origin){return {url,locals:{user:who,viewer:null,apiToken:null},request:new Request(url,{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)})} as any;}
const page=()=>load({locals:{user},url} as any) as any;
test('native Plan assignment action, register correction and loader reload preserve authoritative bubble states',async()=>{
 expect(typeof (actions as any).allocate).toBe('function');
 expect(page().funding.view.ledger).toBeNull();
 const e=new BudgetEngine(db(),1);
 e.activate({currency:'USD',asOfDate:'2023-12-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:100000}],evidence:'Synthetic end-of-day fixture'}, {expectedRevision:0,idempotencyKey:'start'});
 e.saveTarget({id:'food',categoryId:1,amountCents:20000,cadence:'monthly',behavior:'set_aside',startDate:'2024-01-01'},'2024-01',{expectedRevision:e.view('2024-01').revision,idempotencyKey:'target'});
 e.refreshRegister('2024-02-29',[],{expectedRevision:e.view('2024-01').revision,idempotencyKey:'refresh'});
 const fields={category_id:'1',amount:'200.00',date:'2024-01-01',revision:String(page().funding.view.revision),key:'ui-assign'};
 const action=await (actions as any).allocate(event(fields));expect(action.ok).toBe(true);
 const {default:Funding}=await import('../components/FundingOverview.svelte');
 const rendered=()=>render(Funding,{props:{...page()}}).body;
 expect(rendered()).toContain('Funded');
 let loaded=page();expect(loaded.funding.view.ledger.readyToAssignCents).toBe(80000);expect(loaded.funding.categoryStates[0]).toMatchObject({targetStatus:'met',cashStatus:'available',availableCents:20000});
 expect(await (actions as any).allocate(event(fields))).toEqual(action);expect(page().funding.view.ledger.readyToAssignCents).toBe(80000);
 db().query("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(1,1,1,1,'2024-01-02',-20000,'Synthetic purchase')").run();
 expect(page().funding.view.ledger).toBeNull();
 const refreshed=await (actions as any).refresh(event({revision:String(page().funding.view.revision),key:'refresh-after-spend'}));expect(refreshed.ok).toBe(true);
 loaded=page();expect(loaded.funding.categoryStates[0]).toMatchObject({targetStatus:'met',cashStatus:'empty',availableCents:0});
 expect(page().funding.view.activityThrough).toBe('2024-02-29');closeDbForTests();expect(page().funding.categoryStates[0].availableCents).toBe(0);
 expect(rendered()).toContain('Target met');expect(rendered()).toContain('No cash left');expect(rendered()).not.toContain('>Funded<');
 db().query("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents,merchant) VALUES(2,1,1,1,'2024-01-03',5000,'Synthetic refund')").run();
 expect((await (actions as any).refresh(event({revision:String(page().funding.view.revision),key:'refresh-after-refund'}))).ok).toBe(true);
 expect(page().funding.categoryStates[0]).toMatchObject({targetStatus:'met',cashStatus:'available',availableCents:5000});
 const detail=categoryLoad({locals:{user},params:{id:'1'},url:new URL('https://synthetic.invalid/categories/1?date_from=2024-01-01&date_to=2024-01-31&funding_month=2024-01')} as any) as any;expect(detail.totalCents).toBe(-15000);expect(detail.funding.state.availableCents).toBe(5000);expect(detail.funding.state.activityCents).toBe(detail.totalCents);
 const scoped=categoryLoad({locals:{user},params:{id:'1'},url:new URL('https://synthetic.invalid/categories/1?month=2024-01&account=1')} as any) as any;expect(scoped.funding).toBeNull();
 const before=page().funding.view;const bad=await (actions as any).allocate(event({...fields,amount:'100000.00',revision:String(before.revision),key:'too-much'}));expect(bad.status).toBe(400);expect(page().funding.view.revision).toBe(before.revision);expect(page().funding.view.ledger).toEqual(before.ledger);
 const foreign=await (actions as any).allocate(event({...fields,category_id:'2',revision:String(before.revision),key:'foreign'}));expect(foreign.status).toBe(400);
 await expect((actions as any).allocate(event(fields,{...user,role:'viewer'}))).rejects.toMatchObject({status:403});
 await expect((actions as any).allocate(event(fields,null))).rejects.toMatchObject({status:303});
 expect((await (actions as any).allocate(event(fields,user,'https://wrong.invalid'))).status).toBe(403);
});

test('native target versions support annual dates, weekly boundaries, archive and no-baseline planning without assigning cash',async()=>{
 expect(typeof (actions as any).target).toBe('function');
 db().exec("INSERT INTO categories(id,user_id,name,type) VALUES(3,1,'Synthetic annual goal','expense')");
 expect((await (actions as any).refresh(event({revision:String(page().funding.view.revision),key:'target-fixture-refresh'}))).ok).toBe(true);
 const before=page().funding.view.ledger;expect(before).not.toBeNull();
 const target={target_id:'annual-ui',category_id:'3',amount:'1200.00',cadence:'annual',behavior:'set_aside',start_date:'2024-01-01',due_date:'2024-12-31',effective_month:'2024-01',revision:String(page().funding.view.revision),key:'annual-create'};
 expect((await (actions as any).target(event(target))).ok).toBe(true);expect(page().targetSpecs.find((t:any)=>t.id==='annual-ui')).toMatchObject({cadence:'annual',dueDate:'2024-12-31',amountCents:120000});expect(page().funding.view.ledger).toEqual(before);expect(page().funding.plan.lines.find((t:any)=>t.targetId==='annual-ui').plannedCents).toBe(10000);
 const {default:Editor}=await import('../components/TargetEditor.svelte');const formHtml=render(Editor,{props:{target:page().targetSpecs.find((t:any)=>t.id==='annual-ui'),categories:page().categories,month:'2024-01',revision:page().funding.view.revision,commandKey:'synthetic'}}).body;expect(formHtml).toContain('name="due_date"');expect(formHtml).toContain('2024-12-31');expect(formHtml).toContain('?/target');expect(formHtml).toContain('Version effective month');
 expect((productOverview(1,new URL('https://synthetic.invalid/?month=2024-01')) as any).configuredPlan.totalCents).toBe(page().funding.plan.totalCents);
 const version={...target,amount:'2400.00',effective_month:'2024-02',revision:String(page().funding.view.revision),key:'annual-version'};expect((await (actions as any).target(event(version))).ok).toBe(true);
 expect(page().targetSpecs.find((t:any)=>t.id==='annual-ui').amountCents).toBe(120000);
 const feb=load({locals:{user},url:new URL('https://synthetic.invalid/budget?month=2024-02')} as any) as any;expect(feb.targetSpecs.find((t:any)=>t.id==='annual-ui').amountCents).toBe(240000);expect(feb.funding.view.ledger.readyToAssignCents).toBe(before.readyToAssignCents);
 const invalid={...target,due_date:'2023-01-01',revision:String(page().funding.view.revision),key:'invalid-due'};const revision=page().funding.view.revision;expect((await (actions as any).target(event(invalid))).status).toBe(400);expect(page().funding.view.revision).toBe(revision);
 expect((await (actions as any).archiveTarget(event({target_id:'annual-ui',effective_month:'2024-02',revision:String(revision),key:'archive'}))).ok).toBe(true);expect((load({locals:{user},url:new URL('https://synthetic.invalid/budget?month=2024-02')} as any) as any).targetSpecs.some((t:any)=>t.id==='annual-ui')).toBe(false);expect(page().targetSpecs.some((t:any)=>t.id==='annual-ui')).toBe(true);
 const other={...user,id:2};const otherPage=()=>load({locals:{user:other},url} as any) as any;
 expect((await (actions as any).target(event({target_id:'weekly-ui',category_id:'2',amount:'10.00',cadence:'weekly',behavior:'set_aside',start_date:'2024-01-19',weekday:'1',effective_month:'2024-01',revision:String(otherPage().funding.view.revision),key:'weekly'},other))).ok).toBe(true);
 expect(otherPage().funding.plan.totalCents).toBe(2000);expect(otherPage().funding.view.baseline).toBeNull();expect(otherPage().funding.view.ledger).toBeNull();
});

test('target editor explains refill and balance progress without calling either assigned cash',async()=>{
 const {default:Editor}=await import('../components/TargetEditor.svelte');
 const common={categories:page().categories,month:'2024-01',revision:page().funding.view.revision,commandKey:'explain',target:{id:'food',categoryId:1,amountCents:10000,cadence:'monthly' as const,startDate:'2024-01-01'}};
 const refill=render(Editor,{props:{...common,target:{...common.target,behavior:'refill'}}}).body;
 expect(refill).toContain('missing at the start of the cycle');expect(refill).toContain('Spending within that cycle does not create a new refill requirement');
 const balance=render(Editor,{props:{...common,target:{...common.target,behavior:'balance'}}}).body;
 expect(balance).toContain('current category balance');expect(balance).toContain('Spending can increase what is needed');
});

test('native refill and balance edits preserve cash and reject conflicting target retries',async()=>{
 const before=page().funding.view.ledger;expect(before).not.toBeNull();
 const command={target_id:'food',category_id:'1',amount:'100.00',cadence:'monthly',behavior:'refill',start_date:'2024-01-01',effective_month:'2024-01',revision:String(page().funding.view.revision),key:'refill-behavior'};
 const saved=await (actions as any).target(event(command));expect(saved.ok).toBe(true);
 const refill=page();expect(refill.funding.categoryStates.find((c:any)=>c.categoryId===1)).toMatchObject({targetStatus:'met',availableCents:5000,neededThisMonthCents:0});expect(refill.funding.view.ledger).toEqual(before);
 expect(await (actions as any).target(event(command))).toEqual(saved);expect(page().funding.view.revision).toBe(refill.funding.view.revision);
 expect((await (actions as any).target(event({...command,amount:'101.00'}))).status).toBe(400);expect(page().funding.view.revision).toBe(refill.funding.view.revision);
 expect((await (actions as any).target(event({...command,key:'stale-target'}))).status).toBe(400);expect(page().funding.view.revision).toBe(refill.funding.view.revision);
 expect((await (actions as any).target(event({...command,behavior:'balance',revision:String(refill.funding.view.revision),key:'balance-behavior'}))).ok).toBe(true);
 const balance=page();expect(balance.funding.categoryStates.find((c:any)=>c.categoryId===1)).toMatchObject({targetStatus:'needs_funding',availableCents:5000,neededThisMonthCents:5000});expect(balance.funding.view.ledger).toEqual(before);
 const denied=await (actions as any).target(event({...command,category_id:'2',revision:String(balance.funding.view.revision),key:'foreign-target'}));expect(denied.status).toBe(400);expect(page().funding.view.revision).toBe(balance.funding.view.revision);
 const tooLarge=await (actions as any).target(event({...command,target_id:'x'.repeat(17000),revision:String(balance.funding.view.revision),key:'oversize-target'}));expect(tooLarge.status).toBe(400);expect(page().funding.view.revision).toBe(balance.funding.view.revision);
});

test('native refresh retains explicit persisted transfer matches and refuses changed matches',async()=>{
 let d=db();d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(3,'Pair owner','pair@example.test','unused');INSERT INTO accounts(id,user_id,name,type) VALUES(31,3,'Cash one','bank'),(32,3,'Cash two','bank');INSERT INTO categories(id,user_id,name,type,is_transfer) VALUES(31,3,'Transfers','expense',1);");
 let e=new BudgetEngine(d,3);e.activate({currency:'USD',asOfDate:'2023-12-31',accounts:[{id:31,currency:'USD',scope:'cash',balanceCents:100000},{id:32,currency:'USD',scope:'cash',balanceCents:0}],evidence:'Synthetic paired-transfer baseline'},{expectedRevision:0,idempotencyKey:'pair-base'});
 d.exec("INSERT INTO transactions(id,user_id,account_id,category_id,date,amount_cents) VALUES(31,3,31,31,'2024-01-02',-10000),(32,3,32,31,'2024-01-02',10000)");
 const pairs=[{outflowId:31,inflowId:32}];e.refreshRegister('2024-02-29',pairs,{expectedRevision:e.view('2024-01').revision,idempotencyKey:'explicit-pair'});
 const prior=e.view('2024-01');const refreshEvent=()=>{const v=event({revision:String(e.view('2024-01').revision),key:'retain-pair'});v.locals.user={...user,id:3};return v;};
 const result=await (actions as any).refresh(refreshEvent());expect(result.ok).toBe(true);expect(e.view('2024-01').ledger).toEqual(prior.ledger);
 const stored=()=>String((d.query('SELECT register_json FROM budget_engine_state WHERE owner_id=3').get() as any).register_json);
 expect(JSON.parse(stored()).pairs).toEqual(pairs);expect(e.view('2024-01').activityThrough).toBe('2024-02-29');
 const {transferPairCatalog}=await import('./budgetIntegration');expect(transferPairCatalog(3,'2024-02-29')).toMatchObject({status:'verified',pairs});expect(transferPairCatalog(1,'2024-02-29').pairs).toEqual([]);
 closeDbForTests();d=db();e=new BudgetEngine(d,3);expect(transferPairCatalog(3,'2024-02-29')).toMatchObject({status:'verified',pairs});expect(e.view('2024-01').ledger).toEqual(prior.ledger);
 d.exec('UPDATE transactions SET amount_cents=9000 WHERE id=32');const before=stored(),revision=e.view('2024-01').revision;expect(transferPairCatalog(3,'2024-02-29').status).toBe('needs_review');
 const bad=refreshEvent();bad.request=new Request(bad.url,{method:'POST',headers:{origin:bad.url.origin},body:new URLSearchParams({revision:String(revision),key:'reject-changed-pair'})});
 const refused=await (actions as any).refresh(bad);expect(refused.status).toBe(400);expect(refused.data.error).toContain('transfer matches need review');expect(stored()).toBe(before);expect(e.view('2024-01').revision).toBe(revision);expect(e.view('2024-01').ledger).toBeNull();
 d.exec('UPDATE transactions SET amount_cents=10000 WHERE id=32');expect(transferPairCatalog(3,'2024-02-29').status).toBe('verified');
 d.exec('UPDATE transactions SET pending=1 WHERE id=32');expect(transferPairCatalog(3,'2024-02-29').status).toBe('needs_review');
 d.exec('UPDATE transactions SET pending=0,account_id=1 WHERE id=32');expect(transferPairCatalog(3,'2024-02-29').status).toBe('needs_review');
 d.exec('UPDATE transactions SET account_id=32 WHERE id=32');expect(transferPairCatalog(3,'2024-02-29').status).toBe('verified');
 const corrupt={...JSON.parse(stored()),pairs:[{outflowId:31,inflowId:32,categoryId:1}]};d.query('UPDATE budget_engine_state SET register_json=? WHERE owner_id=3').run(JSON.stringify(corrupt));expect(transferPairCatalog(3,'2024-02-29').status).toBe('needs_review');
 d.query('UPDATE budget_engine_state SET register_json=? WHERE owner_id=3').run(before);d.exec('DELETE FROM transactions WHERE id=32');expect(transferPairCatalog(3,'2024-02-29').status).toBe('needs_review');
});
