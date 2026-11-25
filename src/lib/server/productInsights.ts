
import { activityParts } from '$lib/activity';
import { productActivity } from './product';
import { getTransactionsInPeriod,monthBounds,shiftMonth } from './finance';
import { summarizeActivity } from '$lib/activity';
import { error } from '@sveltejs/kit';

export function productInsights(userId:number,url:URL,type:'income'|'expense') {
 const data=productActivity(userId,url);
 const parts=data.transactions.filter(t=>!t.pending).flatMap(t=>activityParts(t,new Map(data.categories.map(c=>[c.id,c])))).filter(p=>p.type===type);
 const categoryRows=data.summary.categories.filter(c=>c.type===type).sort((a,b)=>type==='income'?b.cents-a.cents:a.cents-b.cents);
 const byTransaction=new Map<number,{transaction:typeof data.transactions[number];contributionCents:number}>();
 for(const p of parts){const row=byTransaction.get(p.transaction.id)??{transaction:p.transaction,contributionCents:0};row.contributionCents+=p.cents;byTransaction.set(p.transaction.id,row);}
 const contributions=[...byTransaction.values()].sort((a,b)=>b.transaction.date.localeCompare(a.transaction.date)||b.transaction.id-a.transaction.id);
 const history=Array.from({length:6},(_,i)=>shiftMonth(data.period.month,i-5)).map(month=>{
  const {from,to}=monthBounds(month);const s=summarizeActivity(getTransactionsInPeriod(userId,from,to),data.categories);
  return {month,cents:type==='income'?s.incomeCents:s.spendingCents,postedCount:s.postedCount,uncategorizedCount:s.uncategorizedCount};
 });
 return {...data,type,categoryRows,contributions,history};
}
export function productCategory(userId:number,url:URL,id:number){
 const data=productActivity(userId,url),category=data.categories.find(c=>c.id===id);
 if(!category)error(404,'Category not found.');
 const ids=new Set([id]);

 const cats=new Map(data.categories.map(c=>[c.id,c]));
 const parts=data.transactions.filter(t=>!t.pending).flatMap(t=>activityParts(t,cats)).filter(p=>p.categoryId!==null&&ids.has(p.categoryId));
 const rows=new Map<number,{transaction:typeof data.transactions[number];contributionCents:number}>();
 for(const p of parts){const r=rows.get(p.transaction.id)??{transaction:p.transaction,contributionCents:0};r.contributionCents+=p.cents;rows.set(p.transaction.id,r);}
 return {...data,category,totalCents:parts.reduce((n,p)=>n+p.cents,0),contributions:[...rows.values()].sort((a,b)=>b.transaction.date.localeCompare(a.transaction.date)||b.transaction.id-a.transaction.id)};
}
