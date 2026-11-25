import {test,expect} from 'bun:test';
import {normalizeRegister} from './register';
const row=(id:number,amount_cents:number,category_id:number|null=1,account_id=1)=>({id,account_id,category_id,amount_cents,date:'2026-11-01',pending:false,splits:[]});
const cats=[{id:1,kind:'expense' as const},{id:2,kind:'income' as const},{id:3,kind:'transfer' as const}];
test('register normalization uses real posted signs, splits and excludes pending',()=>{
 const r=normalizeRegister([row(1,-1000),row(2,100),row(3,2000,2),{...row(4,-400),pending:true},{...row(5,-1000),splits:[{category_id:1,amount_cents:400},{category_id:1,amount_cents:600}]}],cats,[]);
 expect(r.issues).toEqual([]);expect(r.events.map(e=>[e.kind,e.amountCents])).toEqual([['purchase',1000],['refund',100],['income',2000],['purchase',400],['purchase',600]]);
});
test('only explicitly paired transfers become one event; missing pairs never guessed',()=>{
 const rows=[row(1,-1000,3,1),row(2,1000,3,2)];
 expect(normalizeRegister(rows,cats,[]).issues.length).toBe(2);
 const r=normalizeRegister(rows,cats,[{outflowId:1,inflowId:2}]);expect(r.issues).toEqual([]);expect(r.events).toEqual([{id:'tx:transfer:1:2',date:'2026-11-01',kind:'transfer',fromAccountId:1,toAccountId:2,amountCents:1000}]);
 expect(normalizeRegister(rows,cats,[{outflowId:1,inflowId:1}]).issues.length).toBeGreaterThan(0);
});
test('malformed splits, unknown categories and duplicate identities block complete projection',()=>{
 expect(normalizeRegister([{...row(1,-1000),splits:[{category_id:1,amount_cents:500}]}],cats,[]).issues[0].reason).toBe('invalid_split');
 expect(normalizeRegister([row(1,-1000,null)],cats,[]).issues[0].reason).toBe('uncategorized');
 expect(()=>normalizeRegister([row(1,-1000),row(1,-1000)],cats,[])).toThrow('duplicate');
});
