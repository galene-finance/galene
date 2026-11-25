import {test,expect} from 'bun:test';
import {evaluateTarget,costToBeMe} from './targets';
import type {Target} from './types';
const target:Target={id:'t',categoryId:1,amountCents:10000,cadence:'monthly',behavior:'refill',startDate:'2026-01-01'};
const progress={cycleAssignedCents:3000,monthAssignedCents:3000,cycleStartAvailableCents:2000,availableCents:1000};
test('refill counts carryover plus assignments, not current post-spend balance',()=>{
 expect(evaluateTarget(target,'2026-11',progress)).toMatchObject({goalCents:10000,plannedCents:8000,remainingCents:5000,neededThisMonthCents:5000});
});
test('set-aside ignores carryover and balance target responds to spending',()=>{
 expect(evaluateTarget({...target,behavior:'set_aside'},'2026-11',progress).neededThisMonthCents).toBe(7000);
 expect(evaluateTarget({...target,behavior:'balance'},'2026-11',progress).neededThisMonthCents).toBe(9000);
});
test('weekly counts actual weekday occurrences, including leap February',()=>{
 expect(evaluateTarget({...target,cadence:'weekly',weekday:1},'2026-11',progress).goalCents).toBe(50000);
 expect(evaluateTarget({...target,cadence:'weekly',weekday:4},'2024-02',progress).goalCents).toBe(0);
 expect(evaluateTarget({...target,startDate:'2024-01-01',cadence:'weekly',weekday:4},'2024-02',progress).goalCents).toBe(50000);
});
test('annual and irregular distribute through due month then reset without day drift',()=>{
 const t:Target={...target,behavior:'set_aside',cadence:'annual',startDate:'2024-01-01',dueDate:'2024-02-29',amountCents:12000};
 const p={cycleAssignedCents:0,monthAssignedCents:0,cycleStartAvailableCents:0,availableCents:0};
 expect(evaluateTarget(t,'2024-01',p).neededThisMonthCents).toBe(6000);
 expect(evaluateTarget(t,'2024-03',p)).toMatchObject({dueDate:'2025-02-28',cycleStart:'2024-03-01',neededThisMonthCents:1000});
 expect(evaluateTarget(t,'2028-02',p).dueDate).toBe('2028-02-29');
 expect(evaluateTarget({...t,cadence:'irregular'},'2024-03',p).active).toBe(false);
 expect(evaluateTarget({...t,cadence:'irregular',repeatMonths:6},'2024-03',p).dueDate).toBe('2024-08-29');
});
test('cost keeps target/schedule dedupe and flags missing obligation coverage',()=>{
 const result=costToBeMe([target],'2026-11',new Map([[1,progress]]),[{id:'s1',categoryId:1,amountCents:8000},{id:'s2',categoryId:2,amountCents:500}]);
 expect(result.totalCents).toBe(8000); expect(result.coveredObligationIds).toEqual(['s1']); expect(result.uncoveredObligationIds).toEqual(['s2']);
 expect(()=>costToBeMe([target,{...target,id:'t2'}],'2026-11',new Map(),[])).toThrow('duplicate');
});
test('invalid dates, unsafe cents, malformed targets fail closed',()=>{
 for(const t of [{...target,startDate:'2026-02-30'},{...target,amountCents:1.5},{...target,cadence:'annual'},{...target,cadence:'weekly',weekday:8}]) expect(()=>evaluateTarget(t as Target,'2026-11',progress)).toThrow();
 expect(()=>evaluateTarget(target,'2026-13',progress)).toThrow();
});
test('an empty target plan is unknown, not a zero cost of living',()=>{expect(costToBeMe([],'2026-11',new Map(),[]).totalCents).toBeNull();});
