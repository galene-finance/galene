import {error,fail} from '@sveltejs/kit';
import {db} from './db';import {BudgetEngine} from './budgetEngine/service';import {productOwner} from './productAccess';
import {getScheduled,expandScheduled,getCategories} from './finance';
import type {Target} from '$lib/budget/types';
import {readRegister,type TransferPair} from './budgetEngine/register';
import {parseAmountToCents,todayISO} from '$lib/utils';import {civil,monthEnd} from '$lib/budget/validation';
import type {User} from '$lib/types';
export function budgetDate(url:URL){const date=url.searchParams.get('date')??(url.searchParams.get('month')?`${url.searchParams.get('month')}-01`:todayISO());try{civil(date);}catch{error(400,'Choose a valid date.');}return date;}
export function budgetFunding(userId:number,selectedDate:string){
 const month=selectedDate.slice(0,7),today=todayISO(),asOfDate=month===today.slice(0,7)?today:monthEnd(month);
 const obligations=getScheduled(userId).flatMap(s=>expandScheduled(s,`${month}-01`,monthEnd(month))).filter(o=>o.scheduled.amount_cents<0).map(o=>({id:`schedule:${o.scheduled.id}:${o.date}`,categoryId:o.scheduled.category_id,amountCents:-o.scheduled.amount_cents}));
 return db().transaction(()=>{const engine=new BudgetEngine(db(),userId);return {funding:engine.dashboard(month,obligations,asOfDate),targetSpecs:engine.targets(month),fundingDate:asOfDate,commandKey:crypto.randomUUID()};}).deferred();
}
/** Read only explicit persisted matches; never infer new pairings or drop invalid ones. */
export function transferPairCatalog(ownerId:number,through:string):{status:'none'|'verified'|'needs_review';pairs:TransferPair[]}{
 const row=db().query('SELECT register_json FROM budget_engine_state WHERE owner_id=?').get(ownerId) as {register_json:string|null}|null;
 if(!row?.register_json)return {status:'none',pairs:[]};
 try{
  const saved=JSON.parse(row.register_json);
  if(!saved||!Array.isArray(saved.pairs))return {status:'needs_review',pairs:[]};
  const pairs=saved.pairs as TransferPair[];
  if(pairs.some(p=>!p||![p.outflowId,p.inflowId,...(p.categoryId===undefined?[]:[p.categoryId])].every(id=>Number.isSafeInteger(id)&&id>0)))return {status:'needs_review',pairs:[]};
  if(!pairs.length)return {status:'none',pairs};
  const categories=getCategories(ownerId);
  const invalidCategory=pairs.some(p=>p.categoryId!==undefined&&!categories.some(c=>c.id===p.categoryId));
  const current=readRegister(db(),ownerId,saved.from,through,pairs);
  const accounts=new Set((db().query('SELECT id FROM accounts WHERE user_id=?').all(ownerId) as {id:number}[]).map(a=>a.id));
  const foreignAccount=current.events.some(e=>e.kind==='transfer'&&(!accounts.has(e.fromAccountId)||!accounts.has(e.toAccountId)));
  return {status:invalidCategory||foreignAccount||current.issues.some(i=>i.reason==='invalid_transfer_pair')?'needs_review':'verified',pairs};
 }catch{return {status:'needs_review',pairs:[]};}
}
export function transferReviewModel(ownerId:number,through:string){
 const state=db().query('SELECT baseline_json FROM budget_engine_state WHERE owner_id=?').get(ownerId) as {baseline_json:string|null}|null;
 if(!state?.baseline_json)return null;
 const baseline=JSON.parse(state.baseline_json),from=new Date(civil(baseline.asOfDate).getTime()+86400000).toISOString().slice(0,10);
 const rows=db().query(`SELECT t.id,t.date,t.amount_cents AS amountCents,t.account_id AS accountId,a.name AS accountName,COALESCE(t.merchant,'Transfer') AS name FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id WHERE t.user_id=? AND t.pending=0 AND c.is_transfer=1 AND t.amount_cents!=0 AND t.date>=? AND t.date<=? ORDER BY t.date,t.id LIMIT 201`).all(ownerId,from,through) as {id:number;date:string;amountCents:number;accountId:number;accountName:string;name:string}[];
 const catalog=transferPairCatalog(ownerId,through);
 return {from,through,currency:baseline.currency as string,truncated:rows.length>200,outflows:rows.filter(r=>r.amountCents<0),inflows:rows.filter(r=>r.amountCents>0),pairs:catalog.pairs,status:catalog.status,categories:getCategories(ownerId).filter(c=>c.type==='expense')};
}
async function boundedForm(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing form');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('Form too large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new Request(request.url,{method:'POST',headers:request.headers,body:bytes}).formData();
}
export async function budgetCommand(kind:'assign'|'refresh'|'target'|'target-archive'|'pairs',{locals,request,url}:{locals:{user:User|null|undefined;viewer?:unknown;apiToken?:unknown};request:Request;url:URL}){
 const owner=productOwner(locals.user);if(locals.viewer||locals.apiToken)return fail(403,{error:'Use your owner session for this change.'});
 if(request.headers.get('origin')!==url.origin)return fail(403,{error:'This form must be submitted from this app.'});
 try{
  const selected=budgetDate(url),form=await boundedForm(request),rawRevision=String(form.get('revision')??''),key=String(form.get('key')??'');
  if(!/^\d+$/.test(rawRevision)||!Number.isSafeInteger(Number(rawRevision))||!key.trim()||key.length>100)throw new Error('Invalid command');
  const engine=new BudgetEngine(db(),owner),meta={expectedRevision:Number(rawRevision),idempotencyKey:key};
  if(kind==='target'||kind==='target-archive'){
   const id=String(form.get('target_id')??''),effectiveMonth=String(form.get('effective_month')??'');civil(`${effectiveMonth}-01`);
   if(!/^\d{4}-\d{2}$/.test(effectiveMonth)||!id.trim()||id.length>180)throw new Error('Invalid target version');
   if(kind==='target-archive')return {ok:true,targetEffectiveMonth:effectiveMonth,targetOperation:"removed",...engine.archiveTarget(id,effectiveMonth,meta)};
   const category=String(form.get('category_id')??''),amount=parseAmountToCents(String(form.get('amount')??''));
   if(!/^[1-9]\d*$/.test(category)||!Number.isSafeInteger(Number(category))||amount===null||amount<0||!Number.isSafeInteger(amount)||!getCategories(owner).some(c=>c.id===Number(category)&&c.type!=='income'))throw new Error('Invalid target category/amount');
   const cadence=String(form.get('cadence')??''),behavior=String(form.get('behavior')??'');
   if(!['monthly','weekly','annual','irregular'].includes(cadence)||!['refill','set_aside','balance'].includes(behavior))throw new Error('Invalid target policy');
   const target:Target={id,categoryId:Number(category),amountCents:amount,cadence:cadence as Target['cadence'],behavior:behavior as Target['behavior'],startDate:String(form.get('start_date')??'')};
   const due=String(form.get('due_date')??'');if(due)target.dueDate=due;
   if(cadence==='weekly'){const weekday=String(form.get('weekday')??'');if(!/^[0-6]$/.test(weekday))throw new Error('Invalid weekday');target.weekday=Number(weekday);}
   const repeat=String(form.get('repeat_months')??'');if(cadence==='irregular'&&repeat){if(!/^[1-9]\d{0,3}$/.test(repeat))throw new Error('Invalid repeat');target.repeatMonths=Number(repeat);}
   return {ok:true,targetEffectiveMonth:effectiveMonth,targetOperation:"saved",...engine.saveTarget(target,effectiveMonth,meta)};
  }
  if(kind==='refresh'||kind==='pairs'){
   const selectedThrough=selected.slice(0,7)===todayISO().slice(0,7)?todayISO():monthEnd(selected.slice(0,7));
   const previousThrough=engine.view(selected.slice(0,7),selectedThrough).activityThrough;
   const through=previousThrough&&previousThrough>selectedThrough?previousThrough:selectedThrough;if(through>todayISO())throw new Error('Future activity');
   return db().transaction(()=>{
    if(kind==='pairs'){
     const model=transferReviewModel(owner,through);if(!model||model.truncated||form.get('confirm')!=='yes')throw new Error('transfer review incomplete');
     const allowed=new Set(['revision','key','confirm',...model.outflows.flatMap(r=>[`match_${r.id}`,`category_${r.id}`])]);
     for(const field of form.keys())if(!allowed.has(field)||form.getAll(field).length!==1)throw new Error('invalid transfer form');
     const pairs:TransferPair[]=[];
     for(const row of model.outflows){
      const field=`match_${row.id}`;if(form.getAll(field).length!==1)throw new Error('incomplete transfer form');const value=form.get(field);
      if(value==='')continue;if(typeof value!=='string'||! /^[1-9]\d*$/.test(value)||!model.inflows.some(r=>r.id===Number(value)))throw new Error('invalid transfer selection');
      const category=String(form.get(`category_${row.id}`)??'');if(category&&(!/^[1-9]\d*$/.test(category)||!model.categories.some(c=>c.id===Number(category))))throw new Error('invalid transfer category');
      pairs.push({outflowId:row.id,inflowId:Number(value),...(category?{categoryId:Number(category)}:{})});
     }
     return {ok:true,transferReviewed:true,...engine.refreshRegister(through,pairs,meta)};
    }
    const catalog=transferPairCatalog(owner,through);if(catalog.status==='needs_review')throw new Error('saved transfer review');
    return {ok:true,...engine.refreshRegister(through,catalog.pairs,meta)};
   }).immediate();
  }
  const date=String(form.get('date')??'');civil(date);if(date>todayISO()||date.slice(0,7)!==selected.slice(0,7))throw new Error('Invalid effective date');
  const rawCategory=String(form.get('category_id')??''),amount=parseAmountToCents(String(form.get('amount')??''));
  if(!/^[1-9]\d*$/.test(rawCategory)||!Number.isSafeInteger(Number(rawCategory))||amount===null||amount===0||!Number.isSafeInteger(amount))throw new Error('Invalid assignment');
  return {ok:true,...engine.allocate({id:`ui:${key}`,kind:'assign',date,categoryId:Number(rawCategory),amountCents:amount},meta)};
 }catch(cause){
  const message=cause instanceof Error?cause.message:'';
  return fail(400,{error:message==='saved transfer review'?'Saved transfer matches need review before activity can be refreshed. No saved matches were removed.':message.includes('revision')?'The plan changed. Reload before trying again.':message.includes('stale')?'Posted activity changed. Refresh coverage before assigning.':kind==='pairs'?'Transfer matches were not saved. Resolve every transfer, check equal opposite amounts on the same posted date and different accounts, and reload if the plan changed.':kind==='target'||kind==='target-archive'?'Target change was not saved. Check its category, amount, dates and cadence, or reload if the plan changed.':'This change could not be applied. Check the date, category, coverage and available cash; no budget change was saved.'});
 }
}
