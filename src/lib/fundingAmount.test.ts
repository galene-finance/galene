import {test,expect} from 'bun:test';import {plugin} from 'bun';import {readFileSync} from 'node:fs';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';import type {ComponentProps} from 'svelte';
import evidence from './fixtures/budget-qa-states.json';
plugin({name:'funding-amount-ssr',setup(build){build.onLoad({filter:/(FundingAmount|FinancialBadge)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const {default:Amount}=await import('./components/FundingAmount.svelte');type State=ComponentProps<typeof Amount>['state'];
const expected:Record<string,[string,string,string|null]>={
 'initial-underfunded':['No cash left','attention','$0.00'],
 'assignment-after-reopen':['Funded','positive','$100.00'],
 'stale-before-refresh':['Funding unknown','attention',null],
 'spent-after-reopen':['No cash left','neutral','$0.00'],
 'refund-after-reopen':['Funded','positive','$40.00'],
 'reallocation-after-reopen':['Underfunded','attention','$20.00'],
 'target-edit-after-reopen':['Funded','positive','$20.00'],
 'card-purchase-after-reopen':['Funded','positive','$20.00'],
 'card-refund-after-reopen':['Funded','positive','$20.00'],
 'card-payment-after-reopen':['Funded','positive','$20.00'],
 'rollover-after-reopen':['Underfunded','attention','$20.00']
};
for(const record of evidence.records)test(`actual FundingAmount renders W17 persisted DTO: ${record.label}`,()=>{
 const html=render(Amount,{props:{state:record.states[0] as State}}).body;const [label,tone,value]=expected[record.label];expect(html).toContain(label);expect(html).toContain(`data-tone="${tone}"`);if(value===null)expect(html).not.toContain('$');else expect(html).toContain(value);
});
test('unknown/unbacked never display nominal available cash; overspending remains explicit',()=>{
 const base=evidence.records[1].states[0] as State;
 for(const cashStatus of ['unknown','unbacked'] as const){const html=render(Amount,{props:{state:{...base,cashStatus,availableCents:5000}}}).body;expect(html).not.toContain('$50.00');expect(html).not.toContain('>Funded<');expect(html).toContain('data-tone="attention"');}
 const cash=render(Amount,{props:{state:{...base,cashStatus:'cash_overspent',availableCents:-1000}}}).body;expect(cash).toContain('Cash overspent');expect(cash).toContain('data-tone="negative"');expect(cash).not.toContain('>Funded<');
 const credit=render(Amount,{props:{state:{...base,cashStatus:'credit_overspent',availableCents:0,creditOverspentCents:1200}}}).body;expect(credit).toContain('Credit overspent');expect(credit).toContain('$12.00');expect(credit).toContain('data-tone="negative"');
 const untargeted=render(Amount,{props:{state:evidence.records[0].states[2] as State}}).body;expect(untargeted).toContain('No cash left');expect(untargeted).toContain('data-tone="neutral"');
});
