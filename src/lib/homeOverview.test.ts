import { expect, test } from 'bun:test';
import { plugin } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { fixture } from '../../ui-preview/product-fixtures';
import { formatMoney } from './utils';
plugin({name:'home-view-ssr',setup(build){build.onLoad({filter:/(HomeOverview|FinancialBadge|PeriodPicker|ReflectionOverview|ReflectTabs|ContributionList)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
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
