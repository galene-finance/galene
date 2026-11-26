import {createHash} from 'node:crypto';import type {Database} from 'bun:sqlite';
import {BudgetEngine,type Activation} from './budgetEngine/service';import {civil,timestamp} from '../budget/validation';import {projectLedger} from '../budget/ledger';
import type {BaselineEvidence,BaselineScope,BaselineSetupModel,BaselineSetupResult,BaselineReview} from '../baselineSetupTypes';
export type BaselineClock={now:string;timeZone:string};
/** Resolve already-approved immutable local evidence; do not perform network IO under the DB lock. */
export type BaselineCatalog=((ownerId:number,date:string)=>readonly BaselineEvidence[])|null;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicEvidence=(r:BaselineEvidence):BaselineEvidence=>({reference:r.reference,ownerId:r.ownerId,accountId:r.accountId,currency:r.currency,balanceCents:r.balanceCents,asOfDate:r.asOfDate,timeZone:r.timeZone,cutoff:r.cutoff,source:r.source,description:r.description,recordedAt:r.recordedAt});
export function baselineClosedDate(clock:BaselineClock){timestamp(clock.now);const parts=new Intl.DateTimeFormat('en-CA',{timeZone:clock.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(clock.now));const value=(type:string)=>parts.find(p=>p.type===type)!.value;const today=`${value('year')}-${value('month')}-${value('day')}`;return new Date(civil(today).getTime()-86400000).toISOString().slice(0,10);}
function state(database:Database,ownerId:number){return database.query('SELECT revision,baseline_json FROM budget_engine_state WHERE owner_id=?').get(ownerId) as {revision:number;baseline_json:string|null}|null;}
function roster(database:Database,ownerId:number){return database.query('SELECT id,name,type FROM accounts WHERE user_id=? ORDER BY id').all(ownerId) as {id:number;name:string;type:string}[];}
function approved(record:BaselineEvidence,ownerId:number,date:string,clock:BaselineClock){try{
 if(!record||record.ownerId!==ownerId||record.asOfDate!==date||record.timeZone!==clock.timeZone||record.cutoff!=='end_of_day'||!['actual','accepted_estimate'].includes(record.source))return false;
 if(!Number.isSafeInteger(record.balanceCents)||!Number.isSafeInteger(record.accountId)||record.accountId<=0||!record.reference?.trim()||record.reference.length>180||!record.description?.trim()||record.description.length>1000||!/^[A-Z]{3}$/.test(record.currency))return false;
 timestamp(record.recordedAt);return new Date(record.recordedAt).getTime()<=new Date(clock.now).getTime()&&baselineClosedDate({now:record.recordedAt,timeZone:clock.timeZone})>=date;
 }catch{return false;}}
export function baselineSetupModel(database:Database,ownerId:number,date:string,catalog:BaselineCatalog,clock:BaselineClock):BaselineSetupModel{
 civil(date);const lastClosedDate=baselineClosedDate(clock);
 return database.transaction(():BaselineSetupModel=>{
  new BudgetEngine(database,ownerId);const s=state(database,ownerId),accounts=roster(database,ownerId);const baseline=s?.baseline_json?JSON.parse(s.baseline_json) as Activation:null;
  let records:readonly BaselineEvidence[]=[],providerAvailable=catalog!==null;
  if(!baseline&&catalog&&date<=lastClosedDate){try{records=catalog(ownerId,date).filter(r=>approved(r,ownerId,date,clock)&&accounts.some(a=>a.id===r.accountId));}catch{providerAvailable=false;}}
  const unique=records.filter(r=>records.filter(x=>x.reference===r.reference).length===1).map(publicEvidence);
  return {phase:baseline?'active':'setup',revision:s?.revision??0,date,timeZone:clock.timeZone,lastClosedDate,rosterFingerprint:digest(accounts),providerAvailable,accounts:accounts.map(a=>{const offers=unique.filter(r=>r.accountId===a.id);return {...a,offers,issue:offers.length?null:'No approved closing-balance evidence for this date and timezone.'};}),active:baseline?{date:baseline.asOfDate,currency:baseline.currency,accounts:baseline.accounts.map(a=>({id:a.id,name:accounts.find(x=>x.id===a.id)?.name??'Saved account',scope:a.scope,balanceCents:a.balanceCents}))}:null};
 })();
}
type Context={database:Database;catalog:BaselineCatalog;prepareEvidence?:(ownerId:number,date:string)=>void;clock:BaselineClock;locals:{user?:{id:number;role?:string}|null;viewer?:unknown;apiToken?:unknown};request:Request;url:URL;demo?:boolean};
export async function baselineSetupAction(c:Context):Promise<BaselineSetupResult>{
 const reject=(status:number,error:string):BaselineSetupResult=>({feature:'baselineSetup',ok:false,status,error});
 if(!c.locals.user)return reject(401,'Sign in to your owner account.');
 if(c.locals.user.role==='viewer'||c.locals.viewer||c.locals.apiToken||c.demo||process.env.GALENE_DEMO==='1')return reject(403,'Only the owner app session can set up the baseline.');
 if(c.request.method!=='POST')return reject(405,'Use the setup form.');if(c.request.headers.get('origin')!==c.url.origin)return reject(403,'Submit from this app.');
 try{
  const reader=c.request.body?.getReader();if(!reader)throw Error('missing form');let length=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768){await reader.cancel();return reject(413,'Setup form is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const form=await new Request(c.url,{method:'POST',headers:c.request.headers,body:bytes}).formData();const one=(key:string)=>{if(form.getAll(key).length!==1||typeof form.get(key)!=='string')throw Error('invalid form');return String(form.get(key));};
  const date=one('date'),stage=one('stage'),revision=one('revision'),key=one('key');civil(date);
  if(date>baselineClosedDate(c.clock))return reject(422,'Choose a completed end-of-day date, not today or a future day.');
  if(!['review','activate'].includes(stage)||!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))||!key.trim()||key.length>100)throw Error('invalid form');
  if(stage==='review'&&c.prepareEvidence){try{c.prepareEvidence(c.locals.user!.id,date);}catch{throw Error('missing evidence');}}
  return c.database.transaction(()=>{
   const owner=c.locals.user!.id,model=baselineSetupModel(c.database,owner,date,c.catalog,c.clock);
   // An exact activation retry still goes to the engine's original receipt. A new activation cannot reset it.
   const rows=roster(c.database,owner);if(one('roster')!==model.rosterFingerprint)throw Error('roster conflict');
   if(stage==='review'&&model.phase==='active')throw Error('already active');
   if(stage==='review'&&model.revision!==Number(revision))throw Error('revision conflict');
   // Evidence must remain resolvable for an exact retry as well as first activation.
   const offers=model.phase==='active'?baselineSetupModelForRetry(c,owner,date):model;
   if(!offers.providerAvailable||!rows.length)throw Error('missing evidence');
   const allowed=new Set(['stage','date','revision','roster','key',...(stage==='activate'?['review','confirm']:[]),...rows.flatMap(a=>[`scope_${a.id}`,`source_${a.id}`])]);
   for(const name of form.keys())if(!allowed.has(name)||form.getAll(name).length!==1)throw Error('invalid form');
   const choices=rows.map(a=>{const scope=one(`scope_${a.id}`) as BaselineScope;if(!['cash','credit','tracking'].includes(scope))throw Error('invalid scope');const ref=one(`source_${a.id}`),evidence=offers.accounts.find(x=>x.id===a.id)?.offers.find(x=>x.reference===ref);if(!evidence)throw Error('missing evidence');return {id:a.id,name:a.name,scope,evidence};});
   const currency=choices[0].evidence.currency;if(choices.some(r=>r.evidence.currency!==currency))throw Error('mixed currency');
   const activation:Activation={currency,asOfDate:date,accounts:choices.map(r=>({id:r.id,scope:r.scope,currency,balanceCents:r.evidence.balanceCents})),evidence:JSON.stringify({kind:'approved-end-of-day',timeZone:c.clock.timeZone,records:choices.map(r=>r.evidence)})};
   const projection=projectLedger(activation.accounts,[],[],date);const fingerprint=digest({activation,roster:model.rosterFingerprint,revision:Number(revision),key});
   const review:BaselineReview={date,timeZone:c.clock.timeZone,currency,revision:Number(revision),rosterFingerprint:model.rosterFingerprint,key,fingerprint,readyToAssignCents:projection.readyToAssignCents,cashCents:projection.cashCents,rows:choices};
   if(stage==='review')return {feature:'baselineSetup',ok:true,phase:'review',review} as const;
   if(one('confirm')!=='end-of-day'||one('review')!==fingerprint)throw Error('review conflict');
   const receipt=new BudgetEngine(c.database,owner).activate(activation,{expectedRevision:Number(revision),idempotencyKey:`baseline-setup:${key}`});
   return {feature:'baselineSetup',ok:true,phase:'active',revision:receipt.revision,notice:'Opening baseline saved once. Existing account balances, transactions and targets were not rewritten. Refresh posted activity after this cutoff before assigning money.'} as const;
  }).immediate();
 }catch(e){const message=e instanceof Error?e.message:'';
  if(message.includes('already active'))return reject(409,'A baseline already exists. Setup cannot replace or reset it.');
  if(message.includes('conflict'))return reject(409,'The reviewed setup changed or was already used. Reload and review again; no new baseline was saved.');
  if(message.includes('missing evidence'))return reject(422,'Every account needs approved end-of-day evidence. Current balances and browser-entered amounts cannot substitute for it.');
  if(message.includes('mixed currency'))return reject(422,'All baseline accounts must use one currency. No conversion is inferred.');
  return reject(400,'Check the setup date, account choices and confirmation. No baseline change was saved.');
 }
}
function baselineSetupModelForRetry(c:Context,owner:number,date:string){
 const accounts=roster(c.database,owner);let records:readonly BaselineEvidence[]=[];if(c.catalog)records=c.catalog(owner,date).filter(r=>approved(r,owner,date,c.clock)&&accounts.some(a=>a.id===r.accountId));
 return {providerAvailable:c.catalog!==null,accounts:accounts.map(a=>({...a,offers:records.filter(r=>r.accountId===a.id&&records.filter(x=>x.reference===r.reference).length===1).map(publicEvidence)}))};
}
