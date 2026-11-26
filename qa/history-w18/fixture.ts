import {Database} from 'bun:sqlite';
import {migrate} from '../../src/lib/server/db';
import {BudgetEngine} from '../../src/lib/server/budgetEngine/service';
import type {HistoryEvidenceResolver} from '../../src/lib/server/historyOverviewAdapter';
export const now='2026-11-25T16:00:00.000Z';
export const access={ownerId:1,canRead:true,canCapture:true};
export const accounts=[{id:1,included:true},{id:2,included:true}];
export const labels=[{id:1,name:'Synthetic checking'},{id:2,name:'Synthetic debt'}];
export const resolveEvidence:HistoryEvidenceResolver=(owner,ref)=>owner===1&&ref==='synthetic-debt-25'?{sourceKey:'synthetic-debt-25',accountName:'Synthetic debt',snapshot:{accountId:2,currency:'USD',balanceCents:-130000,source:'accepted_estimate',asOf:'2026-11-25T12:00:00.000Z',recordedAt:now,evidence:'Synthetic accepted debt estimate; statement plus allocated payments. Not a bank-verified balance.'}}:null;
export function fixture(path:string){
 const db=new Database(path);db.exec('PRAGMA foreign_keys=ON');migrate(db);
 if(!db.query('SELECT id FROM users WHERE id=1').get()){
 db.exec("INSERT INTO users(id,name,email,password_hash) VALUES(1,'Synthetic','history@example.test','x'),(2,'Other synthetic','other@example.test','x'); INSERT INTO accounts(id,user_id,name,type) VALUES(1,1,'Synthetic checking','bank'),(2,1,'Synthetic debt','credit'),(3,2,'Other synthetic','bank');");
 const engine=new BudgetEngine(db,1);let revision=0;
 const seed=(accountId:number,date:string,balanceCents:number,source:'actual'|'accepted_estimate'|'reconstructed'='actual')=>{
  engine.recordSnapshot(`seed-${accountId}-${date}`,{accountId,currency:'USD',balanceCents,source,asOf:`${date}T12:00:00.000Z`,recordedAt:now,evidence:'Synthetic fixture evidence only',...(source==='reconstructed'?{coverageFrom:date,coverageTo:date}:{})},{expectedRevision:revision++,idempotencyKey:`seed-${revision}`});
 };
 seed(1,'2026-11-21',100000);seed(2,'2026-11-21',-150000);seed(1,'2026-11-23',110000);seed(2,'2026-11-23',-145000,'reconstructed');seed(1,'2026-11-24',120000);seed(2,'2026-11-24',-140000,'accepted_estimate');seed(1,'2026-11-25',125000);
 }
 return db;
}
