import {error,fail} from '@sveltejs/kit';
import {trustedHistoryCaptureProvider,captureTrustedHistoryEvidence} from '$lib/server/historyCaptureProvider';
import {boundedForm} from '$lib/server/budgetIntegration';
import {productActivity,productHistory} from '$lib/server/product';
import {productOwner} from '$lib/server/productAccess';
import {db} from '$lib/server/db';
import {BudgetEngine} from '$lib/server/budgetEngine/service';
import {loadHistoryOverview} from '$lib/server/historyOverviewAdapter';
import type {HistoryPoint} from '$lib/budget/types';
export function load({locals,url}) {
 const userId=productOwner(locals.user);
 const view=url.searchParams.get('view')==='net-worth'?'net-worth':url.searchParams.get('view')==='trends'?'trends':'summary';
 if(view==='net-worth'&&(locals.viewer||locals.apiToken))error(403,'History is available in the owner app session.');
 const data=productActivity(userId,url);
 let netWorth:null|{points:HistoryPoint[];accounts:{id:number;name:string}[];from:string;to:string;maxDate:string;error:string|null;canCapture:false;revision:number}=null;
 if(view==='net-worth'){
  const maxDate=new Date().toISOString().slice(0,10),from=data.period.from,to=url.searchParams.has('date_to')?data.period.dateTo:data.period.dateTo>maxDate?maxDate:data.period.dateTo;
  const accounts=data.accounts.filter(a=>data.accountId===null||a.id===data.accountId).map(a=>({id:a.id,name:a.name}));
  let points:HistoryPoint[]=[],historyError:string|null=null;
  try{if(to>maxDate)throw new Error('future range');points=loadHistoryOverview(new BudgetEngine(db(),userId),{ownerId:userId,canRead:true,canCapture:false},accounts.map(a=>({id:a.id,included:true})),from,to);}catch{historyError='History cannot be shown for this range or currency scope. Choose at most 366 days ending no later than today, and accounts with one currency.';}
  const state=db().query('SELECT revision FROM budget_engine_state WHERE owner_id=?').get(userId) as {revision:number}|null;
  netWorth={points,accounts,from,to,maxDate,error:historyError,canCapture:false,revision:state?.revision??0};
 }
 let capture:null|{offers:import('$lib/historyOverview').HistoryCaptureOffer[];revision:number;commandKey:string;canCapture:boolean;gaps:{accountName:string;reason:string}[]}=null;
 if(view==='net-worth'&&!locals.viewer&&!locals.apiToken&&process.env.GALENE_DEMO!=='1'){
  const context=locals.financeEvidence?.ownerId===userId?locals.financeEvidence:null;
  const policies=(context?.historyPolicies??[]).filter(p=>data.accountId===null||p.accountId===data.accountId);
  const provider=trustedHistoryCaptureProvider(db(),{ownerId:userId,canRead:true,canCapture:true},policies,new Date().toISOString(),context?.historyReceipts??[]);
  capture={offers:provider.offers,revision:provider.revision,commandKey:crypto.randomUUID(),canCapture:context!==null,gaps:provider.gaps.filter(g=>data.accountId===null||g.accountId===data.accountId).map(g=>({accountName:data.accounts.find(a=>a.id===g.accountId)?.name??'Account',reason:g.reason}))};
 }
 return {...data,history:view==='net-worth'?[]:productHistory(userId,data),view,netWorth,capture};
}
export const actions={captureHistory:async({locals,request,url})=>{
 const ownerId=productOwner(locals.user);
 if(locals.viewer||locals.apiToken||process.env.GALENE_DEMO==='1')return fail(403,{ok:false,error:'Use the owner app session to save evidence.'});
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return fail(403,{ok:false,error:'Submit from this app.'});
 const context=locals.financeEvidence?.ownerId===ownerId?locals.financeEvidence:null;
 if(!context)return fail(409,{ok:false,error:'Approved source and currency mappings have not been connected. No evidence was saved.'});
 try{
  const scope=productActivity(ownerId,url),policies=context.historyPolicies.filter(p=>scope.accountId===null||p.accountId===scope.accountId);
  const result=captureTrustedHistoryEvidence(db(),{ownerId,canRead:true,canCapture:true},policies,await boundedForm(request),new Date().toISOString(),context.historyReceipts);
  return {ok:true,historySaved:true,receipt:result};
 }catch{return fail(400,{ok:false,error:'Evidence was not saved. Reload to check existing history and current source evidence before retrying.'});}
}};
