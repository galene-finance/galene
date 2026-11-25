import {error} from '@sveltejs/kit';
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
 return {...data,history:view==='net-worth'?[]:productHistory(userId,data),view,netWorth};
}
