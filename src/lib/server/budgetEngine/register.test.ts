import {test,expect} from 'bun:test';
import {normalizeRegister} from './register';
const row=(id:number,amount_cents:number,category_id:number|null=1,account_id=1)=>({id,account_id,category_id,amount_cents,date:'2026-11-01',pending:false,splits:[]});
const cats=[{id:1,kind:'expense' as const},{id:2,kind:'income' as const},{id:3,kind:'transfer' as const}];
test('register normalization uses direction plus category meaning, splits, and posted state',()=>{
 const r=normalizeRegister([row(1,-1000),row(2,100),row(3,2000,2),{...row(4,-400),pending:true},{...row(5,-1000),splits:[{category_id:1,amount_cents:400},{category_id:1,amount_cents:600}]},row(6,-300,2),row(7,0)],cats,[]);
 expect(r.issues).toEqual([]);expect(r.unclassifiedCount).toBe(0);expect(r.events.map(e=>[e.kind,e.amountCents])).toEqual([['purchase',1000],['refund',100],['income',2000],['purchase',400],['purchase',600],['income',-300]]);
});
test('only explicitly paired transfers become one event; missing pairs never guessed',()=>{
 const rows=[row(1,-1000,3,1),row(2,1000,3,2)];
 expect(normalizeRegister(rows,cats,[]).issues.length).toBe(2);
 const r=normalizeRegister(rows,cats,[{outflowId:1,inflowId:2}]);expect(r.issues).toEqual([]);expect(r.events).toEqual([{id:'tx:transfer:1:2',date:'2026-11-01',kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:1000}]);
 expect(normalizeRegister(rows,cats,[{outflowId:1,inflowId:1}]).issues.length).toBeGreaterThan(0);
});
test('uncategorized posted signs stay unclassified while pending and zero rows stay out',()=>{
 const r=normalizeRegister([row(1,-1000,null,1),row(2,250,null,2),{...row(3,-400,null),pending:true},row(4,0,null)],cats,[]);
 expect(r.issues).toEqual([]);expect(r.unclassifiedCount).toBe(2);expect(r.events).toEqual([
  {id:'tx:1:0',date:'2026-11-01',kind:'unclassified',accountId:1,amountCents:-1000},
  {id:'tx:2:0',date:'2026-11-01',kind:'unclassified',accountId:2,amountCents:250}
 ]);
});
test('malformed splits, unknown nonnull categories and duplicate identities block complete projection',()=>{
 expect(normalizeRegister([{...row(1,-1000),splits:[{category_id:1,amount_cents:500}]}],cats,[]).issues[0].reason).toBe('invalid_split');
 expect(normalizeRegister([row(1,-1000,99)],cats,[]).issues[0].reason).toBe('unknown_category');
 expect(normalizeRegister([{...row(1,-1000),splits:[{category_id:99,amount_cents:1000}]}],cats,[]).issues[0].reason).toBe('unknown_category');
 expect(()=>normalizeRegister([row(1,-1000),row(1,-1000)],cats,[])).toThrow('duplicate');
});
