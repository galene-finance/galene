export async function invalidateAll() {}
export function afterNavigate(fn:()=>void){queueMicrotask(fn);}
export async function goto(url:string|URL){location.href=String(url);}
