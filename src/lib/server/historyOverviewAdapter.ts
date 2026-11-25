import {BudgetEngine} from './budgetEngine/service';
import type {BalanceSnapshot,HistoryAccount} from '../budget/types';
import {historyDates,type HistoryCaptureOffer} from '../historyOverview';
import {validateSnapshot} from '../budget/history';
import {timestamp} from '../budget/validation';
/** Route supplies these from authenticated server context, never from form/query fields.
 * Native session/demo/write-toggle/CSRF/size policies remain the route's responsibility. */
export type HistoryAccess={ownerId:number;canRead:boolean;canCapture:boolean};
export type HistoryEvidence={sourceKey:string;snapshot:BalanceSnapshot;accountName:string};
export type HistoryEvidenceResolver=(ownerId:number,reference:string)=>HistoryEvidence|null;
function authorize(engine:BudgetEngine,access:HistoryAccess,write=false){
 if(access.ownerId!==engine.ownerId||access.canRead!==true||(write&&access.canCapture!==true))throw new Error('History access denied.');
}
export function loadHistoryOverview(engine:BudgetEngine,access:HistoryAccess,accounts:HistoryAccount[],from:string,to:string){
 authorize(engine,access);return engine.history(accounts,historyDates(from,to));
}
function trustedEvidence(engine:BudgetEngine,access:HistoryAccess,reference:string,resolve:HistoryEvidenceResolver,now:string){
 authorize(engine,access,true);timestamp(now);
 if(!reference||reference.length>200)throw new Error('Select an available source record.');
 const record=resolve(access.ownerId,reference);if(!record)throw new Error('Source evidence is unavailable. Reload before capturing.');
 validateSnapshot(record.snapshot);
 if(!record.sourceKey.trim()||!record.accountName.trim()||record.snapshot.source==='reconstructed'||record.snapshot.asOf>now||record.snapshot.recordedAt>now)throw new Error('Source evidence cannot be captured.');
 // Owner-check before displaying or writing source-specific amounts.
 engine.history([{id:record.snapshot.accountId,included:true}],[record.snapshot.asOf.slice(0,10)]);
 return record;
}
export function historyCaptureOffer(engine:BudgetEngine,access:HistoryAccess,reference:string,resolve:HistoryEvidenceResolver,now:string):HistoryCaptureOffer{
 const {snapshot:s,accountName}=trustedEvidence(engine,access,reference,resolve,now);
 return {reference,accountName,balanceCents:s.balanceCents,currency:s.currency,asOf:s.asOf,source:s.source as 'actual'|'accepted_estimate',evidence:s.evidence};
}
/** Accept only a server-resolved evidence reference, revision and retry key.
 * Never accept browser-supplied balances, timestamps, source labels or owner IDs. */
export function captureHistoryOverview(engine:BudgetEngine,access:HistoryAccess,form:FormData,resolve:HistoryEvidenceResolver,now:string){
 authorize(engine,access,true);
 const allowed=new Set(['history_offer','revision','key']);
 for(const key of form.keys())if(!allowed.has(key)||form.getAll(key).length!==1)throw new Error('Unexpected capture fields.');
 const reference=form.get('history_offer'),revision=form.get('revision'),key=form.get('key');
 if(typeof reference!=='string'||typeof revision!=='string'||!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))||typeof key!=='string')throw new Error('Invalid capture request.');
 const record=trustedEvidence(engine,access,reference,resolve,now);
 const receipt=engine.recordSnapshot(record.sourceKey,record.snapshot,{expectedRevision:Number(revision),idempotencyKey:key});
 const point=engine.history([{id:record.snapshot.accountId,included:true}],[record.snapshot.asOf.slice(0,10)])[0];
 // recordSnapshot itself persists immutable source evidence; read back the applicable day.
 return {receipt,point};
}
