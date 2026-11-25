import type { Target, TargetEvaluation, TargetProgress } from './types';
import {add,cents,civil,monthStart,shiftMonths,monthDistance,monthEnd} from './validation';
export function targetCycle(t:Target,month:string):{start:string;due:string|null;active:boolean;goal:number} {
 const start=monthStart(month); civil(t.startDate); cents(t.amountCents);
 if(t.amountCents<0||!t.id||!Number.isSafeInteger(t.categoryId)||t.categoryId<=0||!['refill','set_aside','balance'].includes(t.behavior)||!['monthly','weekly','annual','irregular'].includes(t.cadence))throw new Error('invalid target');
 if(t.dueDate){civil(t.dueDate);if(t.dueDate<t.startDate)throw new Error('due before start');}
 if(t.repeatMonths!==undefined&&(!Number.isSafeInteger(t.repeatMonths)||t.repeatMonths<1||t.repeatMonths>1200))throw new Error('invalid repeat');
 if(t.cadence==='weekly'&&(!Number.isInteger(t.weekday)||t.weekday!<0||t.weekday!>6))throw new Error('invalid weekday');
 if(t.cadence==='annual'&&!t.dueDate)throw new Error('due date required');
 if(t.cadence==='irregular'&&!t.dueDate&&t.behavior!=='balance')throw new Error('due date required');
 if(month<t.startDate.slice(0,7))return {start:t.startDate,due:t.dueDate??null,active:false,goal:0};
 if(t.cadence==='monthly'||t.cadence==='weekly'){
  let goal=t.amountCents;
  if(t.cadence==='weekly'){
   let count=0;const end=Number(monthEnd(month).slice(8));
   for(let day=1;day<=end;day++)if(civil(`${month}-${String(day).padStart(2,'0')}`).getUTCDay()===t.weekday)count++;
   goal=cents(goal*count);
  }
  return {start:month===t.startDate.slice(0,7)?t.startDate:start,due:monthEnd(month),active:true,goal};
 }
 let due=t.dueDate??null,cycleStart=t.startDate;
 const repeat=t.cadence==='annual'?12:t.repeatMonths;
 if(due&&month>due.slice(0,7)){
  if(!repeat)return {start:cycleStart,due,active:false,goal:0};
  const cycles=Math.ceil(monthDistance(due,start)/repeat);
  cycleStart=shiftMonths(monthStart(shiftMonths(due,(cycles-1)*repeat).slice(0,7)),1);
  due=shiftMonths(due,cycles*repeat);
 }
 return {start:cycleStart,due,active:true,goal:t.amountCents};
}
export function evaluateTarget(t:Target,month:string,p:TargetProgress):TargetEvaluation {
 const cycle=targetCycle(t,month); for(const value of Object.values(p))cents(value);
 const count=cycle.due?Math.max(1,monthDistance(monthStart(month),cycle.due)+1):1;
 const beforeMonthAssigned=add(p.cycleAssignedCents,-p.monthAssignedCents);
 const base=t.behavior==='refill'?Math.max(0,p.cycleStartAvailableCents):0;
 const remainingCents=cycle.active?Math.max(0,t.behavior==='balance'?add(cycle.goal,-p.availableCents):add(add(cycle.goal,-base),-p.cycleAssignedCents)):0;
 const plannedCents=cycle.active?Math.ceil(Math.max(0,t.behavior==='balance'?add(add(cycle.goal,-p.availableCents),p.monthAssignedCents):add(add(cycle.goal,-base),-beforeMonthAssigned))/count):0;
 const neededThisMonthCents=Math.min(remainingCents,Math.max(0,add(plannedCents,-p.monthAssignedCents)));
 return {targetId:t.id,categoryId:t.categoryId,month,cycleStart:cycle.start,dueDate:cycle.due,goalCents:cycle.goal,plannedCents,remainingCents,neededThisMonthCents,active:cycle.active};
}
export function costToBeMe(targets:readonly Target[],month:string,progress:ReadonlyMap<number,TargetProgress>,obligations:readonly {id:string;categoryId:number|null;amountCents:number}[]){
 const seen=new Set<number>();const ids=new Set<string>();
 const lines=targets.map(t=>{
  if(seen.has(t.categoryId)||ids.has(t.id))throw new Error('duplicate target/category');seen.add(t.categoryId);ids.add(t.id);
  return evaluateTarget(t,month,progress.get(t.categoryId)??{cycleAssignedCents:0,monthAssignedCents:0,cycleStartAvailableCents:0,availableCents:0});
 });
 const coveredObligationIds:string[]=[],uncoveredObligationIds:string[]=[];const os=new Set<string>();
 for(const o of obligations){cents(o.amountCents);if(o.amountCents<0||os.has(o.id))throw new Error('invalid obligation');os.add(o.id);(lines.some(l=>l.active&&l.categoryId===o.categoryId)?coveredObligationIds:uncoveredObligationIds).push(o.id);}
 return {month,totalCents:lines.some(l=>l.active)?lines.reduce((n,l)=>add(n,l.plannedCents),0):null,neededThisMonthCents:lines.reduce((n,l)=>add(n,l.neededThisMonthCents),0),lines,coveredObligationIds,uncoveredObligationIds,allProvidedObligationsCovered:uncoveredObligationIds.length===0,obligationCoverage:obligations.length?'provided_only':'not_supplied'};
}
