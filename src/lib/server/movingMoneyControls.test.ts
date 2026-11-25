import {test,expect} from 'bun:test';
import {plugin} from 'bun';import {readFileSync} from 'node:fs';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';
import type {MovingMoneyModel} from '../movingMoneyFeatureTypes';
plugin({name:'moving-money-feature-ssr',setup(build){build.onLoad({filter:/(MoveMoneyControls|CardReserveControls|FinancialBadge)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const model:MovingMoneyModel={revision:3,month:'2024-02',asOfDate:'2024-02-29',currency:'USD',known:true,reason:null,cashCents:100000,readyToAssignCents:70000,assignableCents:70000,shortfallCents:0,categories:[{id:1,name:'Groceries',availableCents:30000,creditOverspentCents:0},{id:2,name:'Eating out',availableCents:0,creditOverspentCents:0}],cards:[{id:2,name:'Everyday card',reservedCents:5000,cashBackedReserveCents:5000,debtCents:20000,unfundedCents:15000}]};
test('actual move and card controls render named POST forms, filled badges and no bank-payment action',async()=>{
 const {default:Move}=await import('../components/MoveMoneyControls.svelte');const {default:Card}=await import('../components/CardReserveControls.svelte');
 const props={model,commandKey:'synthetic-key'};const move=render(Move,{props}).body,card=render(Card,{props}).body;
 expect(move).toContain('from_category_id');expect(move).toContain('to_category_id');expect(move).toContain('Move allocation');expect(move).toContain('financial-badge');
 expect(card).toContain('Card payment reserves');expect(card).toContain('No payment');expect(card).toContain('Cash reserved');expect(card).toContain('direction');
 const unavailable=render(Move,{props:{...props,model:{...model,known:false,reason:'Refresh posted activity first.',readyToAssignCents:null,cashCents:null,categories:model.categories.map(c=>({...c,availableCents:null}))}}}).body;
 expect(unavailable).toContain('Refresh posted activity first.');expect(unavailable).toContain('disabled');expect(unavailable).not.toContain('$300.00');
});
test('QA-M01 SSR buttons do not require hydration; coverage still gates both forms',async()=>{
 const {default:Move}=await import('../components/MoveMoneyControls.svelte');const {default:Card}=await import('../components/CardReserveControls.svelte');
 const native={...model,readyToAssignCents:0,assignableCents:0,cards:[{...model.cards[0],reservedCents:10000,cashBackedReserveCents:10000}]};
 const move=render(Move,{props:{model:native,commandKey:'native'}}).body,card=render(Card,{props:{model:native,commandKey:'native'}}).body;
 expect(move.match(/<button[^>]*>/)?.[0]).not.toContain('disabled');expect(card.match(/<button[^>]*>/)?.[0]).not.toContain('disabled');expect(card).toContain('Update reserve');expect(card).not.toContain('Can add from unassigned cash');expect(card).toContain('Everyday card');
 for(const Component of [Move,Card]){const blocked=render(Component,{props:{model:{...native,known:false,reason:'Refresh required'},commandKey:'blocked'}}).body;expect(blocked).toContain('<fieldset disabled');expect(blocked.match(/<button[^>]*>/)?.[0]).toContain('disabled');}
});
