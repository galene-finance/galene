import {error} from '@sveltejs/kit';
import {getProductTransaction,getAccounts,getCategories,getTags} from '$lib/server/finance';
import {productOwner,productId} from '$lib/server/productAccess';
export function load({locals,params}){const user=productOwner(locals.user),transaction=getProductTransaction(user,productId(params.id));if(!transaction)error(404,'Transaction not found.');return {transaction,accounts:getAccounts(user),categories:getCategories(user),tags:getTags(user)};}
