import {expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
import type {Transaction,Category} from './types';
const categories=[{id:1,type:'income'},{id:2,type:'expense'},{id:3,type:'transfer'}] as Category[];

test('posted states follow category and sign rather than positive-equals-income',async()=>{
 const {transactionPresentation:p}=await import('./financialPresentation');
 expect(p(tx({category_id:1}),categories)).toEqual({label:'Income',tone:'positive'});
 expect(p(tx({category_id:1,amount_cents:-100}),categories)).toEqual({label:'Income reversal',tone:'negative'});
 expect(p(tx({category_id:2}),categories)).toEqual({label:'Refund',tone:'positive'});
 expect(p(tx({category_id:2,amount_cents:-100}),categories)).toEqual({label:'Spending',tone:'negative'});
 expect(p(tx({category_id:3}),categories)).toEqual({label:'Transfer / payment',tone:'movement'});
});
test('mixed and invalid splits do not inherit a whole-row income label',async()=>{
 const {transactionPresentation:p}=await import('./financialPresentation');
 const split=tx({category_id:1,splits:[{category_id:1,amount_cents:6000},{category_id:3,amount_cents:4000}] as any});
 expect(p({...split,amount_cents:-10000},categories)).toEqual({label:'Split transaction',tone:'negative'});
 expect(p(tx({amount_cents:-10000}),categories)).toEqual({label:'Outflow · needs category',tone:'negative'});
 expect(p(split,categories)).toEqual({label:'Split transaction',tone:'positive'});
 expect(p({...split,amount_cents:9999},categories)).toEqual({label:'Review split',tone:'attention'});
 expect(p({...split,splits:[{category_id:99,amount_cents:10000}] as any},categories)).toEqual({label:'Review split',tone:'attention'});
});
const tx=(extra:Partial<Transaction>={})=>({id:1,category_id:null,amount_cents:10000,pending:false,splits:[],...extra} as Transaction);
test('unclassified credits and pending wages never get an earned-income state',async()=>{
 expect(existsSync(new URL('./financialPresentation.ts',import.meta.url))).toBe(true);
 const {transactionPresentation}=await import('./financialPresentation');
 expect(transactionPresentation(tx(),categories)).toEqual({label:'Inflow · needs category',tone:'positive'});
 expect(transactionPresentation(tx({category_id:1,pending:true}),categories)).toEqual({label:'Pending',tone:'attention'});
});
