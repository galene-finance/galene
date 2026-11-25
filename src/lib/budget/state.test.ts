import {test,expect} from 'bun:test';
import {categoryFundingState} from './state';
const funds={categoryId:1,availableCents:0,assignedCents:10000,activityCents:-10000,creditOverspentCents:0};
const target={targetId:'t',categoryId:1,month:'2026-11',cycleStart:'2026-11-01',dueDate:'2026-11-30',goalCents:10000,plannedCents:10000,remainingCents:0,neededThisMonthCents:0,active:true};
test('met target and spendable cash are independent authoritative states',()=>{
 expect(categoryFundingState(funds,target,true)).toMatchObject({targetStatus:'met',cashStatus:'empty',availableCents:0});
 expect(categoryFundingState({...funds,availableCents:3000},target,true)).toMatchObject({targetStatus:'met',cashStatus:'available',availableCents:3000});
});
test('unknown, cash/credit overspending, no target and underfunding are distinct',()=>{
 expect(categoryFundingState(funds,target,false)).toMatchObject({targetStatus:'unknown',cashStatus:'unknown',availableCents:null});
 expect(categoryFundingState({...funds,availableCents:-1},target,true).cashStatus).toBe('cash_overspent');
 expect(categoryFundingState({...funds,creditOverspentCents:1},target,true).cashStatus).toBe('credit_overspent');
 expect(categoryFundingState(funds,null,true).targetStatus).toBe('no_target');
 expect(categoryFundingState(funds,{...target,neededThisMonthCents:1},true).targetStatus).toBe('needs_funding');
});
test('a global cash shortfall does not paint positive allocations as funded cash',()=>{expect(categoryFundingState({...funds,availableCents:1000},target,true,500)).toMatchObject({targetStatus:'met',cashStatus:'unbacked',availableCents:null});});
