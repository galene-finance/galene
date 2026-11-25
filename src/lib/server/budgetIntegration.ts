import {error,fail} from '@sveltejs/kit';
import {db} from './db';import {BudgetEngine} from './budgetEngine/service';import {productOwner} from './productAccess';
import {getScheduled,expandScheduled} from './finance';
import {parseAmountToCents,todayISO} from '$lib/utils';import {civil,monthEnd} from '$lib/budget/validation';
import type {User} from '$lib/types';
export function budgetDate(url:URL){const date=url.searchParams.get('date')??(url.searchParams.get('month')?`${url.searchParams.get('month')}-01`:todayISO());try{civil(date);}catch{error(400,'Choose a valid date.');}return date;}
export function budgetFunding(userId:number,selectedDate:string){
 const month=selectedDate.slice(0,7),today=todayISO(),asOfDate=month===today.slice(0,7)?today:monthEnd(month);
 const obligations=getScheduled(userId).flatMap(s=>expandScheduled(s,`${month}-01`,monthEnd(month))).filter(o=>o.scheduled.amount_cents<0).map(o=>({id:`schedule:${o.scheduled.id}:${o.date}`,categoryId:o.scheduled.category_id,amountCents:-o.scheduled.amount_cents}));
 return {funding:new BudgetEngine(db(),userId).dashboard(month,obligations,asOfDate),fundingDate:asOfDate,commandKey:crypto.randomUUID()};
}
async function boundedForm(request:Request){
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing form');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new Error('Form too large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new Request(request.url,{method:'POST',headers:request.headers,body:bytes}).formData();
}
export async function budgetCommand(kind:'assign'|'refresh',{locals,request,url}:{locals:{user:User|null|undefined;viewer?:unknown;apiToken?:unknown};request:Request;url:URL}){
 const owner=productOwner(locals.user);if(locals.viewer||locals.apiToken)return fail(403,{error:'Use your owner session for this change.'});
 if(request.headers.get('origin')!==url.origin)return fail(403,{error:'This form must be submitted from this app.'});
 try{
  const selected=budgetDate(url),form=await boundedForm(request),rawRevision=String(form.get('revision')??''),key=String(form.get('key')??'');
  if(!/^\d+$/.test(rawRevision)||!Number.isSafeInteger(Number(rawRevision))||!key.trim()||key.length>100)throw new Error('Invalid command');
  const engine=new BudgetEngine(db(),owner),meta={expectedRevision:Number(rawRevision),idempotencyKey:key};
  if(kind==='refresh'){
   const selectedThrough=selected.slice(0,7)===todayISO().slice(0,7)?todayISO():monthEnd(selected.slice(0,7));
   const previousThrough=engine.view(selected.slice(0,7),selectedThrough).activityThrough;
   const through=previousThrough&&previousThrough>selectedThrough?previousThrough:selectedThrough;if(through>todayISO())throw new Error('Future activity');
   return {ok:true,...engine.refreshRegister(through,[],meta)};
  }
  const date=String(form.get('date')??'');civil(date);if(date>todayISO()||date.slice(0,7)!==selected.slice(0,7))throw new Error('Invalid effective date');
  const rawCategory=String(form.get('category_id')??''),amount=parseAmountToCents(String(form.get('amount')??''));
  if(!/^[1-9]\d*$/.test(rawCategory)||!Number.isSafeInteger(Number(rawCategory))||amount===null||amount===0||!Number.isSafeInteger(amount))throw new Error('Invalid assignment');
  return {ok:true,...engine.allocate({id:`ui:${key}`,kind:'assign',date,categoryId:Number(rawCategory),amountCents:amount},meta)};
 }catch(cause){
  const message=cause instanceof Error?cause.message:'';
  return fail(400,{error:message.includes('revision')?'The plan changed. Reload before trying again.':message.includes('stale')?'Posted activity changed. Refresh coverage before assigning.':'This change could not be applied. Check the date, category, coverage and available cash; no budget change was saved.'});
 }
}
