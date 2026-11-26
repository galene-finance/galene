import type {BudgetAccount,CategoryFunds,LedgerEvent,LedgerView} from './types';
import {add,cents,civil,positive} from './validation';
/** Deterministic projection; input order breaks same-day ties. No clock, bank calls or mutable inputs. */
export function projectLedger(initial:readonly BudgetAccount[],categoryIds:readonly number[],events:readonly LedgerEvent[],throughDate:string,options:{validateAllocationIds?:readonly string[]}={}):LedgerView {
 civil(throughDate);
 const accounts=initial.map(a=>({...a}));
 const cats:CategoryFunds[]=categoryIds.map(categoryId=>({categoryId,availableCents:0,assignedCents:0,activityCents:0,creditOverspentCents:0}));
 const account=(id:number)=>{const a=accounts.find(a=>a.id===id);if(!a)throw new Error('unknown account');return a;};
 const category=(id:number)=>{const c=cats.find(c=>c.categoryId===id);if(!c)throw new Error('unknown category');return c;};
 for(const a of accounts){cents(a.balanceCents);if(!Number.isSafeInteger(a.id)||a.id<=0||!['cash','credit','tracking'].includes(a.scope))throw new Error('invalid account');}
 if(new Set(accounts.map(a=>a.id)).size!==accounts.length||new Set(categoryIds).size!==categoryIds.length||categoryIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('duplicate or invalid identity');
 const reserves=new Map(accounts.filter(a=>a.scope==='credit').map(a=>[a.id,0]));
 const shortfalls:{accountId:number;categoryId:number;amount:number}[]=[];
 const cash=()=>accounts.reduce((n,a)=>add(n,a.scope==='cash'?a.balanceCents:a.scope==='credit'?Math.max(0,a.balanceCents):0),0);
 const negatives=()=>cats.reduce((n,c)=>add(n,Math.min(0,c.availableCents)),0);
 let rta=cash(),expense=0,unclassified=0;const seen=new Set<string>();const applied:string[]=[];
 const reserve=(id:number,n:number)=>reserves.set(id,add(reserves.get(id)!,n));
 const retire=(id:number,n:number,categoryId?:number)=>{let left=n;for(const s of shortfalls){if(s.accountId!==id||(categoryId!==undefined&&s.categoryId!==categoryId))continue;const used=Math.min(left,s.amount);s.amount-=used;left-=used;}return n-left;};
 const fill=(c:CategoryFunds,n:number)=>{
  c.availableCents=add(c.availableCents,n);
  for(const s of shortfalls){if(s.categoryId!==c.categoryId)continue;const debt=Math.max(0,-account(s.accountId).balanceCents-reserves.get(s.accountId)!);const used=Math.min(Math.max(0,c.availableCents),s.amount,debt);s.amount-=used;c.availableCents-=used;reserve(s.accountId,used);}
 };
 const capReserve=(a:BudgetAccount)=>{if(a.scope!=='credit')return;const excess=Math.max(0,reserves.get(a.id)!-Math.max(0,-a.balanceCents));reserve(a.id,-excess);rta=add(rta,excess);const short=shortfalls.filter(s=>s.accountId===a.id).reduce((n,s)=>add(n,s.amount),0);retire(a.id,Math.max(0,short-Math.max(0,-a.balanceCents-reserves.get(a.id)!)));};
 const invariant=()=>{
  const allocated=cats.reduce((n,c)=>add(n,c.availableCents),0);
  const reserved=[...reserves.values()].reduce((n,v)=>add(n,v),0);
  if(add(add(rta,allocated),reserved)!==cash())throw new Error('cash conservation violated');
  for(const [id,n] of reserves)if(n<0||n>Math.max(0,-account(id).balanceCents))throw new Error('reserve exceeds debt');
 };
 for(const e of events.map((e,i)=>({e,i})).sort((a,b)=>a.e.date.localeCompare(b.e.date)||a.i-b.i).map(x=>x.e)){
  civil(e.date);if(!e.id||seen.has(e.id))throw new Error('duplicate event');seen.add(e.id);if(e.date>throughDate)continue;
  cents(e.amountCents);const n=e.amountCents;const strict=options.validateAllocationIds===undefined||options.validateAllocationIds.includes(e.id);
  switch(e.kind){
   case 'assign': {
    const c=category(e.categoryId);const covering=Math.min(Math.max(0,n),Math.max(0,-c.availableCents));
    if(strict&&(n>rta||n>Math.max(0,add(rta,negatives()))+covering||(n<0&&-n>Math.max(0,c.availableCents))))throw new Error('insufficient funds');
    rta=add(rta,-n);fill(c,n);c.assignedCents=add(c.assignedCents,n);break;
   }
   case 'move': {
    positive(n);const from=category(e.fromCategoryId),to=category(e.toCategoryId);
    if(from===to)throw new Error('same category');if(strict&&from.availableCents<n)throw new Error('insufficient funds');
    from.availableCents-=n;from.assignedCents=add(from.assignedCents,-n);fill(to,n);to.assignedCents=add(to.assignedCents,n);break;
   }
   case 'reserve': {
    const a=account(e.accountId);if(a.scope!=='credit')throw new Error('credit account required');
    if(strict&&(n>Math.max(0,add(rta,negatives()))||reserves.get(a.id)!+n<0||reserves.get(a.id)!+n>Math.max(0,-a.balanceCents)))throw new Error('insufficient funds or debt');
    const applied=Math.max(-reserves.get(a.id)!,Math.min(n,Math.max(0,-a.balanceCents)-reserves.get(a.id)!));
    rta=add(rta,-applied);reserve(a.id,applied);if(applied>0)retire(a.id,applied);break;
   }
   case 'income': {
    if(n===0)throw new Error('nonzero income required');const a=account(e.accountId);const before=cash();a.balanceCents=add(a.balanceCents,n);rta=add(rta,cash()-before);capReserve(a);break;
   }
   case 'unclassified': {
    if(n===0)throw new Error('nonzero unclassified movement required');const a=account(e.accountId),before=cash();a.balanceCents=add(a.balanceCents,n);rta=add(rta,cash()-before);capReserve(a);unclassified++;break;
   }
   case 'purchase': {
    positive(n);const a=account(e.accountId),c=category(e.categoryId);
    if(a.scope==='tracking'){a.balanceCents=add(a.balanceCents,-n);break;}
    if(a.scope==='cash')c.availableCents=add(c.availableCents,-n);
    else {
     const creditUsed=Math.min(Math.max(0,a.balanceCents),n);c.availableCents=add(c.availableCents,-creditUsed);
     const debt=n-creditUsed,funded=Math.min(Math.max(0,c.availableCents),debt);c.availableCents-=funded;reserve(a.id,funded);
     if(debt>funded)shortfalls.push({accountId:a.id,categoryId:c.categoryId,amount:debt-funded});
    }
    a.balanceCents=add(a.balanceCents,-n);c.activityCents=add(c.activityCents,-n);expense=add(expense,n);break;
   }
   case 'refund': {
    positive(n);const a=account(e.accountId),c=category(e.categoryId);
    if(a.scope==='tracking'){a.balanceCents=add(a.balanceCents,n);break;}
    if(a.scope==='cash')fill(c,n);
    else {
     const debtPart=Math.min(Math.max(0,-a.balanceCents),n);
     const unfunded=retire(a.id,debtPart,c.categoryId);
     const released=Math.min(reserves.get(a.id)!,debtPart-unfunded);reserve(a.id,-released);
     // A credit remaining after debt is cleared is real spendable card credit, not bank cash.
     fill(c,add(released,n-debtPart));
    }
    a.balanceCents=add(a.balanceCents,n);capReserve(a);c.activityCents=add(c.activityCents,n);expense=add(expense,-n);break;
   }
   case 'transfer': {
    positive(n);const from=account(e.fromAccountId),to=account(e.toAccountId);if(from===to)throw new Error('same account');
    if(from.scope==='credit'&&to.scope==='credit'){
     const beforeCash=cash(),debtPaid=Math.min(n,Math.max(0,-to.balanceCents)),debtAdded=Math.max(0,n-Math.max(0,from.balanceCents));
     const released=Math.min(reserves.get(to.id)!,debtPaid),moved=Math.min(released,debtAdded);reserve(to.id,-released);reserve(from.id,moved);
     let toMove=Math.min(debtPaid-released,debtAdded-moved);const lots=shortfalls.filter(s=>s.accountId===to.id);
     for(const lot of lots){const take=Math.min(toMove,lot.amount);lot.amount-=take;toMove-=take;if(take)shortfalls.push({accountId:from.id,categoryId:lot.categoryId,amount:take});}
     from.balanceCents=add(from.balanceCents,-n);to.balanceCents=add(to.balanceCents,n);rta=add(rta,add(cash()-beforeCash,released-moved));capReserve(from);capReserve(to);break;
    }
    if(from.scope==='tracking'&&to.scope==='credit'){
     const beforeCash=cash(),debtPaid=Math.min(n,Math.max(0,-to.balanceCents)),released=Math.min(reserves.get(to.id)!,debtPaid);reserve(to.id,-released);retire(to.id,debtPaid-released);
     from.balanceCents=add(from.balanceCents,-n);to.balanceCents=add(to.balanceCents,n);rta=add(rta,add(cash()-beforeCash,released));capReserve(to);break;
    }
    if(from.scope==='credit'&&to.scope==='tracking'){
     if(e.categoryId===undefined)throw new Error('tracking transfer category required');const c=category(e.categoryId);
     const creditUsed=Math.min(n,Math.max(0,from.balanceCents));c.availableCents=add(c.availableCents,-creditUsed);
     const debt=n-creditUsed,funded=Math.min(debt,Math.max(0,c.availableCents));c.availableCents-=funded;reserve(from.id,funded);
     if(debt>funded)shortfalls.push({accountId:from.id,categoryId:c.categoryId,amount:debt-funded});c.activityCents=add(c.activityCents,-n);
     from.balanceCents=add(from.balanceCents,-n);to.balanceCents=add(to.balanceCents,n);break;
    }
    if(from.scope==='cash'&&to.scope==='credit'){
     const debtPaid=Math.min(Math.max(0,-to.balanceCents),n),funded=Math.min(reserves.get(to.id)!,debtPaid);reserve(to.id,-funded);rta=add(rta,-(debtPaid-funded));retire(to.id,debtPaid-funded);
    }else if(from.scope==='cash'&&to.scope==='tracking'){
     if(e.categoryId===undefined)throw new Error('tracking transfer category required');const c=category(e.categoryId);c.availableCents=add(c.availableCents,-n);c.activityCents=add(c.activityCents,-n);
    }else if(from.scope==='tracking'&&to.scope==='cash'){
     if(e.categoryId===undefined)rta=add(rta,n);else{const c=category(e.categoryId);fill(c,n);c.activityCents=add(c.activityCents,n);}
    }else if(from.scope==='credit'&&to.scope==='cash'){
     const borrowed=Math.max(0,n-Math.max(0,from.balanceCents));rta=add(rta,borrowed);
    }
    from.balanceCents=add(from.balanceCents,-n);to.balanceCents=add(to.balanceCents,n);capReserve(from);capReserve(to);break;
   }
   default:throw new Error('unsupported event');
  }
  invariant();applied.push(e.id);
 }
 for(const c of cats)c.creditOverspentCents=shortfalls.filter(s=>s.categoryId===c.categoryId).reduce((n,s)=>add(n,s.amount),0);
 const cashBackingShortfallCents=Math.max(0,-add(rta,negatives()));
 return {cashBackingShortfallCents,cashCents:cash(),readyToAssignCents:rta,categories:cats,accounts,cardReserves:[...reserves].map(([accountId,reservedCents])=>({accountId,reservedCents,cashBackedReserveCents:cashBackingShortfallCents>0?null:reservedCents,debtCents:Math.max(0,-account(accountId).balanceCents),unfundedCents:Math.max(0,-account(accountId).balanceCents-reservedCents)})),netExpenseCents:expense,unclassifiedCount:unclassified,appliedEventIds:applied,cashOverspentCents:-negatives()};
}
