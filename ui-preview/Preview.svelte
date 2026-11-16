<script lang="ts">
 import Dashboard from '../src/routes/(app)/+page.svelte';
 import TopNav from '../src/lib/components/TopNav.svelte';
 import {DEFAULT_THEMES,themeToCss} from '../src/lib/themes';
 import {WIDGET_CATALOG_LIST, DEFAULT_LAYOUT, compactLayout} from '../src/lib/dashboard';
 import type {DashboardWidget,DashboardWidgetData} from '../src/lib/types';
 let dark=$state(false);
 const theme=$derived(DEFAULT_THEMES.find(t=>t.slug===(dark?'dark':'light'))!);
 $effect(()=>{document.documentElement.dataset.theme=theme.slug;});
 const layout=location.search.includes('native') ? DEFAULT_LAYOUT.map(w=>({...w,id:w.type})) : compactLayout([
  {id:'month',type:'month',x:0,y:0,w:8,h:3,filters:{}},
  {id:'balances',type:'balances',x:0,y:0,w:4,h:8,filters:{}},
  {id:'trends',type:'trends',x:0,y:0,w:8,h:5,filters:{}},
  {id:'budgets',type:'budgets',x:0,y:0,w:4,h:3,filters:{}},
  {id:'upcoming',type:'upcoming',x:0,y:0,w:4,h:3,filters:{}},
  {id:'recent',type:'recent',x:0,y:0,w:4,h:3,filters:{}},
  {id:'notifications',type:'notifications',x:0,y:0,w:12,h:2,filters:{}}
 ] as DashboardWidget[]);
 const widgets:Record<string,DashboardWidgetData>={
 month:{kind:'month',label:'November 2026',prevLabel:'October',incomeCents:480000,expenseCents:325000,netCents:155000,prevIncomeCents:480000,prevExpenseCents:374000},
 balances:{kind:'balances',items:[
 {id:1,name:'Everyday checking',type:'bank',color:'#086c70',balanceCents:285000,bankCents:320000,bankAsOf:'2026-11-16 12:00:00'},
 {id:2,name:'Rainy day savings',type:'bank',color:'#52647a',balanceCents:800000,bankCents:800000,bankAsOf:'2026-11-16 12:00:00'},
 {id:3,name:'Rewards card',type:'credit',color:'#946000',balanceCents:-85000,bankCents:-82000,bankAsOf:'2026-11-15 12:00:00'},
 {id:4,name:'Vehicle loan',type:'bank',color:'#946000',balanceCents:0,bankCents:-1800000,bankAsOf:'2026-11-15 12:00:00'}],totalCents:1000000},
 trends:{kind:'trends',months:6,points:[{key:'2026-06',label:'Jun',spentCents:304000},{key:'2026-07',label:'Jul',spentCents:352000},{key:'2026-08',label:'Aug',spentCents:289000},{key:'2026-09',label:'Sep',spentCents:412000},{key:'2026-10',label:'Oct',spentCents:374000},{key:'2026-11',label:'Nov',spentCents:325000}]},
 budgets:{kind:'budgets',items:[]},upcoming:{kind:'upcoming',days:[],recurringSuggestionCount:0},
 recent:{kind:'recent',items:[{id:1,account_id:1,category_id:1,date:'2026-11-15',amount_cents:-4825,merchant:'Sample grocery',notes:null,color:null,account_name:'Everyday checking',category_name:'Groceries'}]},
 notifications:{kind:'notifications',items:[],unread:0}
 };
</script>
<svelte:head>{@html `<style>${themeToCss(theme)}</style>`}</svelte:head>
<div class="border-b border-border px-4 py-2 text-xs flex justify-between gap-4"><span>SYNTHETIC PREVIEW · No real accounts or connections</span><button class="underline" onclick={()=>dark=!dark}>Switch {dark?'light':'dark'}</button></div>
<TopNav themes={DEFAULT_THEMES} selectedTheme={theme.slug} user={{id:1,name:'Sample owner',email:'sample@example.test',is_admin:1}} branding={{name:'Galene',icon:'emblem'}} />
<main class="p-4 md:p-6"><Dashboard data={{layout,widgets,catalog:WIDGET_CATALOG_LIST,accounts:[],categories:[],tags:[]}} /></main>
