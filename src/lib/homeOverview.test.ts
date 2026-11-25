import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { fixture } from '../../ui-preview/product-fixtures';
import { formatMoney } from './utils';
plugin({name:'home-view-ssr',setup(build){build.onLoad({filter:/(HomeOverview|SettingsOverview|CategoryOverview|ScheduleAmount|TransactionAmount|AccountBalance|ProductTransactions|FinancialBadge|PeriodPicker|ReflectionOverview|ReflectTabs|ContributionList)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
test('transaction and balance badges keep state explicit',async()=>{
 expect(existsSync(new URL('./components/TransactionAmount.svelte',import.meta.url))).toBe(true);
 expect(existsSync(new URL('./components/AccountBalance.svelte',import.meta.url))).toBe(true);
 const {default:Amount}=await import('./components/TransactionAmount.svelte');
 const {default:Balance}=await import('./components/AccountBalance.svelte');
 const html=render(Amount,{props:{transaction:{amount_cents:500,category_id:2,pending:0,splits:[]} as any,categories:[{id:2,type:'expense'}] as any}}).body;
 expect(html).toContain('Refund');expect(html).toContain('$5.00');
 const unavailable=render(Balance,{props:{account:{type:'bank',displayCents:null}}}).body;
 expect(unavailable).toContain('Unavailable');expect(unavailable).not.toContain('$0.00');
 const owed=render(Balance,{props:{account:{type:'credit',displayCents:-10000}}}).body;
 expect(owed).toContain('Owed');expect(owed).toContain('$100.00');
 const overdraft=render(Balance,{props:{account:{type:'bank',displayCents:-100}}}).body;
 expect(overdraft).toContain('Negative balance');expect(overdraft).toContain('data-tone="attention"');
 const credit=render(Balance,{props:{account:{type:'credit',displayCents:100}}}).body;
 expect(credit).toContain('Balance');expect(credit).not.toContain('Owed');
});
test('Home recent activity is newest first with ID tie-break, limited to six without mutating input',async()=>{
 const {default:Home}=await import('./components/HomeOverview.svelte');
 const data=fixture(new URL('http://test.invalid/'));
 data.transactions=Array.from({length:8},(_,i)=>({...data.transactions[0],id:101+i,merchant:`Order sample ${101+i}`,date:i>=6?'2026-11-08':`2026-11-0${i+1}`}));
 const original=data.transactions.map(t=>t.id);
 const html=render(Home,{props:{data:data as any}}).body;
 const labels=[...html.matchAll(/Order sample (\d+)/g)].map(m=>Number(m[1]));
 expect(labels).toEqual([108,107,106,105,104,103]);
 expect(data.transactions.map(t=>t.id)).toEqual(original);
});
test('category drilldowns retain account scope and identify movement without earnings',async()=>{
 expect(existsSync(new URL('./components/CategoryOverview.svelte',import.meta.url))).toBe(true);
 const {default:View}=await import('./components/CategoryOverview.svelte');
 const base=fixture(new URL('http://test.invalid/'));
 const data={...base,accountId:7,category:{id:3,name:'Sample payment',type:'transfer'},totalCents:-1000,contributions:[{transaction:base.transactions[0],contributionCents:-1000}]};
 const html=render(View,{props:{data:data as any}}).body;
 expect(html).toContain('account=7');expect(html).toContain('name="account"');expect(html).toContain('value="7"');
 expect(html).toContain('Net movement');expect(html).toContain('Movement');expect(html).not.toContain('Included income');
});
test('scheduled amount badges describe expectations rather than received income',async()=>{
 expect(existsSync(new URL('./components/ScheduleAmount.svelte',import.meta.url))).toBe(true);
 const {default:Amount}=await import('./components/ScheduleAmount.svelte');
 const html=render(Amount,{props:{amount:50000,kind:'Income'}}).body;
 expect(html).toContain('Expected income');expect(html).toContain('$500.00');expect(html).toContain('data-tone="neutral"');
 expect(html).not.toContain('Received');expect(html).not.toContain('data-tone="positive"');
 const transfer=render(Amount,{props:{amount:-50000,kind:'Transfer'}}).body;
 expect(transfer).toContain('Expected transfer');expect(transfer).toContain('data-tone="movement"');
});
test('settings preserves every native destination and admin/demo visibility',async()=>{
 expect(existsSync(new URL('./components/SettingsOverview.svelte',import.meta.url))).toBe(true);
 const {default:View}=await import('./components/SettingsOverview.svelte');
 const {settingsSections}=await import('./settingsHub');
 for(const isAdmin of [false,true]){
  const html=render(View,{props:{data:{isAdmin,demo:true}}}).body;
  const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).sort();
  expect(hrefs).toEqual(settingsSections(isAdmin).flatMap(s=>s.cards.map(c=>c.href)).sort());
  expect(html).toContain('Demo — read only');
 }
 const filtered=render(View,{props:{data:{isAdmin:true},query:'no such setting'}}).body;
 expect(filtered).toContain('No matching settings');expect(filtered).toContain('Clear search');
});
test('month navigation retains the selected account',async()=>{
 const {default:Picker}=await import('./components/PeriodPicker.svelte');
 const html=render(Picker,{props:{month:'2026-11',path:'/reflect',accountId:7} as any}).body;
 expect(html).toContain('value="7"');
 expect(html).toContain('name="account"');
});
test('Reflect links preserve the report scope and expose actual-only views',async()=>{
 expect(existsSync(new URL('./components/ReflectionOverview.svelte',import.meta.url))).toBe(true);
 const {default:Reflection}=await import('./components/ReflectionOverview.svelte');
 const base=fixture(new URL('http://test.invalid/'));
 const data={...base,view:'summary',accountId:1,scopeQuery:base.period.query+'&account=1'};
 const html=render(Reflection,{props:{data:data as any}}).body;
 expect(html).toContain('Income less spending');
 expect(html).toContain('/spending?');
 expect(html).toContain('account=1');
 expect(html).toContain('view=trends');
 expect(html).not.toContain('Sample next salary');
});
test('contribution badges show only the matching portion, not a whole mixed transaction',async()=>{
 const {default:List}=await import('./components/ContributionList.svelte');
 const tx={...fixture(new URL('http://test.invalid/')).transactions[1],amount_cents:-10000};
 const html=render(List,{props:{rows:[{transaction:tx,contributionCents:-6000}],expense:true}}).body;
 expect(html).toContain('$60.00');
 expect(html).toContain('Included spending');
 expect(html).toContain('Part of $100.00');
});
test('a missing monthly plan stays unavailable rather than becoming zero',async()=>{
 const {default:Home}=await import('./components/HomeOverview.svelte');
 const data={...fixture(new URL('http://test.invalid/')),plan:{totalCents:null,targetIds:[],otherCadenceCount:0,excludedIncomeCount:0,needsReview:false}};
 const html=render(Home,{props:{data:data as any}}).body;
 expect(html).toContain('No monthly targets');expect(html).toContain('Build your plan');
});
test('an empty reporting period says no posted activity, not invented totals',async()=>{
 const {default:Reflection}=await import('./components/ReflectionOverview.svelte');
 const data={...fixture(new URL('http://test.invalid/?month=2025-01')),view:'summary'};
 const html=render(Reflection,{props:{data:data as any}}).body;
 expect(html).toContain('No posted activity in this period');expect(html).not.toContain('$0.00');
});
test('Home leads with the current plan and keeps positive wage expectations out of payments',async()=>{
 expect(existsSync(new URL('./components/HomeOverview.svelte',import.meta.url))).toBe(true);
 const {default:Home}=await import('./components/HomeOverview.svelte');
 const data=fixture(new URL('http://test.invalid/'));
 const html=render(Home,{props:{data:data as any}}).body;
 expect(html).toContain('Cost to be me');
 expect(html).toContain('Sample housing');
 expect(html).toContain(formatMoney(data.plan.totalCents!));
 expect(html).toContain('Reflect');
 expect(html).not.toContain('Sample next salary');
 expect(html).not.toContain('Expected income');
 expect(html.indexOf('Recorded totals are incomplete')).toBeLessThan(html.indexOf('Cost to be me'));
});
