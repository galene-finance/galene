import { describe, expect, test } from 'bun:test';
import { DEFAULT_THEMES } from './themes';
import { accountSection, comparisonWidth, bankTimestamp } from './financePresentation';

describe('read-only finance presentation', () => {
 test('loans do not appear among cash even when imported as bank', () => {
  expect(accountSection({type:'bank',name:'Vehicle Loan'})).toBe('debts');
  expect(accountSection({type:'other',name:'Home mortgage'})).toBe('debts');
  expect(accountSection({type:'credit',name:'Card'})).toBe('debts');
 });
 test('other accounts are not silently counted as cash', () => {
  expect(accountSection({type:'investment',name:'Retirement'})).toBe('other');
  expect(accountSection({type:'other',name:'Unclassified'})).toBe('other');
  expect(accountSection({type:'bank',name:'Checking'})).toBe('cash');
 });
 test('comparison bars are zero-based and bounded', () => {
  expect(comparisonWidth(0, 100)).toBe(0);
  expect(comparisonWidth(50, 100)).toBe(50);
  expect(comparisonWidth(-50, 100)).toBe(0);
  expect(comparisonWidth(150, 100)).toBe(100);
  expect(comparisonWidth(0, 0)).toBe(0);
 });
 test('missing or invalid dates do not imply fresh sync', () => {
  expect(bankTimestamp(null)).toBe('As-of time unavailable');
  expect(bankTimestamp('invalid')).toBe('As-of time unavailable');
  expect(bankTimestamp('2026-01-01 12:00:00')).not.toBe('As-of time unavailable');
 });
});

function luminance(hex:string):number {
 const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
}
for (const theme of DEFAULT_THEMES.filter(t=>['light','dark'].includes(t.slug))) {
 test(`${theme.slug}: text and semantic palette reach AA on surfaces`,()=>{
  const c=theme.colors;
  for(const foreground of [c.foreground,c.mutedForeground,c.primary,c.success,c.destructive,c.warning]) {
   for(const background of [c.surface,c.background]) {
    const a=luminance(foreground),b=luminance(background);
    expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5);
   }
  }
  const a=luminance(c.primaryForeground),b=luminance(c.primary);
  expect((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toBeGreaterThanOrEqual(4.5);
 });
}
