export function cents(n: number): number {
 if (!Number.isSafeInteger(n)) throw new Error('unsafe cents'); return n;
}
export function positive(n:number):number { cents(n); if(n<=0)throw new Error('positive cents required'); return n; }
export function add(a:number,b:number):number { return cents(a+b); }
export function civil(date:string):Date {
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('invalid date');
 const d=new Date(date+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date||date<'1900-01-01'||date>'9998-12-31')throw new Error('invalid date');
 return d;
}
export function monthStart(month:string):string { if(!/^\d{4}-\d{2}$/.test(month))throw new Error('invalid month'); civil(month+'-01');return month+'-01'; }
export function shiftMonths(date:string,n:number):string {
 const d=civil(date); const y=d.getUTCFullYear();const m=d.getUTCMonth()+n;
 const end=new Date(Date.UTC(y,m+1,0)).getUTCDate();
 const result=new Date(Date.UTC(y,m,Math.min(d.getUTCDate(),end))).toISOString().slice(0,10);civil(result);return result;
}
export function monthDistance(a:string,b:string):number {const x=civil(a),y=civil(b);return (y.getUTCFullYear()-x.getUTCFullYear())*12+y.getUTCMonth()-x.getUTCMonth();}
export function monthEnd(month:string):string {const d=civil(monthStart(month));return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10);}
export function timestamp(value:string):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw new Error('invalid UTC timestamp');
 civil(value.slice(0,10));return value;
}
