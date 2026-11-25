import {expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
test('navigation distinguishes the current page from its parent section',async()=>{
 const {navigationCurrent}=await import('./productNavigation');
 expect(navigationCurrent('/reflect','/income')).toBe('true');
 expect(navigationCurrent('/reflect','/reflect')).toBe('page');
 expect(navigationCurrent('/budget','/income')).toBeUndefined();
});
test('five primary destinations resolve and report details stay in Reflect',async()=>{
 expect(existsSync(new URL('./productNavigation.ts',import.meta.url))).toBe(true);
 const {primaryNavigation,navigationMatches}=await import('./productNavigation');
 expect(primaryNavigation.map(x=>x.name)).toEqual(['Home','Plan','Activity','Reflect','Accounts']);
 for(const item of primaryNavigation) expect(existsSync(new URL('../routes/(app)'+(item.href==='/'?'':item.href)+'/+page.svelte',import.meta.url))).toBe(true);
 for(const path of ['/income','/spending','/categories/12','/reflect']) expect(primaryNavigation.filter(x=>navigationMatches(x.href,path)).map(x=>x.href)).toEqual(['/reflect']);
 expect(navigationMatches('/transactions','/transactions/42')).toBe(true);
 expect(navigationMatches('/','/transactions')).toBe(false);
});
