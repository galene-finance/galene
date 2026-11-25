type PlanningCategory={id:number;name:string;type:string;parent_id?:number|null};
export function planningGroups<T extends {category_id:number;period:string}>(rows:readonly T[],categories:readonly PlanningCategory[]){
 const byId=new Map(categories.map(c=>[c.id,c]));
 const groups=new Map<string,{key:string;name:string;period:string;income:boolean;order:number;items:T[]}>();
 for(const row of rows){
  const category=byId.get(row.category_id),income=category?.type==='income';
  const parent=category?.parent_id?byId.get(category.parent_id):categories.some(c=>c.parent_id===category?.id)?category:undefined;
  const key=`${row.period}:${income?'income':parent?.id??'other'}`;
  const group=groups.get(key)??{key,name:income?'Income goals':parent?.name??'Your categories',period:row.period,income,order:parent?categories.findIndex(c=>c.id===parent.id):categories.length,items:[] as T[]};
  group.items.push(row);groups.set(key,group);
 }
 const order=(p:string)=>['month','week','year'].indexOf(p);
 return [...groups.values()].sort((a,b)=>Number(a.income)-Number(b.income)||order(a.period)-order(b.period)||a.order-b.order);
}
