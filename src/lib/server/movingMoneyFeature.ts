import type {Database} from 'bun:sqlite';
import type {MovingMoneyKind,MovingMoneyModel,MovingMoneyResult} from '../movingMoneyFeatureTypes';
import {BudgetEngine} from './budgetEngine/service';
import {civil,monthStart,monthEnd} from '../budget/validation';
export function movingMoneyModel(database:Database,ownerId:number,month:string,asOfDate:string):MovingMoneyModel{
 return database.transaction(()=>{
  const view=new BudgetEngine(database,ownerId).view(month,asOfDate),known=view.coverageComplete&&view.classificationComplete&&view.ledger!==null;
  const categories=database.query("SELECT id,name FROM categories WHERE user_id=? AND (type!='income' OR is_transfer=1) ORDER BY name,id").all(ownerId) as {id:number;name:string}[];
  const accounts=database.query('SELECT id,name FROM accounts WHERE user_id=? ORDER BY name,id').all(ownerId) as {id:number;name:string}[];
  return {revision:view.revision,month,asOfDate,currency:view.baseline?.currency??'USD',known,reason:known?null:!view.baseline?'Set up your budget balance baseline first.':view.unclassifiedCount?'Categorize posted activity before moving allocations.':'Refresh posted activity and resolve its coverage before moving allocations.',cashCents:known?view.ledger!.cashCents:null,readyToAssignCents:known?view.ledger!.readyToAssignCents:null,assignableCents:known?Math.max(0,view.ledger!.readyToAssignCents-view.ledger!.cashOverspentCents):null,shortfallCents:known?view.ledger!.cashBackingShortfallCents:null,
   categories:categories.map(c=>{const f=view.ledger?.categories.find(f=>f.categoryId===c.id);return {...c,availableCents:known&&f?f.availableCents:null,creditOverspentCents:known&&f?f.creditOverspentCents:null};}),
   cards:(view.baseline?.accounts.filter(a=>a.scope==='credit')??[]).map(a=>{const f=view.ledger?.cardReserves.find(f=>f.accountId===a.id);return {id:a.id,name:accounts.find(x=>x.id===a.id)?.name??'Credit account',reservedCents:known&&f?f.reservedCents:null,cashBackedReserveCents:known&&f?f.cashBackedReserveCents:null,debtCents:known&&f?f.debtCents:null,unfundedCents:known&&f?f.unfundedCents:null};})};
 })();
}
type Context={database:Database;locals:{user?:{id:number;role?:string}|null;viewer?:unknown;apiToken?:unknown};request:Request;url:URL;today:string;demo?:boolean};
/** Explicit injection: no global DB, no credential access, no bank/payment endpoint. */
export async function movingMoneyCommand(kind:MovingMoneyKind,context:Context):Promise<MovingMoneyResult>{
 const reject=(status:number,error:string):MovingMoneyResult=>({feature:kind,ok:false,status,error});
 const {locals,request,url,database}=context;
 if(!locals.user)return reject(401,'Sign in to your owner account.');
 if(locals.user.role==='viewer'||locals.viewer||locals.apiToken||context.demo||process.env.GALENE_DEMO==='1')return reject(403,'This change is available only in the owner app session.');
 if(request.method!=='POST')return reject(405,'Submit this change using the form.');
 if(request.headers.get('origin')!==url.origin)return reject(403,'Submit this form from this app.');
 try{
  civil(context.today);
  const selectedMonth=url.searchParams.get('month')??url.searchParams.get('date')?.slice(0,7)??context.today.slice(0,7);monthStart(selectedMonth);
  const reader=request.body?.getReader();if(!reader)return reject(400,'Complete the form.');const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();return reject(413,'The form is too large.');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const form=await new Request(url,{method:'POST',headers:request.headers,body:bytes}).formData();
  const one=(name:string)=>{if(form.getAll(name).length!==1||typeof form.get(name)!=='string')throw new Error('invalid form');return String(form.get(name));};
  const revision=one('revision'),key=one('key'),date=one('date'),amount=one('amount');
  if(!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))||!key.trim()||key.length>100)throw new Error('invalid command');
  civil(date);if(date>context.today||date.slice(0,7)!==selectedMonth)throw new Error('invalid date');
  if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(amount))throw new Error('invalid amount');
  const [whole,fraction='']=amount.split('.'),integer=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(integer<=0n||integer>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('invalid amount');const cents=Number(integer);
  const id=(name:string)=>{const text=one(name);if(!/^[1-9]\d*$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error('invalid identity');return Number(text);};
  const engine=new BudgetEngine(database,locals.user.id),meta={expectedRevision:Number(revision),idempotencyKey:`money:${kind}:${key}`};
  const event=kind==='move'?{kind:'move' as const,id:`ui-money:move:${key}`,date,fromCategoryId:id('from_category_id'),toCategoryId:id('to_category_id'),amountCents:cents}:{kind:'reserve' as const,id:`ui-money:reserve:${key}`,date,accountId:id('account_id'),amountCents:one('direction')==='add'?cents:one('direction')==='release'?-cents:NaN};
  const receipt=database.transaction(()=>{
   const cutoff=selectedMonth===context.today.slice(0,7)?context.today:monthEnd(selectedMonth);
   if(!movingMoneyModel(database,locals.user!.id,selectedMonth,cutoff).known)throw new Error('stale coverage');
   return engine.allocate(event,meta);
  }).immediate();
  return {feature:kind,ok:true,...receipt,notice:kind==='move'?'Budget allocation moved. Bank balances were not changed.':'Card payment reserve updated. No payment was made.'};
 }catch(cause){const message=cause instanceof Error?cause.message:'';
  if(message.includes('revision'))return reject(409,'Your plan changed. Reload it before trying again.');
  if(message.includes('idempotency'))return reject(409,'This form was already used for a different change. Reload it.');
  if(message.includes('stale'))return reject(409,'Posted activity changed. Refresh coverage before making this change.');
  if(message.includes('insufficient'))return reject(422,'Not enough available allocation, cash, or card debt for this change. Later commitments are protected.');
  return reject(400,'Check the amount, date and selections. No budget change was saved.');
 }
}
