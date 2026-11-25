import {expect,test} from 'bun:test';
import {fixtureBudgetUrl} from './native-navigation';
test('native fixture GET keeps the submitted planning date without requiring a QA query flag',()=>{
 const u=new URL(fixtureBudgetUrl('?date=2024-02-15'),'http://synthetic.invalid');expect(u.pathname).toBe('/__qa/budget');expect(u.searchParams.get('date')).toBe('2024-02-15');expect(u.searchParams.has('month')).toBe(false);
});
test('native fixture mutations retain date scope and replace rather than duplicate an action',()=>{
 const u=new URL(fixtureBudgetUrl('?date=2024-02-15&action=old','reviewTransfers'),'http://synthetic.invalid');expect(u.searchParams.getAll('action')).toEqual(['reviewTransfers']);expect(u.searchParams.get('date')).toBe('2024-02-15');
});
test('only a missing planning scope uses the explicit synthetic January default',()=>{
 expect(new URL(fixtureBudgetUrl(''),'http://synthetic.invalid').searchParams.get('month')).toBe('2024-01');expect(new URL(fixtureBudgetUrl('?month=2024-03'),'http://synthetic.invalid').searchParams.get('month')).toBe('2024-03');
});
