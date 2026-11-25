import type {HistoryPoint,BalanceSource} from './budget/types';
import {civil} from './budget/validation';
export const historySourceLabel:Record<BalanceSource,string>={actual:'Recorded balance',accepted_estimate:'Accepted estimate',reconstructed:'Reconstructed'};
export type HistoryAccountLabel={id:number;name:string};
export type HistoryCaptureOffer={reference:string;accountName:string;balanceCents:number;currency:string;asOf:string;source:'actual'|'accepted_estimate';evidence:string};
/** Explicit daily buckets; no interpolation, timezone conversion or carry-forward. */
export function historyDates(from:string,to:string):string[]{
 const start=civil(from).getTime(),end=civil(to).getTime(),count=(end-start)/86400000+1;
 if(count<1||count>366)throw new Error('Choose a date range of 1–366 days.');
 return Array.from({length:count},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
export function historyMoney(cents:number,currency:string):string{
 return new Intl.NumberFormat('en-US',{style:'currency',currency,currencyDisplay:'code'}).format(cents/100);
}
export function historyDate(date:string):string{
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(civil(date));
}
export function historyPresentation(points:readonly HistoryPoint[]){
 const sorted=[...points].sort((a,b)=>a.date.localeCompare(b.date));
 const currencies=[...new Set(sorted.flatMap(p=>p.sources.map(s=>s.currency)))];
 const currency=currencies.length===1?currencies[0]:null;
 const complete=sorted.filter(p=>p.complete&&p.totalCents!==null);
 const values=complete.map(p=>p.totalCents!);const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
 const start=sorted.length?civil(sorted[0].date).getTime():0,end=sorted.length?civil(sorted[sorted.length-1].date).getTime():0;
 const status=currencies.length>1?'mixed_currency' as const:sorted.length?'ready' as const:'empty' as const;
 return {status,currency,latest:sorted.at(-1)??null,completeDays:complete.length,gapDays:sorted.length-complete.length,low,high,
  zeroY:180-(0-low)/span*150,
  // Isolated dots deliberately avoid suggesting balances between observations.
  plotted:status==='mixed_currency'?[]:complete.map(point=>({point,x:end===start?320:40+(civil(point.date).getTime()-start)/(end-start)*560,y:180-(point.totalCents!-low)/span*150}))};
}
