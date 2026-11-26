import type { Category, CategoryType, Transaction } from './types';

/** One signed, classified portion. Splits use positive magnitudes in Galene. */
export interface ActivityPart { transaction: Transaction; categoryId: number | null; type: CategoryType | null; cents: number }
export function activityParts(t: Transaction, categories: Map<number, Category>): ActivityPart[] {
 const splits=t.splits ?? [];
 if(splits.length){
  if(splits.some(s=>!Number.isSafeInteger(s.amount_cents)||s.amount_cents<=0)||splits.reduce((n,s)=>n+s.amount_cents,0)!==Math.abs(t.amount_cents))
   return categories.get(t.category_id ?? -1)?.system_kind === 'balance_adjustment'
    ? []
    : [{transaction:t,categoryId:null,type:null,cents:t.amount_cents}];
  return splits
   .filter(s=>categories.get(s.category_id)?.system_kind !== 'balance_adjustment')
   .map(s=>({transaction:t,categoryId:s.category_id,type:categories.get(s.category_id)?.type??null,cents:Math.sign(t.amount_cents)*s.amount_cents}));
 }
 if(t.category_id!==null&&categories.get(t.category_id)?.system_kind==='balance_adjustment')return [];
 return [{transaction:t,categoryId:t.category_id,type:t.category_id===null?null:categories.get(t.category_id)?.type??null,cents:t.amount_cents}];
}
export function summarizeActivity(transactions:Transaction[],categories:Category[],includePending=false){
 const byId=new Map(categories.map(c=>[c.id,c]));
 const parts=transactions.filter(t=>includePending||!t.pending).flatMap(t=>activityParts(t,byId));
 let incomeCents=0,spendingCents=0,uncategorizedInCents=0,uncategorizedOutCents=0;
 const unknown=new Set<number>(),transfers=new Set<number>();
 const grouped=new Map<number,{id:number;name:string;type:CategoryType;cents:number;count:number}>();
 for(const p of parts){
  if(p.type==='income')incomeCents+=p.cents;
  else if(p.type==='expense')spendingCents-=p.cents;
  else if(p.type==='transfer')transfers.add(p.transaction.id);
  else {unknown.add(p.transaction.id); if(p.cents>=0)uncategorizedInCents+=p.cents;else uncategorizedOutCents-=p.cents;}
  if(p.categoryId!==null&&p.type){
   const c=grouped.get(p.categoryId)??{id:p.categoryId,name:byId.get(p.categoryId)!.name,type:p.type,cents:0,count:0};
   c.cents+=p.cents;c.count++;grouped.set(c.id,c);
  }
 }
 return {incomeCents,spendingCents,netCents:incomeCents-spendingCents,uncategorizedInCents,uncategorizedOutCents,
  uncategorizedCount:unknown.size,transferCount:transfers.size,pendingCount:transactions.filter(t=>t.pending).length,
  postedCount:transactions.filter(t=>!t.pending).length,categories:[...grouped.values()],parts};
}
export function scheduleKind(cents:number,type:CategoryType|null|undefined):'Income'|'Bill'|'Transfer'|'Refund'|'Income reversal'|'Money in'|'Money out'{
 if(type==='transfer')return 'Transfer';
 if(type==='income')return cents>=0?'Income':'Income reversal';
 if(type==='expense')return cents<0?'Bill':'Refund';
 return cents>=0?'Money in':'Money out';
}
