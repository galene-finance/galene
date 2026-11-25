import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';import {migrate} from './db';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {BudgetEngine} from './budgetEngine/service';
import type {HistoryCapturePolicy,HistoryExternalEvidence} from './historyCaptureProvider';
import {trustedHistoryCaptureProvider,captureTrustedHistoryEvidence} from './historyCaptureProvider';
const now='2026-11-25T16:00:00.000Z',access={ownerId:1,canRead:true,canCapture:true};
const policies=[{accountId:1,currency:'USD',source:'simplefin' as const,sourceAccountRef:'synthetic-bank'}];
function fixture(path=':memory:'){const db=new Database(path);migrate(db);if(db.query('SELECT id FROM users WHERE id=1').get())return db;db.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','p@example.test','x'),(2,'Other','o@example.test','x'); INSERT INTO accounts(id,user_id,name,type,provider,external_id,provider_balance_cents,provider_balance_as_of) VALUES(1,1,'Synthetic bank','bank','simplefin','synthetic-bank',12345,'2026-11-24 14:15:16'),(2,1,'Synthetic MMI','credit','simplefin','unapproved-feed',-90000,'2026-11-25 12:00:00'),(3,2,'Other','bank','simplefin','other',20000,'2026-11-25 12:00:00');");return db;}
test('native metadata becomes an exact-timestamp source-bound offer, never historical day-end',()=>{
 const db=fixture();try{const provider=trustedHistoryCaptureProvider(db,access,policies,now);
 expect(provider.offers).toHaveLength(1);expect(provider.offers[0]).toMatchObject({asOf:'2026-11-24T14:15:16.000Z',balanceCents:12345,currency:'USD',source:'actual'});
 expect(provider.offers[0].evidence).toContain('provider time or fetch time');
 const f=new FormData();f.set('history_offer',provider.offers[0].reference);f.set('revision','0');f.set('key','synthetic-capture');
 const result=captureTrustedHistoryEvidence(db,access,policies,f,'2026-11-25T16:00:05.000Z');expect(result.point.totalCents).toBe(12345);
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual({n:1});
 }finally{db.close();}
});

const form=(reference:string,revision=0,key='capture')=>{const f=new FormData();f.set('history_offer',reference);f.set('revision',String(revision));f.set('key',key);return f;};
const protectedPolicy:HistoryCapturePolicy={accountId:2,currency:'USD',source:'mmi',sourceAccountRef:'approved-debt'};
const mmi:HistoryExternalEvidence={ownerId:1,accountId:2,source:'mmi',sourceAccountRef:'approved-debt',recordId:'statement-estimate-v1',currency:'USD',balanceCents:-40000,asOf:'2026-11-24T15:00:00.000Z',recordedAt:'2026-11-25T14:00:00.000Z',evidence:'Synthetic statement and allocated payment receipt',method:'Accepted statement principal less allocated payment',accepted:true};
test('loader is read-only, unknown accounts and missing currencies remain gaps',()=>{
 const db=fixture();try{
 const before=db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get();
 const p=trustedHistoryCaptureProvider(db,access,[],now);expect(p.offers).toEqual([]);expect(p.gaps).toHaveLength(2);
 expect(trustedHistoryCaptureProvider(db,access,[{...policies[0],currency:''}],now).offers).toEqual([]);
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_state').get()).toEqual({n:0});expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual(before);
 }finally{db.close();}
});
test('MMI estimate retains source/method and never falls back to connected bank metadata',()=>{
 const db=fixture();try{
 expect(trustedHistoryCaptureProvider(db,access,[protectedPolicy],now).offers).toEqual([]);
 const p=trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[mmi]);expect(p.offers).toHaveLength(1);expect(p.offers[0]).toMatchObject({balanceCents:-40000,source:'accepted_estimate',asOf:mmi.asOf});expect(p.offers[0].evidence).toContain(mmi.method!);
 captureTrustedHistoryEvidence(db,access,[protectedPolicy],form(p.offers[0].reference),now,[mmi]);
 const s=new BudgetEngine(db,1).history([{id:2,included:true}],['2026-11-24'])[0].sources[0];expect(s.source).toBe('accepted_estimate');expect(s.recordedAt).toBe(mmi.recordedAt);expect(s.balanceCents).not.toBe(-90000);
 }finally{db.close();}
});
test('Apple-only YNAB receipt requires exact source mapping and keeps ledger provenance',()=>{
 const db=fixture();try{
 const policy:HistoryCapturePolicy={...protectedPolicy,source:'ynab_apple',sourceAccountRef:'approved-apple'};
 const receipt:HistoryExternalEvidence={...mmi,source:'ynab_apple',sourceAccountRef:'approved-apple',recordId:'apple-observation',balanceCents:-50000,evidence:'Synthetic authorized Apple YNAB balance read'};
 const p=trustedHistoryCaptureProvider(db,access,[policy],now,[receipt]);expect(p.offers[0].source).toBe('actual');expect(p.offers[0].evidence).toContain('not an independently verified bank balance');
 expect(trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[receipt]).offers).toEqual([]);
 expect(trustedHistoryCaptureProvider(db,access,[policy],now,[{...receipt,sourceAccountRef:'another-ynab-account'}]).offers).toEqual([]);
 captureTrustedHistoryEvidence(db,access,[policy],form(p.offers[0].reference),now,[receipt]);expect(new BudgetEngine(db,1).history([{id:2,included:true}],['2026-11-24'])[0].totalCents).toBe(-50000);
 }finally{db.close();}
});
test('file close/reopen and later retry preserve original receipt and do not backfill gaps',()=>{
 const dir=mkdtempSync(join(tmpdir(),'history-provider-'));let db=fixture(join(dir,'synthetic.sqlite'));
 try{
 const p=trustedHistoryCaptureProvider(db,access,policies,now),f=form(p.offers[0].reference);const result=captureTrustedHistoryEvidence(db,access,policies,f,'2026-11-25T16:00:05.000Z');
 db.close();db=fixture(join(dir,'synthetic.sqlite'));
 expect(captureTrustedHistoryEvidence(db,access,policies,f,'2026-11-25T16:01:00.000Z').receipt).toEqual(result.receipt);
 expect(trustedHistoryCaptureProvider(db,access,policies,'2026-11-25T16:01:00.000Z').offers).toEqual([]);
 const points=new BudgetEngine(db,1).history([{id:1,included:true}],['2026-11-23','2026-11-24','2026-11-25']);expect(points.map(p=>p.totalCents)).toEqual([null,12345,null]);expect(points[1].sources[0].recordedAt).toBe('2026-11-25T16:00:05.000Z');
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual({n:1});
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('owner scope, readonly and forged form fields are rejected before writes',()=>{
 const db=fixture();try{
 for(const a of [{...access,canRead:false},{...access,canCapture:false}])expect(()=>trustedHistoryCaptureProvider(db,a,policies,now)).toThrow('denied');
 expect(()=>trustedHistoryCaptureProvider(db,access,[{...policies[0],accountId:3}],now)).toThrow('owner');
 expect(()=>trustedHistoryCaptureProvider(db,access,[policies[0],policies[0]],now)).toThrow('Duplicate');
 const p=trustedHistoryCaptureProvider(db,access,policies,now);expect(p.resolve(2,p.offers[0].reference)).toBeNull();
 const f=form(p.offers[0].reference);f.set('balanceCents','9999');expect(()=>captureTrustedHistoryEvidence(db,access,policies,f,now)).toThrow('Unexpected');
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual({n:0});
 }finally{db.close();}
});
test('signed offers reject forged timestamp, tampering, expiration and source drift',()=>{
 const db=fixture();try{
 const p=trustedHistoryCaptureProvider(db,access,policies,now),reference=p.offers[0].reference;
 expect(p.resolve(1,reference.replace(/.$/,reference.endsWith('0')?'1':'0'))).toBeNull();
 expect(p.resolve(1,reference.replace(reference.split('.')[1],String(Number(reference.split('.')[1])-1000)))).toBeNull();
 expect(trustedHistoryCaptureProvider(db,access,policies,'2026-11-25T16:16:00.000Z').resolve(1,reference)).toBeNull();
 db.exec('UPDATE accounts SET provider_balance_cents=99999 WHERE id=1');expect(p.resolve(1,reference)).toBeNull();expect(()=>captureTrustedHistoryEvidence(db,access,policies,form(reference),now)).toThrow('unavailable');
 }finally{db.close();}
});
test('invalid native timestamps and missing/unsafe amounts never become offers; zero is valid',()=>{
 const db=fixture();try{
 for(const value of [null,'2026-02-30 12:00:00','2026-11-26 12:00:00','2026-11-24','2026-11-24T12:00:00']){
 db.query('UPDATE accounts SET provider_balance_as_of=? WHERE id=1').run(value);expect(trustedHistoryCaptureProvider(db,access,policies,now).offers).toEqual([]);
 }
 db.exec("UPDATE accounts SET provider_balance_as_of='2026-11-24 12:00:00' WHERE id=1");
 for(const value of [null,1.5,Number.MAX_SAFE_INTEGER+1]){db.query('UPDATE accounts SET provider_balance_cents=? WHERE id=1').run(value);expect(trustedHistoryCaptureProvider(db,access,policies,now).offers).toEqual([]);}
 db.exec('UPDATE accounts SET provider_balance_cents=0 WHERE id=1');expect(trustedHistoryCaptureProvider(db,access,policies,now).offers[0].balanceCents).toBe(0);
 }finally{db.close();}
});
test('unaccepted, future, duplicate, foreign, wrong-currency or incomplete receipts remain gaps',()=>{
 const db=fixture();try{
 for(const r of [{...mmi,accepted:false},{...mmi,method:''},{...mmi,currency:'EUR'},{...mmi,asOf:'2026-11-24'},{...mmi,recordedAt:'2026-11-26T16:00:00.000Z'},{...mmi,ownerId:2},{...mmi,recordId:''}])expect(trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[r]).offers).toEqual([]);
 expect(trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[mmi,mmi]).offers).toEqual([]);
 }finally{db.close();}
});
test('saved source identity conflicts never rewrite history or disguise estimates',()=>{
 const db=fixture();try{
 const p=trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[mmi]);captureTrustedHistoryEvidence(db,access,[protectedPolicy],form(p.offers[0].reference),now,[mmi]);
 const changed=trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[{...mmi,balanceCents:-1}]);expect(changed.offers).toEqual([]);expect(changed.gaps.some(g=>g.reason.includes('conflicts'))).toBe(true);
 expect(new BudgetEngine(db,1).history([{id:2,included:true}],['2026-11-24'])[0].totalCents).toBe(-40000);
 }finally{db.close();}
});
test('conflicting same-time receipts roll back snapshot, revision and command receipt together',()=>{
 const db=fixture();try{
 const p=trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[mmi]);captureTrustedHistoryEvidence(db,access,[protectedPolicy],form(p.offers[0].reference),now,[mmi]);
 const changed={...mmi,recordId:'different-receipt',balanceCents:-1};const next=trustedHistoryCaptureProvider(db,access,[protectedPolicy],now,[changed]);
 expect(()=>captureTrustedHistoryEvidence(db,access,[protectedPolicy],form(next.offers[0].reference,next.revision,'conflict'),now,[changed])).toThrow('conflicting snapshots');
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual({n:1});expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_receipts').get()).toEqual({n:1});expect(new BudgetEngine(db,1).view('2026-11').revision).toBe(1);
 }finally{db.close();}
});
test('stale revision rejects atomic capture and leaves source native data untouched',()=>{
 const db=fixture();try{
 const p=trustedHistoryCaptureProvider(db,access,policies,now);expect(()=>captureTrustedHistoryEvidence(db,access,policies,form(p.offers[0].reference,9),now)).toThrow('revision');
 expect(db.query('SELECT COUNT(*) AS n FROM budget_engine_snapshots').get()).toEqual({n:0});expect(db.query('SELECT provider_balance_cents FROM accounts WHERE id=1').get()).toEqual({provider_balance_cents:12345});
 }finally{db.close();}
});
