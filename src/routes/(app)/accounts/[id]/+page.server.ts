import {error} from '@sveltejs/kit';
import {productActivity} from '$lib/server/product';import {productOwner,productId} from '$lib/server/productAccess';
export function load({locals,params,url}){
 const user=productOwner(locals.user),id=productId(params.id),scoped=new URL(url);scoped.searchParams.set('account',String(id));
 const data=productActivity(user,scoped);const account=data.accounts.find(a=>a.id===id);if(!account)error(404,'Account not found.');
 return {...data,account};
}
