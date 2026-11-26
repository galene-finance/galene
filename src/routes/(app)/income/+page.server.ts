import {productInsights} from '$lib/server/productInsights';
import {productOwner} from '$lib/server/productAccess';
export function load({locals,url}){return productInsights(productOwner(locals.user),url,'income');}
