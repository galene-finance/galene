import {productAccounts} from '$lib/server/product';
import {productOwner} from '$lib/server/productAccess';
export function load({locals}){return {accounts:productAccounts(productOwner(locals.user))};}
