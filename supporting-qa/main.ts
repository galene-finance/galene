import {mount} from 'svelte';
import Preview from '../ui-preview/Preview.svelte';
import '../ui-preview/preview.css';
// No live APIs, writes, preference saves or fabricated successful responses.
window.fetch=async(input)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
 if(url.origin===location.origin&&url.pathname==='/notifications')return new Response(JSON.stringify({notifications:[],unread:0}));
 throw new Error('Supporting-screen fixture: network actions disabled');
};
document.addEventListener('submit',event=>{event.preventDefault();},true);
mount(Preview,{target:document.getElementById('app')!});
