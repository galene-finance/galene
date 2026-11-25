import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {migrate} from '../db';
import {BudgetEngine} from './service';
test('two actual SQLite writer processes cannot allocate the same revision twice',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'budget-concurrency-'));const path=join(dir,'synthetic.db');
 try{
  const d=new Database(path);d.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000');migrate(d);
  d.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','synthetic@example.test','x');INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Cash','bank');INSERT INTO categories(id,user_id,name,type) VALUES(1,1,'Food','expense');");
  const e=new BudgetEngine(d,1);e.activate({currency:'USD',asOfDate:'2026-10-31',accounts:[{id:1,currency:'USD',scope:'cash',balanceCents:10000}],evidence:'synthetic baseline'},{expectedRevision:0,idempotencyKey:'start'});
  const script=`import {Database} from 'bun:sqlite';import {BudgetEngine} from ${JSON.stringify(import.meta.dir+'/service.ts')};const d=new Database(process.argv[1]);d.exec('PRAGMA busy_timeout=5000');try{new BudgetEngine(d,1).allocate({id:process.argv[2],date:'2026-11-01',kind:'assign',categoryId:1,amountCents:8000},{expectedRevision:1,idempotencyKey:process.argv[2]});console.log('ok')}catch(e){console.log(e.message)}finally{d.close()}`;
  const children=['one','two'].map(id=>Bun.spawn([process.execPath,'-e',script,path,id],{stdout:'pipe',stderr:'pipe'}));
  const results=await Promise.all(children.map(async c=>({code:await c.exited,out:(await new Response(c.stdout).text()).trim(),err:await new Response(c.stderr).text()})));
  expect(results.every(r=>r.code===0&&r.err==='')).toBe(true);expect(results.map(r=>r.out).sort()).toEqual(['ok','revision conflict']);expect(e.view('2026-11').ledger?.readyToAssignCents).toBe(2000);expect(e.view('2026-11').revision).toBe(2);d.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
