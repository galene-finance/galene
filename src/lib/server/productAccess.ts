import {error,redirect} from '@sveltejs/kit';
import type {User} from '$lib/types';
/** New owner pages must not broaden the existing advisor's account scope. */
export function productOwner(user:User|null|undefined){if(!user)redirect(303,'/login');if(user.role==='viewer')error(403,'This page is available to the account owner.');return user.id;}
export function productId(raw:string){if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))error(404,'Item not found.');return Number(raw);}
