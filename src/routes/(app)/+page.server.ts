import { error,redirect } from '@sveltejs/kit';
import { productOverview } from '$lib/server/product';
export function load({locals,url,depends}) {
 if(!locals.user)redirect(303,'/login');
 if(locals.user.role==='viewer')redirect(303,'/transactions');
 depends('settings');
 return productOverview(locals.user.id,url);
}
export const actions={default:({url})=>redirect(303,url.pathname+url.search)};
