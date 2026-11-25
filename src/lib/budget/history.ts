import type {BalanceSnapshot,HistoryAccount,HistoryPoint} from './types';
import {add,cents,civil,timestamp} from './validation';
export function validateSnapshot(s:BalanceSnapshot):void {
 cents(s.balanceCents);timestamp(s.asOf);timestamp(s.recordedAt);
 if(!Number.isSafeInteger(s.accountId)||s.accountId<1||!['actual','accepted_estimate','reconstructed'].includes(s.source)||typeof s.evidence!=='string'||!s.evidence.trim())throw new Error('invalid snapshot evidence');
 if(s.recordedAt<s.asOf)throw new Error('snapshot from future');
 if(s.source==='reconstructed'&&(!s.coverageFrom||!s.coverageTo))throw new Error('reconstruction coverage required');
 if(s.coverageFrom)civil(s.coverageFrom);if(s.coverageTo)civil(s.coverageTo);
 if(s.coverageFrom&&s.coverageTo&&(s.coverageFrom>s.asOf.slice(0,10)||s.coverageTo<s.asOf.slice(0,10)))throw new Error('outside coverage');
}
/** No interpolation or stale carry-forward: a daily gap is a gap, never a fabricated zero. */
export function netWorthHistory(accounts:readonly HistoryAccount[],snapshots:readonly BalanceSnapshot[],dates:readonly string[]):HistoryPoint[]{
 if(new Set(accounts.map(a=>a.id)).size!==accounts.length||new Set(dates).size!==dates.length)throw new Error('duplicate identity/date');
 for(const a of accounts){if(!Number.isSafeInteger(a.id)||a.id<1)throw new Error('invalid account');if(a.fromDate)civil(a.fromDate);if(a.throughDate)civil(a.throughDate);if(a.fromDate&&a.throughDate&&a.fromDate>a.throughDate)throw new Error('invalid account coverage');}
 for(const s of snapshots)validateSnapshot(s);
 return [...dates].sort().map(date=>{
  civil(date);const expected=accounts.filter(a=>a.included&&(!a.fromDate||a.fromDate<=date)&&(!a.throughDate||a.throughDate>=date));
  const sources:BalanceSnapshot[]=[];const missingAccountIds:number[]=[];
  for(const a of expected){
   const candidates=snapshots.filter(s=>s.accountId===a.id&&s.asOf.slice(0,10)===date).sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.recordedAt.localeCompare(a.recordedAt));
   if(!candidates.length){missingAccountIds.push(a.id);continue;}
   const chosen=candidates[0];if(candidates.some(s=>s.asOf===chosen.asOf&&s.recordedAt===chosen.recordedAt&&s.balanceCents!==chosen.balanceCents))throw new Error('conflicting snapshots');
   sources.push({...chosen});
  }
  const knownSubtotalCents=sources.reduce((n,s)=>add(n,s.balanceCents),0);const complete=missingAccountIds.length===0&&expected.length>0;
  return {date,totalCents:complete?knownSubtotalCents:null,knownSubtotalCents,missingAccountIds,includedAccountIds:expected.map(a=>a.id),sources,complete};
 });
}
/** Requires caller-attested complete posted activity, not merely an exhausted partial API page. */
export function reconstructHistory(anchor:BalanceSnapshot,transactions:readonly {id:string;date:string;amountCents:number}[],coverage:{from:string;to:string;complete:boolean;reference:string},dates:readonly string[]):BalanceSnapshot[]{
 validateSnapshot(anchor);civil(coverage.from);civil(coverage.to);if(coverage.from>coverage.to)throw new Error('invalid coverage');
 if(!anchor.asOf.endsWith('T23:59:59.999Z'))throw new Error('day-end anchor required');
 if(!coverage.complete||!coverage.reference.trim())return [];
 const anchorDay=anchor.asOf.slice(0,10);if(anchorDay<coverage.from||anchorDay>coverage.to)return [];
 const seen=new Set<string>();for(const t of transactions){civil(t.date);cents(t.amountCents);if(!t.id||seen.has(t.id))throw new Error('duplicate transaction');seen.add(t.id);if(t.date<coverage.from||t.date>coverage.to)throw new Error('transaction outside coverage');}
 return dates.filter(date=>{civil(date);return date>=coverage.from&&date<=coverage.to;}).map(date=>{
  let balanceCents=anchor.balanceCents;
  for(const t of transactions){if(date<anchorDay&&t.date>date&&t.date<=anchorDay)balanceCents=add(balanceCents,-t.amountCents);if(date>anchorDay&&t.date>anchorDay&&t.date<=date)balanceCents=add(balanceCents,t.amountCents);}
  const asOf=date+'T23:59:59.999Z';if(asOf>anchor.recordedAt)throw new Error('cannot reconstruct future');
  return {accountId:anchor.accountId,asOf,recordedAt:anchor.recordedAt,balanceCents,source:'reconstructed',evidence:`${anchor.source}: ${anchor.evidence}; ${coverage.reference}`,coverageFrom:coverage.from,coverageTo:coverage.to};
 });
}
