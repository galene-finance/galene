/** Synthetic transport only: preserve native GET scope without leaking QA flags into production forms. */
export function fixtureBudgetUrl(search:string,action?:string){
 const query=new URLSearchParams(search);
 if(!query.has('date')&&!query.has('month'))query.set('month','2024-01');
 if(action)query.set('action',action);
 return `/__qa/budget?${query}`;
}
