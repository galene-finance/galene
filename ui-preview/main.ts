import {mount} from 'svelte'; import App from './Preview.svelte'; import './preview.css';
// Preview cannot reach real app APIs: writes and reads are synthetic only.
const fixtureFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
 const requested = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
 const path=requested.pathname;
 if((import.meta.env.VITE_NATIVE_BUDGET_QA==='1'||new URL(location.href).searchParams.has('integration'))&&requested.origin===location.origin&&['/__qa/budget','/__qa/category','/__qa/home','/__qa/reflect'].includes(path))return fixtureFetch(input,init);
 const body = path === '/notifications' ? {notifications:[],unread:0} : {ok:true};
 return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
mount(App,{target:document.getElementById('app')!});