import { describe, expect, test } from 'bun:test';
import { summarizeActivity, scheduleKind } from './activity';
import type { Category, Transaction } from './types';
const categories: Category[] = [
 {id:1,name:'Pay',type:'income',parent_id:null,color:null},
 {id:2,name:'Food',type:'expense',parent_id:null,color:null},
 {id:3,name:'Card payment',type:'transfer',parent_id:null,color:null}
];
const txn=(id:number,amount:number,category:number|null,extra:Partial<Transaction>={}):Transaction=>({id,account_id:1,category_id:category,date:'2026-01-12',amount_cents:amount,merchant:'Test',notes:null,color:null,...extra});
describe('posted financial activity',()=>{
 test('refund reduces spending; reversal reduces earned income',()=>{
  const s=summarizeActivity([txn(1,100000,1),txn(2,-10000,1),txn(3,-20000,2),txn(4,5000,2)],categories);
  expect([s.incomeCents,s.spendingCents,s.netCents]).toEqual([90000,15000,75000]);
 });
 test('card payments are movements; unknown credits are not earnings',()=>{
  const s=summarizeActivity([txn(1,40000,3),txn(2,-40000,3),txn(3,12000,null),txn(4,-8000,null)],categories);
  expect([s.incomeCents,s.spendingCents,s.transferCount,s.uncategorizedCount]).toEqual([0,0,2,2]);
  expect([s.uncategorizedInCents,s.uncategorizedOutCents]).toEqual([12000,8000]);
 });
 test('pending excluded by default and explicit inclusion supported',()=>{
  const rows=[txn(1,10000,1,{pending:true}),txn(2,-2000,2)];
  expect(summarizeActivity(rows,categories).incomeCents).toBe(0);
  expect(summarizeActivity(rows,categories).pendingCount).toBe(1);
  expect(summarizeActivity(rows,categories,true).incomeCents).toBe(10000);
 });
 test('splits replace the parent once and follow transaction direction',()=>{
  const rows=[txn(1,-10000,2,{splits:[{category_id:2,category_name:'Food',amount_cents:6000},{category_id:3,category_name:'Transfer',amount_cents:4000}]}),txn(2,2000,2,{splits:[{category_id:2,category_name:'Food',amount_cents:2000}]})];
  const s=summarizeActivity(rows,categories);
  expect(s.spendingCents).toBe(4000);
  expect(s.categories.find(c=>c.id===2)?.cents).toBe(-4000);
 });
 test('inconsistent splits surface for review without partial classification',()=>{
  const s=summarizeActivity([txn(1,-10000,2,{splits:[{category_id:2,category_name:'Food',amount_cents:2000}]})],categories);
  expect(s.spendingCents).toBe(0); expect(s.uncategorizedCount).toBe(1);
 });
 test('balance adjustments affect the ledger without becoming income or spending',()=>{
  const adjustment:Category={id:4,name:'Balance adjustment',type:'expense',parent_id:null,color:null,system_kind:'balance_adjustment'};
  const s=summarizeActivity([
   txn(1,-5000,4),
   txn(2,2000,4),
   txn(3,-1000,2,{splits:[{category_id:4,category_name:'Balance adjustment',amount_cents:400},{category_id:2,category_name:'Food',amount_cents:600}]})
  ],[...categories,adjustment]);
  expect([s.incomeCents,s.spendingCents,s.uncategorizedCount]).toEqual([0,600,0]);
  expect(s.categories.some(c=>c.id===4)).toBe(false);
 });
 test('on-date payroll is income, not a bill; a card payment is a transfer',()=>{
  expect(scheduleKind(10000,'income')).toBe('Income');
  expect(scheduleKind(-2000,'expense')).toBe('Bill');
  expect(scheduleKind(-5000,'transfer')).toBe('Transfer');
  expect(scheduleKind(1000,'expense')).toBe('Refund');
 });
});
