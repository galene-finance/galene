import {productActivity,productHistory} from '$lib/server/product';
import {productOwner} from '$lib/server/productAccess';
export function load({locals,url}) {
 const userId=productOwner(locals.user);
 const data=productActivity(userId,url);
 return {...data,history:productHistory(userId,data),view:url.searchParams.get('view')==='trends'?'trends':'summary'};
}
