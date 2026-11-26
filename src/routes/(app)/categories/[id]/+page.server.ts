import {productCategory} from '$lib/server/productInsights';
import {productOwner,productId} from '$lib/server/productAccess';
import {budgetDate,budgetFunding} from '$lib/server/budgetIntegration';
import type {BudgetEngine} from '$lib/server/budgetEngine/service';
export type CategoryFunding={state:ReturnType<BudgetEngine['dashboard']>['categoryStates'][number];month:string;asOfDate:string};
export function load({locals,url,params}){
 const owner=productOwner(locals.user),id=productId(params.id),data=productCategory(owner,url,id);
 let funding:CategoryFunding|null=null;
 if(data.accountId===null&&data.category.type!=='income'){
  const month=url.searchParams.get('funding_month')??data.period.month;
  const date=budgetDate(new URL(`/budget?month=${encodeURIComponent(month)}`,url));
  const read=budgetFunding(owner,date);
  // Never attach an all-account or differently dated balance to a filtered drilldown.
  if(data.period.from===`${month}-01`&&data.period.dateTo===read.fundingDate){
   const state=read.funding.categoryStates.find(c=>c.categoryId===id);
   if(state)funding={state,month,asOfDate:read.fundingDate};
  }
 }
 return {...data,funding};
}
