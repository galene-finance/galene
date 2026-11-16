import {mount} from 'svelte'; import App from './Preview.svelte'; import './preview.css';
// Preview cannot reach real app APIs: writes and reads are synthetic only.
window.fetch=async()=>new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});
mount(App,{target:document.getElementById('app')!});