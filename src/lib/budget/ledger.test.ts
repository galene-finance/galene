import {test,expect} from 'bun:test';
import {projectLedger} from './ledger';
import type {BudgetAccount,LedgerEvent} from './types';
type Input<T=LedgerEvent> = T extends LedgerEvent ? Omit<T,'id'|'date'> : never;
const accounts:BudgetAccount[]=[{id:1,scope:'cash',balanceCents:100000},{id:2,scope:'credit',balanceCents:-20000},{id:3,scope:'tracking',balanceCents:500000}];
const ev=(id:string,e:Input,date='2026-11-01'):LedgerEvent=>({id,date,...e} as LedgerEvent);
const project=(es:LedgerEvent[],as=accounts)=>projectLedger(as,[1,2],es,'2026-12-31');
const assignment=ev('a',{kind:'assign',categoryId:1,amountCents:30000});
test('assign then funded card purchase moves cash into reserve, payment is not expense',()=>{
 const v=project([assignment,ev('b',{kind:'purchase',accountId:2,categoryId:1,amountCents:12000}),ev('c',{kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:12000})]);
 expect(v.cashCents).toBe(88000);expect(v.readyToAssignCents).toBe(70000);expect(v.categories[0].availableCents).toBe(18000);expect(v.cardReserves[0]).toMatchObject({reservedCents:0,debtCents:20000,unfundedCents:20000});expect(v.netExpenseCents).toBe(12000);
});
test('cash income, expense, refund and reallocation conserve actual funds',()=>{
 const v=project([assignment,ev('i',{kind:'income',accountId:1,amountCents:5000}),ev('p',{kind:'purchase',accountId:1,categoryId:1,amountCents:12000}),ev('r',{kind:'refund',accountId:1,categoryId:1,amountCents:2000}),ev('m',{kind:'move',fromCategoryId:1,toCategoryId:2,amountCents:5000})]);
 expect(v).toMatchObject({cashCents:95000,readyToAssignCents:75000,netExpenseCents:10000});expect(v.categories.map(c=>c.availableCents)).toEqual([15000,5000]);
});
test('credit shortfall is debt not cash; assignment later funds the reserve',()=>{
 const es=[ev('p',{kind:'purchase',accountId:2,categoryId:1,amountCents:10000})];
 const before=project(es);expect(before.categories[0]).toMatchObject({availableCents:0,creditOverspentCents:10000});expect(before.readyToAssignCents).toBe(100000);
 const after=project([...es,ev('a',{kind:'assign',categoryId:1,amountCents:6000})]);expect(after.categories[0]).toMatchObject({availableCents:0,creditOverspentCents:4000});expect(after.cardReserves[0].reservedCents).toBe(6000);expect(after.readyToAssignCents).toBe(94000);
});
test('cash overspend persists across months, and cannot finance new allocations',()=>{
 const es=[ev('p',{kind:'purchase',accountId:1,categoryId:1,amountCents:120000})];
 expect(project(es).categories[0].availableCents).toBe(-120000);
 expect(()=>project([...es,ev('a',{kind:'assign',categoryId:2,amountCents:1},'2026-12-01')])).toThrow('insufficient');
});
test('card refund releases reserved money; unfunded refund reduces shortfall first',()=>{
 const v=project([assignment,ev('p',{kind:'purchase',accountId:2,categoryId:1,amountCents:40000}),ev('r',{kind:'refund',accountId:2,categoryId:1,amountCents:20000})]);
 expect(v.categories[0]).toMatchObject({availableCents:10000,creditOverspentCents:0});expect(v.cardReserves[0].reservedCents).toBe(20000);expect(v.netExpenseCents).toBe(20000);
});
test('refund after paid-off purchase creates a real card credit, not phantom bank cash',()=>{
 const as=accounts.map(a=>a.id===2?{...a,balanceCents:0}:a);
 const v=project([assignment,ev('p',{kind:'purchase',accountId:2,categoryId:1,amountCents:10000}),ev('x',{kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:10000}),ev('r',{kind:'refund',accountId:2,categoryId:1,amountCents:10000}),ev('p2',{kind:'purchase',accountId:2,categoryId:1,amountCents:4000})],as);
 expect(v.cashCents).toBe(96000);expect(v.categories[0].availableCents).toBe(26000);expect(v.cardReserves[0].reservedCents).toBe(0);expect(v.accounts.find(a=>a.id===2)?.balanceCents).toBe(6000);
});
test('reserve for pre-existing debt and overpayment do not invent expense or cash',()=>{
 const v=project([ev('r',{kind:'reserve',accountId:2,amountCents:20000}),ev('p',{kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:25000})]);
 expect(v).toMatchObject({cashCents:80000,readyToAssignCents:80000,netExpenseCents:0});expect(v.cardReserves[0].reservedCents).toBe(0);
});
test('cash internal transfer is neutral; tracking crossing requires category',()=>{
 const as=[...accounts,{id:4,scope:'cash' as const,balanceCents:0}];
 expect(project([ev('t',{kind:'transfer',fromAccountId:1,toAccountId:4,amountCents:10000})],as).cashCents).toBe(100000);
 expect(()=>project([ev('t',{kind:'transfer',fromAccountId:1,toAccountId:3,amountCents:10000})])).toThrow('category');
 const v=project([assignment,ev('t',{kind:'transfer',fromAccountId:1,toAccountId:3,categoryId:1,amountCents:10000})]);expect(v.cashCents).toBe(90000);expect(v.categories[0].availableCents).toBe(20000);expect(v.netExpenseCents).toBe(0);
});
test('unknown identities, duplicate sources, unsafe money, future events and unfunded move',()=>{
 expect(()=>project([assignment,assignment])).toThrow('duplicate');
 expect(()=>project([ev('a',{kind:'assign',categoryId:99,amountCents:1})])).toThrow('unknown');
 expect(()=>project([ev('a',{kind:'assign',categoryId:1,amountCents:100001})])).toThrow('insufficient');
 expect(()=>project([ev('a',{kind:'assign',categoryId:1,amountCents:0.5})])).toThrow('unsafe');
 expect(()=>project([ev('m',{kind:'move',fromCategoryId:1,toCategoryId:2,amountCents:1})])).toThrow('insufficient');
 expect(project([ev('i',{kind:'income',accountId:1,amountCents:1000},'2027-01-01')]).cashCents).toBe(100000);
});
test('income reversals reduce actual cash rather than count as spending',()=>{
 const v=project([ev('i',{kind:'income',accountId:1,amountCents:-5000})]);expect(v.cashCents).toBe(95000);expect(v.readyToAssignCents).toBe(95000);expect(v.netExpenseCents).toBe(0);
});
test('signed unclassified cash and credit movement changes balances without income or spending meaning',()=>{
 const cases=[
  {accountId:1,amountCents:-5000,balance:95000,cash:95000,rta:95000},
  {accountId:1,amountCents:5000,balance:105000,cash:105000,rta:105000},
  {accountId:2,amountCents:-5000,balance:-25000,cash:100000,rta:100000},
  {accountId:2,amountCents:5000,balance:-15000,cash:100000,rta:100000}
 ];
 for(const row of cases){const v=project([ev('u',{kind:'unclassified',accountId:row.accountId,amountCents:row.amountCents})]);expect(v.accounts.find(a=>a.id===row.accountId)?.balanceCents).toBe(row.balance);expect(v).toMatchObject({cashCents:row.cash,readyToAssignCents:row.rta,netExpenseCents:0,unclassifiedCount:1});expect(v.categories.every(c=>c.activityCents===0)).toBe(true);}
 expect(()=>project([ev('z',{kind:'unclassified',accountId:1,amountCents:0})])).toThrow('nonzero');
});
test('retrospective source correction reveals overassignment instead of rejecting reality',()=>{
 const v=projectLedger(accounts,[1],[ev('i',{kind:'income',accountId:1,amountCents:-90000}),assignment],'2026-11-30',{validateAllocationIds:[]});
 expect(v.readyToAssignCents).toBe(-20000);expect(v.cashCents).toBe(10000);
});
test('cash spent elsewhere cannot leave a reserve falsely certified cash-backed',()=>{
 const v=project([ev('a',{kind:'assign',categoryId:1,amountCents:100000}),ev('p',{kind:'purchase',accountId:2,categoryId:1,amountCents:100000}),ev('cash',{kind:'purchase',accountId:1,categoryId:2,amountCents:100000})]);
 expect(v.cashCents).toBe(0);expect(v.cashBackingShortfallCents).toBe(100000);expect(v.cardReserves[0].cashBackedReserveCents).toBeNull();
});
test('credit balance transfer moves payment reserves without adding expense or cash',()=>{
 const as=[...accounts,{id:4,scope:'credit' as const,balanceCents:0}];
 const v=project([ev('r',{kind:'reserve',accountId:2,amountCents:15000}),ev('t',{kind:'transfer',fromAccountId:4,toAccountId:2,amountCents:20000})],as);
 expect(v.cashCents).toBe(100000);expect(v.netExpenseCents).toBe(0);expect(v.cardReserves.find(c=>c.accountId===2)?.reservedCents).toBe(0);expect(v.cardReserves.find(c=>c.accountId===4)?.reservedCents).toBe(15000);expect(v.readyToAssignCents).toBe(85000);
});
test('tracking payment releases the card reserve and credit-to-tracking requires category',()=>{
 const v=project([ev('r',{kind:'reserve',accountId:2,amountCents:20000}),ev('t',{kind:'transfer',fromAccountId:3,toAccountId:2,amountCents:20000})]);expect(v.readyToAssignCents).toBe(100000);expect(v.cardReserves[0].reservedCents).toBe(0);expect(v.netExpenseCents).toBe(0);
 const b=project([assignment,ev('t',{kind:'transfer',fromAccountId:2,toAccountId:3,categoryId:1,amountCents:10000})]);expect(b.categories[0].availableCents).toBe(20000);expect(b.cardReserves[0].reservedCents).toBe(10000);expect(b.netExpenseCents).toBe(0);
});
