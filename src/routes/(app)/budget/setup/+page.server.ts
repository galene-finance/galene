import {error,fail} from '@sveltejs/kit';
import {db} from '$lib/server/db';
import {productOwner} from '$lib/server/productAccess';
import {baselineClosedDate,baselineSetupModel,baselineSetupAction} from '$lib/server/baselineSetupFeature';
export function load({locals,url}){
 const owner=productOwner(locals.user);if(locals.viewer||locals.apiToken)error(403,'Use the owner app session.');
 const context=locals.financeEvidence?.ownerId===owner?locals.financeEvidence:null;
 // UTC is display-only when unconfigured: actions require the approved server context.
 const clock={now:new Date().toISOString(),timeZone:context?.timeZone??'UTC'};
 const date=url.searchParams.get('baseline_date')??baselineClosedDate(clock);
 try{return {setup:baselineSetupModel(db(),owner,date,context?.closingCatalog??null,clock),commandKey:crypto.randomUUID(),sourceConfigured:context!==null};}
 catch{error(400,'Choose a valid completed-day date and accounting timezone.');}
}
export const actions={baselineSetup:async({locals,request,url})=>{
 const owner=productOwner(locals.user);
 if(locals.viewer||locals.apiToken||process.env.GALENE_DEMO==='1')return fail(403,{feature:'baselineSetup' as const,ok:false as const,status:403,error:'Use the owner app session.'});
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin)return fail(403,{feature:'baselineSetup' as const,ok:false as const,status:403,error:'Submit from this app.'});
 const context=locals.financeEvidence?.ownerId===owner?locals.financeEvidence:null;
 if(!context)return fail(409,{feature:'baselineSetup' as const,ok:false as const,status:409,error:'Approved accounting timezone and closing-evidence source have not been connected. No baseline was saved.'});
 const result=await baselineSetupAction({database:db(),catalog:context.closingCatalog,clock:{now:new Date().toISOString(),timeZone:context.timeZone},locals,request,url});
 return result.ok?result:fail(result.status,result);
}};
