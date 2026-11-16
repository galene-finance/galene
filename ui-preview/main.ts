import {mount} from 'svelte'; import App from './Preview.svelte'; import './preview.css';
// Preview cannot reach real app APIs: writes and reads are synthetic only.
window.fetch=async(input)=>{
 const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
 const body = path === '/notifications' ? {notifications:[],unread:0} : {ok:true};
 return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
};
mount(App,{target:document.getElementById('app')!});