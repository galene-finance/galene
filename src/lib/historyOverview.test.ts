import {test,expect} from 'bun:test';
import {historyDates,historyPresentation} from './historyOverview';
import {netWorthHistory} from './budget/history';
const snapshot={accountId:1,currency:'USD',asOf:'2026-11-01T12:00:00.000Z',recordedAt:'2026-11-01T12:00:00.000Z',balanceCents:-500,source:'actual' as const,evidence:'synthetic'};
test('civil date ranges reject invalid, reversed and unbounded requests',()=>{
 expect(historyDates('2024-02-28','2024-03-01')).toEqual(['2024-02-28','2024-02-29','2024-03-01']);
 expect(historyDates('2026-03-07','2026-03-09')).toHaveLength(3);
 for(const pair of [['2026-02-30','2026-03-01'],['2026-03-02','2026-03-01'],['2020-01-01','2026-01-01']])expect(()=>historyDates(pair[0],pair[1])).toThrow();
});
test('negative balances and gaps remain distinct; no imputed current value',()=>{
 const points=netWorthHistory([{id:1,included:true}],[snapshot],historyDates('2026-11-01','2026-11-03'));
 const p=historyPresentation(points);
 expect(p.status).toBe('ready');expect(p.currency).toBe('USD');expect(p.plotted).toHaveLength(1);
 expect(p.latest?.totalCents).toBeNull();expect(p.completeDays).toBe(1);expect(p.gapDays).toBe(2);
 expect(p.plotted[0].point.totalCents).toBe(-500);expect(Number.isFinite(p.plotted[0].y)).toBe(true);
});
test('partial coverage never becomes net worth, mixed currency across dates is not compared',()=>{
 const partial=netWorthHistory([{id:1,included:true},{id:2,included:true}],[snapshot],['2026-11-01']);
 expect(historyPresentation(partial).plotted).toEqual([]);expect(partial[0].knownSubtotalCents).toBe(-500);
 const mixed=netWorthHistory([{id:1,included:true}],[snapshot,{...snapshot,currency:'EUR',asOf:'2026-11-02T12:00:00.000Z',recordedAt:'2026-11-02T12:00:00.000Z'}],['2026-11-01','2026-11-02']);
 expect(historyPresentation(mixed).status).toBe('mixed_currency');expect(historyPresentation(mixed).plotted).toEqual([]);
 expect(historyPresentation([]).status).toBe('empty');
});
