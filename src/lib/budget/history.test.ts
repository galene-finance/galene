import {test,expect} from 'bun:test';
import {netWorthHistory,reconstructHistory} from './history';
import type {BalanceSnapshot} from './types';
const s=(accountId:number,balanceCents:number,date='2026-11-01',source:BalanceSnapshot['source']='actual'):BalanceSnapshot=>({accountId,currency:'USD',balanceCents,asOf:date+'T23:59:59.999Z',recordedAt:'2026-11-25T12:00:00.000Z',source,evidence:'synthetic statement'});
test('partial net worth is a gap, tracking debt included, estimates remain labeled',()=>{
 const points=netWorthHistory([{id:1,included:true},{id:2,included:true},{id:3,included:false}],[s(1,10000),s(2,-4000,'2026-11-01','accepted_estimate'),s(1,11000,'2026-11-02')],['2026-11-01','2026-11-02','2026-11-03']);
 expect(points[0]).toMatchObject({totalCents:6000,complete:true});expect(points[0].sources[1].source).toBe('accepted_estimate');
 expect(points[1]).toMatchObject({totalCents:null,knownSubtotalCents:11000,missingAccountIds:[2]});expect(points[2].knownSubtotalCents).toBe(0);
});
test('reconstructs only complete covered posted evidence anchored at day end',()=>{
 const anchor=s(1,15000,'2026-11-03');
 const evidence={from:'2026-11-01',to:'2026-11-03',complete:true,reference:'synthetic full register'};
 const tx=[{id:'a',date:'2026-11-02',amountCents:2000},{id:'b',date:'2026-11-03',amountCents:3000}];
 expect(reconstructHistory(anchor,tx,evidence,['2026-10-31','2026-11-01','2026-11-02']).map(x=>x.balanceCents)).toEqual([10000,12000]);
 expect(reconstructHistory(anchor,tx,{...evidence,complete:false},['2026-11-01'])).toEqual([]);
 expect(()=>reconstructHistory({...anchor,asOf:'2026-11-03T12:00:00.000Z'},tx,evidence,['2026-11-01'])).toThrow('day-end');
 expect(()=>reconstructHistory(anchor,[...tx,tx[0]],evidence,['2026-11-01'])).toThrow('duplicate');
});
test('mixed currencies never produce a summed net worth',()=>{
 expect(()=>netWorthHistory([{id:1,included:true},{id:2,included:true}],[{...s(1,100),currency:'USD'},{...s(2,100),currency:'EUR'}],['2026-11-01'])).toThrow('currency');
});
