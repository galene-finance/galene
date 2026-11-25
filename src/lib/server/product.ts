import { error } from '@sveltejs/kit';
import {summarizeActivity} from '$lib/activity';
import {monthlyPlanTotal} from '$lib/monthlyPlan';
import { getAccounts,getBudgets,getAccountBalances,getAccountTxnAnchors,getCategories,getTransactionsInPeriod,getScheduled,expandScheduled,monthBounds,shiftMonth } from './finance';
import { todayISO } from '$lib/utils';

export function productPeriod(url:URL){
 let month=url.searchParams.get('month')??todayISO().slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))error(400,'Choose a valid month.');
 let {from,to}=monthBounds(month);
 const customFrom=url.searchParams.get('date_from'),customTo=url.searchParams.get('date_to');
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(new Date(`${s}T12:00:00Z`).getTime())&&new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)===s;
 if(customFrom!==null||customTo!==null){
  if(!customFrom||!customTo||!valid(customFrom)||!valid(customTo)||customFrom>customTo)error(400,'Choose a valid start and end date.');
  const end=new Date(`${customTo}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+1);
  from=customFrom;to=end.toISOString().slice(0,10);month=from.slice(0,7);
  if((end.getTime()-new Date(`${from}T12:00:00Z`).getTime())/86400000>366)error(400,'Choose a range of one year or less.');
 }
 const end=new Date(`${to}T12:00:00Z`);end.setUTCDate(end.getUTCDate()-1);
 const dateTo=end.toISOString().slice(0,10);
 return {month,from,to,dateTo,custom:customFrom!==null,query:customFrom!==null?`date_from=${from}&date_to=${dateTo}`:`month=${month}`,previous:shiftMonth(month,-1),next:shiftMonth(month,1)};
}
export function productAccounts(userId:number){
 const balances=getAccountBalances(userId);
 const anchors=getAccountTxnAnchors(userId);
 return getAccounts(userId).map(a=>{
  const reported=a.provider&&a.provider_balance_cents!=null;
  const anchored=a.opening_balance_cents!=null&&a.opening_as_of!=null;
  return {...a,earliestDate:anchors.get(a.id)?.earliestDate??null,ledgerCents:balances.get(a.id)??0,displayCents:reported?a.provider_balance_cents!:anchored?balances.get(a.id)??0:null,
   source:reported?'Bank reported':anchored?'Working balance':'Balance unavailable',asOf:reported?a.provider_balance_as_of??null:anchored?a.opening_as_of??null:null};
 });
}
export function productActivity(userId:number,url:URL){
 const period=productPeriod(url),categories=getCategories(userId);
 const all=getTransactionsInPeriod(userId,period.from,period.to);
 const account=url.searchParams.get('account');
 if(account!==null&&!/^[1-9]\d*$/.test(account))error(400,'Choose a valid account.');
 const accounts=productAccounts(userId);
 if(account!==null&&!accounts.some(a=>a.id===Number(account)))error(404,'Account not found.');
 const transactions=account===null?all:all.filter(t=>t.account_id===Number(account));
 const summary=summarizeActivity(transactions,categories);
 const {parts,...totals}=summary;
 return {period,categories,accounts,transactions,summary:totals,accountId:account===null?null:Number(account),scopeQuery:period.query+(account===null?'':`&account=${account}`)};
}
export function productHistory(userId:number,data:ReturnType<typeof productActivity>){
 return Array.from({length:6},(_,i)=>shiftMonth(data.period.dateTo.slice(0,7),i-5)).map(month=>{
  const {from,to}=monthBounds(month);const s=summarizeActivity(getTransactionsInPeriod(userId,from,to).filter(t=>data.accountId===null||t.account_id===data.accountId),data.categories);
  return {month,incomeCents:s.incomeCents,spendingCents:s.spendingCents,uncategorizedCount:s.uncategorizedCount,postedCount:s.postedCount};
 });
}
export function productOverview(userId:number,url:URL){
 const data=productActivity(userId,url),today=todayISO();
 const end=new Date(`${today}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+44);
 const upcoming=getScheduled(userId).flatMap(s=>expandScheduled(s,today,end.toISOString().slice(0,10))).sort((a,b)=>a.date.localeCompare(b.date));
 const history=productHistory(userId,data);
 return {...data,plan:monthlyPlanTotal(getBudgets(userId),new Map(data.categories.map(c=>[c.id,c.type]))),upcoming,history};
}
