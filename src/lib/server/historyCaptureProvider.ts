import type {Database} from 'bun:sqlite';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {BudgetEngine} from './budgetEngine/service';
import {captureHistoryOverview,type HistoryAccess,type HistoryEvidence,type HistoryEvidenceResolver} from './historyOverviewAdapter';
import type {BalanceSnapshot} from '../budget/types';
import type {HistoryCaptureOffer} from '../historyOverview';
import {timestamp} from '../budget/validation';
import {validateSnapshot} from '../budget/history';

export type HistoryCaptureSource='simplefin'|'plaid'|'mmi'|'ynab_apple';
/** Trusted owner-approved mapping. Never construct from a browser field or account name.
 * Native accounts do not persist currency or MMI/Apple source preference. No defaults. */
export type HistoryCapturePolicy={accountId:number;currency:string;source:HistoryCaptureSource;sourceAccountRef:string};
/** Receipt delivered by the approved MMI update / Apple-only YNAB path, not HTTP input.
 * Dates, source record identity and signed integer cents must come from that path.
 * No fetching, conversion, estimation, source guessing or credential access occurs here. */
export type HistoryExternalEvidence={ownerId:number;accountId:number;source:'mmi'|'ynab_apple';sourceAccountRef:string;recordId:string;currency:string;balanceCents:number;asOf:string;recordedAt:string;evidence:string;accepted?:boolean;method?:string};
type NativeRow={id:number;name:string;provider:string|null;external_id:string|null;provider_balance_cents:number|null;provider_balance_as_of:string|null};
export type HistoryCaptureGap={accountId:number;reason:string};
type Candidate={record:HistoryEvidence;native:boolean};
// Process-local signing material, never persisted or exposed. Restart/another process requires
// reloading offers; this is not a provider credential or a substitute for route authorization.
const signingKey=randomBytes(32);
const OFFER_TTL_MS=15*60*1000;
const knownSources=new Set(['simplefin','plaid','mmi','ynab_apple']);
function authorize(access:HistoryAccess){if(!Number.isSafeInteger(access.ownerId)||access.ownerId<1||access.canRead!==true||access.canCapture!==true)throw new Error('History capture access denied.');}
function nonblank(v:unknown):v is string{return typeof v==='string'&&v.trim().length>0;}
function sourceTime(value:unknown):string{
 if(typeof value!=='string')throw new Error('Source timestamp missing.');
 // This exact conversion is defined by the native schema's UTC DB datetime contract.
 const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)?value.replace(' ','T')+'.000Z':value;
 return timestamp(normalized);
}
function body(s:BalanceSnapshot){return {accountId:s.accountId,currency:s.currency,asOf:s.asOf,balanceCents:s.balanceCents,source:s.source,evidence:s.evidence};}
function sourceKey(ownerId:number,p:HistoryCapturePolicy,identity:string){return 'history-provider-v1:'+createHash('sha256').update(JSON.stringify([ownerId,p.accountId,p.source,p.sourceAccountRef,identity])).digest('hex');}
function signed(ownerId:number,c:Candidate,issued:number){return createHmac('sha256',signingKey).update(JSON.stringify([ownerId,issued,c.record.sourceKey,body(c.record.snapshot),c.native?null:c.record.snapshot.recordedAt])).digest('hex');}
function sameSignature(a:string,b:string){return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
function storedRecord(database:Database,ownerId:number,c:Candidate):HistoryEvidence|null{
 const row=database.query('SELECT payload FROM budget_engine_snapshots WHERE owner_id=? AND source_key=?').get(ownerId,c.record.sourceKey) as {payload:string}|null;
 if(!row)return null;
 const saved=JSON.parse(row.payload) as BalanceSnapshot;validateSnapshot(saved);
 if(JSON.stringify(body(saved))!==JSON.stringify(body(c.record.snapshot))||(!c.native&&saved.recordedAt!==c.record.snapshot.recordedAt))throw new Error('Saved evidence conflicts with this source identity.');
 return {...c.record,snapshot:saved};
}
function candidates(database:Database,access:HistoryAccess,policies:readonly HistoryCapturePolicy[],now:string,receipts:readonly HistoryExternalEvidence[]){
 authorize(access);timestamp(now);
 if(policies.length>1000||receipts.length>1000)throw new Error('History source scope too large.');
 const rows=database.query('SELECT id,name,provider,external_id,provider_balance_cents,provider_balance_as_of FROM accounts WHERE user_id=? ORDER BY id').all(access.ownerId) as NativeRow[];
 const mappings=new Map<number,HistoryCapturePolicy>();
 for(const p of policies){
  if(!Number.isSafeInteger(p.accountId)||!rows.some(r=>r.id===p.accountId))throw new Error('History source mapping is outside owner scope.');
  if(mappings.has(p.accountId))throw new Error('Duplicate history source mapping.');
  mappings.set(p.accountId,p);
 }
 const available:Candidate[]=[],gaps:HistoryCaptureGap[]=[];
 for(const row of rows){
  const p=mappings.get(row.id);
  if(!p){gaps.push({accountId:row.id,reason:'No approved source and currency mapping.'});continue;}
  try{
   if(!knownSources.has(p.source)||!/^[A-Z]{3}$/.test(p.currency)||!nonblank(p.sourceAccountRef))throw new Error('Approved source mapping is incomplete.');
   if(!nonblank(row.name))throw new Error('Account label is unavailable.');
   const next:Candidate[]=[];
   if(p.source==='simplefin'||p.source==='plaid'){
    if(row.provider!==p.source||row.external_id!==p.sourceAccountRef)throw new Error('Native provider identity does not match the approved source.');
    if(!Number.isSafeInteger(row.provider_balance_cents))throw new Error('Provider balance is missing or invalid.');
    const asOf=sourceTime(row.provider_balance_as_of);
    // Native storage conflates provider time and fetch time. Preserve exactly, state uncertainty.
    const snapshot:BalanceSnapshot={accountId:row.id,currency:p.currency,asOf,recordedAt:now,balanceCents:row.provider_balance_cents!,source:'actual',evidence:`${p.source==='simplefin'?'SimpleFIN':'Plaid'} stored provider balance. Timestamp is provider time or fetch time; the native record does not distinguish them. Currency comes from the approved account mapping. This is an observation, not an end-of-day balance or complete history.`};
    validateSnapshot(snapshot);
    next.push({native:true,record:{accountName:row.name,sourceKey:sourceKey(access.ownerId,p,asOf),snapshot}});
   }else{
    // Protected MMI/Apple policies never fall back to provider columns or opening balances.
    const matches=receipts.filter(r=>r.ownerId===access.ownerId&&r.accountId===row.id&&r.source===p.source&&r.sourceAccountRef===p.sourceAccountRef);
    if(!matches.length)throw new Error('No trusted evidence receipt for the approved source.');
    const seen=new Set<string>();
    for(const r of matches){
     if(!nonblank(r.recordId)||seen.has(r.recordId)||r.currency!==p.currency||!nonblank(r.evidence))throw new Error('Source receipt identity, currency or evidence is invalid.');
     seen.add(r.recordId);
     if(p.source==='mmi'&&(r.accepted!==true||!nonblank(r.method)))throw new Error('MMI evidence needs the accepted estimation method.');
     const snapshot:BalanceSnapshot={accountId:row.id,currency:r.currency,asOf:timestamp(r.asOf),recordedAt:timestamp(r.recordedAt),balanceCents:r.balanceCents,source:p.source==='mmi'?'accepted_estimate':'actual',evidence:p.source==='mmi'?`MMI accepted estimate. Method: ${r.method}. Evidence: ${r.evidence}`:`Apple-only YNAB ledger balance, not an independently verified bank balance. Evidence: ${r.evidence}`};
     validateSnapshot(snapshot);if(snapshot.recordedAt>now)throw new Error('Source evidence is dated in the future.');
     next.push({native:false,record:{accountName:row.name,sourceKey:sourceKey(access.ownerId,p,r.recordId),snapshot}});
    }
   }
   // Fail this account closed on a conflicting saved identity; do not partially offer a batch.
   for(const c of next)storedRecord(database,access.ownerId,c);
   available.push(...next);
  }catch(e){gaps.push({accountId:row.id,reason:e instanceof Error?e.message:'Source evidence unavailable.'});}
 }
 return {available,gaps};
}
/** Read-only offer discovery plus request-time resolver. All inputs except returned opaque
 * offer references are server-derived. No loader writes; no external network calls. */
export function trustedHistoryCaptureProvider(database:Database,access:HistoryAccess,policies:readonly HistoryCapturePolicy[],now:string,receipts:readonly HistoryExternalEvidence[]=[]){
 return database.transaction(()=>{
  const {available,gaps}=candidates(database,access,policies,now,receipts),issued=Date.parse(now);
  const offers:HistoryCaptureOffer[]=[];
  for(const c of available){
   if(storedRecord(database,access.ownerId,c))continue;
   const s=c.record.snapshot;
   offers.push({reference:`hc1.${issued}.${signed(access.ownerId,c,issued)}`,accountName:c.record.accountName,balanceCents:s.balanceCents,currency:s.currency,asOf:s.asOf,source:s.source as 'actual'|'accepted_estimate',evidence:s.evidence});
  }
  const resolve:HistoryEvidenceResolver=(ownerId,reference)=>{
   if(ownerId!==access.ownerId)return null;
   const match=/^hc1\.(\d{13})\.([a-f0-9]{64})$/.exec(reference);if(!match)return null;
   const prepared=Number(match[1]);if(prepared>issued||issued-prepared>OFFER_TTL_MS)return null;
   // Re-read source rows: even an object created before a source edit must reject stale offers.
   const fresh=candidates(database,access,policies,now,receipts);
   for(const c of fresh.available)if(sameSignature(signed(ownerId,c,prepared),match[2]))return storedRecord(database,ownerId,c)??c.record;
   return null;
  };
  return {offers,gaps,resolve,revision:(database.query('SELECT revision FROM budget_engine_state WHERE owner_id=?').get(access.ownerId) as {revision:number}|null)?.revision??0};
 })();
}
/** Atomic source revalidation + existing engine capture. Native session/demo/CSRF/write-toggle
 * guards still belong to W11's route and MUST run before this function. */
export function captureTrustedHistoryEvidence(database:Database,access:HistoryAccess,policies:readonly HistoryCapturePolicy[],form:FormData,now:string,receipts:readonly HistoryExternalEvidence[]=[]){
 authorize(access);
 return database.transaction(()=>{
  const provider=trustedHistoryCaptureProvider(database,access,policies,now,receipts);
  return captureHistoryOverview(new BudgetEngine(database,access.ownerId),access,form,provider.resolve,now);
 }).immediate();
}
