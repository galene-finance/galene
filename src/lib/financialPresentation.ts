import {activityParts} from './activity';
import type {Category,Transaction} from './types';
export type FinancialTone='neutral'|'positive'|'attention'|'negative'|'movement';
export function transactionPresentation(t:Transaction,categories:Category[]):{label:string;tone:FinancialTone}{
 if(t.pending)return {label:'Pending',tone:'attention'};
 if(t.splits?.length){
  const parts=activityParts(t,new Map(categories.map(c=>[c.id,c])));
  return parts.some(p=>p.type===null)?{label:'Review split',tone:'attention'}:{label:'Split transaction',tone:'neutral'};
 }
 const type=categories.find(c=>c.id===t.category_id)?.type;
 if(type==='transfer')return {label:'Transfer / payment',tone:'movement'};
 if(type==='income')return {label:t.amount_cents<0?'Income reversal':'Income',tone:t.amount_cents<0?'negative':'positive'};
 if(type==='expense')return {label:t.amount_cents>0?'Refund':'Spending',tone:t.amount_cents>0?'positive':'neutral'};
 return {label:'Needs category',tone:'attention'};
}
