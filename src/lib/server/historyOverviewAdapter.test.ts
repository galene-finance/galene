import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {fixture,access,accounts,resolveEvidence,now} from '../../../qa/history-w18/fixture';
import {BudgetEngine} from './budgetEngine/service';
import {captureHistoryOverview,loadHistoryOverview,historyCaptureOffer} from './historyOverviewAdapter';
const form=(revision:number,key='capture')=>{const f=new FormData();f.set('history_offer','synthetic-debt-25');f.set('revision',String(revision));f.set('key',key);return f;};
function run(fn:(path:string)=>void){const dir=mkdtempSync(join(tmpdir(),'history-w18-'));try{fn(join(dir,'synthetic.sqlite'));}finally{rmSync(dir,{recursive:true,force:true});}}
test('source-bound capture survives file close/reopen, preserves gaps/estimates/negative balances and retry identity',()=>run(path=>{
 let db=fixture(path);let engine=new BudgetEngine(db,1);const revision=engine.view('2026-11').revision;
 const before=loadHistoryOverview(engine,access,accounts,'2026-11-21','2026-11-25');expect(before.map(p=>p.totalCents)).toEqual([-50000,null,-35000,-20000,null]);
 const offer=historyCaptureOffer(engine,access,'synthetic-debt-25',resolveEvidence,now);expect(offer.source).toBe('accepted_estimate');expect(offer.balanceCents).toBe(-130000);
 const result=captureHistoryOverview(engine,access,form(revision),resolveEvidence,now);expect(result.point.totalCents).toBe(-130000);
 db.close();db=fixture(path);engine=new BudgetEngine(db,1);
 expect(loadHistoryOverview(engine,access,accounts,'2026-11-25','2026-11-25')[0].totalCents).toBe(-5000);
 expect(captureHistoryOverview(engine,access,form(revision),resolveEvidence,now).receipt).toEqual(result.receipt);
 expect(engine.history(accounts,['2026-11-22'])[0].totalCents).toBeNull();
 expect(()=>captureHistoryOverview(engine,access,form(revision,'stale'),resolveEvidence,now)).toThrow('revision');db.close();
}));
test('capture blocks unauthorized/foreign/forged/future/unknown evidence without writes',()=>run(path=>{
 const db=fixture(path),engine=new BudgetEngine(db,1),revision=engine.view('2026-11').revision;
 expect(()=>loadHistoryOverview(engine,{...access,canRead:false},accounts,'2026-11-21','2026-11-25')).toThrow('denied');
 for(const a of [{...access,ownerId:2},{...access,canCapture:false}])expect(()=>captureHistoryOverview(engine,a,form(revision),resolveEvidence,now)).toThrow('denied');
 const forged=form(revision);forged.set('balanceCents','1');expect(()=>captureHistoryOverview(engine,access,forged,resolveEvidence,now)).toThrow('Unexpected');
 const duplicate=form(revision);duplicate.append('revision',String(revision));expect(()=>captureHistoryOverview(engine,access,duplicate,resolveEvidence,now)).toThrow('Unexpected');
 expect(()=>captureHistoryOverview(engine,access,form(revision),()=>null,now)).toThrow('unavailable');
 for(const patch of [{accountId:3},{asOf:'2026-11-26T12:00:00.000Z',recordedAt:'2026-11-26T12:00:00.000Z'},{source:'reconstructed' as const,coverageFrom:'2026-11-25',coverageTo:'2026-11-25'}]){
  const resolver=()=>{const r=resolveEvidence(1,'synthetic-debt-25')!;return {...r,snapshot:{...r.snapshot,...patch}};};
  expect(()=>captureHistoryOverview(engine,access,form(revision),resolver,now)).toThrow();
 }
 expect(engine.view('2026-11').revision).toBe(revision);expect(engine.history(accounts,['2026-11-25'])[0].totalCents).toBeNull();db.close();
}));
