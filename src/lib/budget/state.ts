import type {CategoryFunds,TargetEvaluation} from './types';
/** Semantic DTO, not a palette. UI maps these independently to accessible labels/icons/colors. */
export function categoryFundingState(funds:CategoryFunds|null,target:TargetEvaluation|null,coverageComplete:boolean,cashBackingShortfallCents=0){
 const known=coverageComplete&&funds!==null;
 const targetStatus: 'unknown'|'no_target'|'met'|'needs_funding'=!target||!target.active?'no_target':!known?'unknown':target.neededThisMonthCents===0?'met':'needs_funding';
 const cashStatus:'unbacked'|'unknown'|'cash_overspent'|'credit_overspent'|'available'|'empty'=!known?'unknown':funds.availableCents<0?'cash_overspent':funds.creditOverspentCents>0?'credit_overspent':cashBackingShortfallCents>0?'unbacked':funds.availableCents>0?'available':'empty';
 return {targetStatus,cashStatus,availableCents:known&&cashStatus!=='unbacked'?funds.availableCents:null,assignedCents:known?funds.assignedCents:null,activityCents:known?funds.activityCents:null,creditOverspentCents:known?funds.creditOverspentCents:null,neededThisMonthCents:known&&target?.active?target.neededThisMonthCents:null};
}
