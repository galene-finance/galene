import {productCategory} from '$lib/server/productInsights';
import {productOwner,productId} from '$lib/server/productAccess';
export function load({locals,url,params}){return productCategory(productOwner(locals.user),url,productId(params.id));}
