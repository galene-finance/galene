import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import type {LedgerEvent} from '../../budget/types';
import {add,cents,civil} from '../../budget/validation';
export type RegisterRow={id:number;account_id:number;category_id:number|null;amount_cents:number;date:string;pending:boolean|number;splits:{category_id:number;amount_cents:number}[]};
export type TransferPair={outflowId:number;inflowId:number;categoryId?:number};
export type RegisterCategory={id:number;kind:'expense'|'income'|'transfer'};
export function normalizeRegister(rows:readonly RegisterRow[],categories:readonly RegisterCategory[],pairs:readonly TransferPair[]){
 const byId=new Map(rows.map(r=>[r.id,r]));if(byId.size!==rows.length)throw new Error('duplicate transaction');
 const kinds=new Map(categories.map(c=>[c.id,c.kind]));if(kinds.size!==categories.length)throw new Error('duplicate category');
 const events:LedgerEvent[]=[],issues:{transactionId:number;reason:string}[]=[];const paired=new Set<number>();
 for(const pair of pairs){
  const from=byId.get(pair.outflowId),to=byId.get(pair.inflowId);
  if(!from||!to||from.id===to.id||paired.has(from.id)||paired.has(to.id)||from.pending||to.pending||from.splits.length||to.splits.length||from.account_id===to.account_id||from.date!==to.date||from.amount_cents>=0||from.amount_cents!==-to.amount_cents||kinds.get(from.category_id??-1)!=='transfer'||kinds.get(to.category_id??-1)!=='transfer'){
   issues.push({transactionId:pair.outflowId,reason:'invalid_transfer_pair'});continue;
  }
  civil(from.date);cents(from.amount_cents);paired.add(from.id);paired.add(to.id);
  events.push({id:`tx:transfer:${from.id}:${to.id}`,date:from.date,kind:'transfer',fromAccountId:from.account_id,toAccountId:to.account_id,amountCents:-from.amount_cents,...(pair.categoryId===undefined?{}:{categoryId:pair.categoryId})});
 }
 for(const r of rows){
  civil(r.date);cents(r.amount_cents);if(r.pending||paired.has(r.id)||r.amount_cents===0)continue;
  const splits=r.splits;
  if(splits.length&&(splits.some(s=>!Number.isSafeInteger(s.amount_cents)||s.amount_cents<=0)||splits.reduce((n,s)=>add(n,s.amount_cents),0)!==Math.abs(r.amount_cents))){issues.push({transactionId:r.id,reason:'invalid_split'});continue;}
  const parts=splits.length?splits.map(s=>({categoryId:s.category_id,amount:Math.sign(r.amount_cents)*s.amount_cents})):[{categoryId:r.category_id,amount:r.amount_cents}];
  parts.forEach((part,i)=>{
   const kind=kinds.get(part.categoryId??-1);if(!kind){issues.push({transactionId:r.id,reason:'uncategorized'});return;}if(kind==='transfer'){issues.push({transactionId:r.id,reason:'unpaired_transfer'});return;}
   const base={id:`tx:${r.id}:${i}`,date:r.date,accountId:r.account_id};
   if(kind==='income')events.push({...base,kind:'income',amountCents:part.amount});
   else events.push({...base,kind:part.amount<0?'purchase':'refund',categoryId:part.categoryId!,amountCents:Math.abs(part.amount)});
  });
 }
 return {events:events.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id,undefined,{numeric:true})),issues};
}
/** Local owner-scoped read seam. Caller still declares provider/coverage freshness separately. */
export function readRegister(database:Database,ownerId:number,from:string,through:string,pairs:TransferPair[]=[]){
 civil(from);civil(through);if(from>through)throw new Error('invalid register range');
 const rows=database.query('SELECT id,account_id,category_id,amount_cents,date,pending FROM transactions WHERE user_id=? AND date>=? AND date<=? ORDER BY date,id').all(ownerId,from,through) as Omit<RegisterRow,'splits'>[];
 const splits=database.query('SELECT s.transaction_id,s.category_id,s.amount_cents FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id WHERE t.user_id=? AND t.date>=? AND t.date<=? ORDER BY t.id,s.id').all(ownerId,from,through) as {transaction_id:number;category_id:number;amount_cents:number}[];
 const categories=database.query("SELECT id,CASE WHEN is_transfer=1 THEN 'transfer' ELSE type END AS kind FROM categories WHERE user_id=? ORDER BY id").all(ownerId) as RegisterCategory[];
 const hydrated=rows.map(r=>({...r,splits:splits.filter(s=>s.transaction_id===r.id).map(s=>({category_id:s.category_id,amount_cents:s.amount_cents}))}));
 const fingerprint=createHash('sha256').update(JSON.stringify({hydrated,categories,pairs})).digest('hex');
 return {...normalizeRegister(hydrated,categories,pairs),fingerprint,postedCount:rows.filter(r=>!r.pending).length};
}
