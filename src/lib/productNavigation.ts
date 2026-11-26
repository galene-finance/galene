export const primaryNavigation = [
 {href:'/',name:'Home',icon:'home'},
 {href:'/budget',name:'Plan',icon:'budget'},
 {href:'/transactions',name:'Activity',icon:'activity'},
 {href:'/reflect',name:'Reflect',icon:'spending'},
 {href:'/accounts',name:'Accounts',icon:'accounts'}
] as const;
export function navigationCurrent(href:string,pathname:string):'page'|'true'|undefined{return navigationMatches(href,pathname)?(href===pathname?'page':'true'):undefined;}
export function navigationMatches(href:string,pathname:string):boolean {
 if(href==='/')return pathname==='/';
 if(href==='/reflect'&&['/spending','/income','/categories','/trends'].some(p=>pathname===p||pathname.startsWith(p+'/')))return true;
 return pathname===href||pathname.startsWith(href+'/');
}
