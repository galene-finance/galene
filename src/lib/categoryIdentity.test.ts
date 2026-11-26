import {expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
test('category identity is stable by ID, respects saved hex colors and is independent of amount state',async()=>{
 expect(existsSync(new URL('./categoryIdentity.ts',import.meta.url))).toBe(true);
 const {categoryIdentity:c}=await import('./categoryIdentity');
 const first=c(7,null);expect(c(7,null)).toEqual(first);expect(c(8,null).fill).not.toBe(first.fill);
 expect(c(7,'#abc').fill).toBe('#aabbcc');expect(c(7,'#000000')).toEqual({fill:'#000000',ink:'#ffffff'});
 expect(c(7,'#ffffff')).toEqual({fill:'#ffffff',ink:'#000000'});expect(c(7,'invalid')).toEqual(first);
 expect(c(null,null)).toEqual(c(undefined,undefined));
});
test('category foreground contrast remains readable on every fallback and custom test color',async()=>{
 const {categoryIdentity:c}=await import('./categoryIdentity');
 const lum=(hex:string)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
 for(const fill of [null,'#777777','#e11d48','#d97706','#202020','#000','#fff'])for(let id=1;id<=16;id++){
  const v=c(id,fill),a=lum(v.fill),b=lum(v.ink);expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5);
 }
});
