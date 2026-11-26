import {expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
test('plan grouping retains category parents, separate cadence and income goals',async()=>{
 expect(existsSync(new URL('./planningGroups.ts',import.meta.url))).toBe(true);
 const {planningGroups}=await import('./planningGroups');
 const rows=[{id:1,category_id:1,period:'month'},{id:2,category_id:2,period:'month'},{id:3,category_id:3,period:'month'},{id:4,category_id:1,period:'week'}];
 const cats=[{id:10,name:'Bills',type:'expense',parent_id:null},{id:1,name:'Rent',type:'expense',parent_id:10},{id:2,name:'Utilities',type:'expense',parent_id:10},{id:3,name:'Income',type:'income',parent_id:null}];
 const result=planningGroups(rows,cats);
 expect(result).toHaveLength(3);
 expect(result[0].name).toBe('Bills');
 expect(result[0].items.map(x=>x.id)).toEqual([1,2]);
 expect(result[1].period).toBe('week');
 expect(result[2].name).toBe('Income goals');
 expect(result.flatMap(x=>x.items).map(x=>x.id).sort()).toEqual([1,2,3,4]);
});
