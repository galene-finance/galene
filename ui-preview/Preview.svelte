<script lang="ts">
 import {onMount} from 'svelte';
 import Calendar from '../src/routes/(app)/calendar/+page.svelte';
 import Settings from '../src/routes/(app)/settings/+page.svelte';
 import Appearance from '../src/routes/(app)/settings/appearance/+page.svelte';
 import Overview from '../src/routes/(app)/+page.svelte';
 import Reflect from '../src/routes/(app)/reflect/+page.svelte';
 import Accounts from '../src/routes/(app)/accounts/+page.svelte';
 import Account from '../src/routes/(app)/accounts/[id]/+page.svelte';
 import Transaction from '../src/routes/(app)/transactions/[id]/+page.svelte';
 import Activity from '../src/routes/(app)/transactions/+page.svelte';
 import Category from '../src/routes/(app)/categories/[id]/+page.svelte';
 import Insights from '../src/lib/components/ProductInsights.svelte';
 import Budget from '../src/routes/(app)/budget/+page.svelte';
 import Scheduled from '../src/routes/(app)/scheduled/+page.svelte';
 import Cashflow from '../src/routes/(app)/cashflow/+page.svelte';
 import ProductNav from '../src/lib/components/ProductNav.svelte';
 import {DEFAULT_THEMES,themeToCss,applyThemeNow} from '../src/lib/themes';
 import {fixture,insight,category,accounts,categories,transactions,scheduled,budgets} from './product-fixtures';
 import native from './native-fixture.json';
 import '../src/lib/product.css';
 const url=new URL(location.href),path=url.pathname,base=fixture(url),id=Number(path.split('/').at(-1));
 const integrated=url.searchParams.has('integration');
 let budgetData=$state<any>(null),budgetForm=$state<any>(undefined),budgetError=$state(''),budgetBusy=$state(false);
 async function budgetRequest(action?:string,body?:FormData){
  budgetBusy=true;budgetError='';
  try{const response=await fetch(path==='/reflect'?`/__qa/reflect${url.search}`:path==='/'?`/__qa/home${url.search}`:path.startsWith('/categories/')?`/__qa/category${url.search}`:`/__qa/budget?month=${url.searchParams.get('month')??'2024-01'}${action?'&action='+action:''}`,action?{method:'POST',body}:undefined);const reply=await response.json();if(!response.ok||!reply.fixture||!reply.data)throw new Error('Fixture request failed');budgetData=reply.data;budgetForm=reply.form;return reply.form?.ok===true;}
  catch{budgetError='Synthetic fixture request failed; do not treat this as a successful save.';}
  finally{budgetBusy=false;}
 }
 onMount(()=>{if(!integrated)return;void budgetRequest();const submit=(event:SubmitEvent)=>{const form=event.target;if(!(form instanceof HTMLFormElement))return;const action=form.dataset.budgetCommand??(form.dataset.featureForm==='move'?'moveMoney':form.dataset.featureForm==='reserve'?'cardReserve':null);if(!action)return;event.preventDefault();if(!budgetBusy)void budgetRequest(action,new FormData(form)).then(ok=>{if(ok)form.reset();});};const link=(event:MouseEvent)=>{const a=(event.target as Element)?.closest('a');if(!a)return;const target=new URL(a.href,location.href);if(target.origin===location.origin&&(target.pathname==='/budget'||target.pathname==='/reflect'||target.pathname.startsWith('/categories/'))){target.searchParams.set('integration','1');target.searchParams.set('theme',themeSlug);a.href=target.href;}};document.addEventListener('click',link,true);document.addEventListener('submit',submit,true);return()=>{document.removeEventListener('submit',submit,true);document.removeEventListener('click',link,true);};});
 let open=$state(false);let themeSlug=$state(url.searchParams.get('theme')??'graphite');
 const theme=$derived(DEFAULT_THEMES.find(t=>t.slug===themeSlug)??DEFAULT_THEMES.find(t=>t.slug==='graphite')!);
 $effect(()=>applyThemeNow(theme));
 const q=url.searchParams.get('q')??'',status=url.searchParams.get('status')??'all',sort=url.searchParams.get('sort')??'newest';
 const items=transactions.filter(t=>(t.merchant??'').toLowerCase().includes(q.toLowerCase())).filter(t=>status==='all'||(status==='posted'?!t.pending:t.pending)).toSorted((a,b)=>sort==='oldest'?a.date.localeCompare(b.date):sort==='amount'?Math.abs(b.amount_cents)-Math.abs(a.amount_cents):b.date.localeCompare(a.date));
 const register:any={data:{items,total:items.length,pages:1},filters:{accountIds:[],categoryIds:[],tagIds:[],emptyFields:[],amountOp:'',amountFrom:null,amountTo:null,dateFrom:'',dateTo:'',q,page:1,pageSize:50,status,sort},accounts,categories,tags:[]};
 const cashflow:any={from:'2026-11-01',to:'2026-11-30',currentMonth:'2026-11',monthList:['2026-11'],monthLabels:["NOV '26"],accounts,categories,filters:{accountIds:[],categoryIds:[]},filtersActive:false,...native.cashflow,transactions:[...native.transactions.filter(t=>!t.pending&&categories.find(c=>c.id===t.category_id)?.type!=='transfer'&&t.category_id!==null),...(url.searchParams.has('invalid_split')?[{...native.transactions.find(t=>t.category_id===2)!,id:9999,amount_cents:-10000,splits:[{category_id:2,amount_cents:9000}]}]:[])],occurrences:native.plannedDrill.map(o=>({...o,accountId:scheduled.find(s=>s.id===o.id)?.account_id??null}))};
</script>
<svelte:head>{@html `<style>${themeToCss(theme)}</style>`}</svelte:head>
<div class="preview-banner"><strong>{integrated?'SYNTHETIC OWNER CONTEXT — EDITS ONLY TEMPORARY TEST DATABASE':'SYNTHETIC COMPONENT PREVIEW — NO LIVE ACCOUNTS; SAVES DISABLED'}</strong><select aria-label="Preview theme" bind:value={themeSlug}><option value="graphite">Graphite</option><option value="ocean">Ocean</option><option value="dark">Dark</option></select></div>
<div class="galene-shell" style:padding-top="32px"><ProductNav bind:open user={{id:1,name:'Sample owner',email:'sample@example.invalid',is_admin:1}} branding={{name:'Galene',icon:'emblem'}} themes={DEFAULT_THEMES} selectedTheme={theme.slug}/>
<main id="main-content" class="product-main" inert={open||undefined}>
 {#if path==='/'}{#if integrated}{#if budgetData}<Overview data={budgetData}/>{:else}<p role={budgetError?'alert':'status'}>{budgetError||'Loading fixture overview…'}</p>{/if}{:else}<Overview data={base as any}/>{/if}
 {:else if path==='/settings'}<Settings data={{isAdmin:!url.searchParams.has('nonadmin'),demo:url.searchParams.has('demo')}}/>
 {:else if path==='/settings/appearance'}<Appearance form={undefined} data={{themes:[],selected:themeSlug,appName:'Galene',icon:'emblem',favicon:'emblem',weekStartsOn:'monday',canPublishTheme:false}}/>
 {:else if path==='/reflect'}{#if integrated}{#if budgetData}<Reflect data={budgetData}/>{:else}<p role={budgetError?'alert':'status'}>{budgetError||'Loading fixture history…'}</p>{/if}{:else}<Reflect data={{...base,view:url.searchParams.get('view')==='trends'?'trends':'summary'} as any}/>{/if}
 {:else if path==='/accounts'}<Accounts data={{accounts} as any}/>
 {:else if path.startsWith('/accounts/')}<Account data={{...base,account:accounts.find(a=>a.id===id),transactions:transactions.filter(t=>t.account_id===id)} as any}/>
 {:else if path==='/transactions'}<Activity data={register}/>
 {:else if path.startsWith('/transactions/')}<Transaction data={{transaction:id===9?{...transactions[1],id:9,amount_cents:url.searchParams.has('invalid_split')?-9999:-10000,splits:[{category_id:2,category_name:'Sample groceries',amount_cents:6000},{category_id:3,category_name:'Sample card payment',amount_cents:4000}]}:transactions.find(t=>t.id===id),accounts,categories,tags:[]} as any}/>
 {:else if path.startsWith('/categories/')}{#if integrated}{#if budgetData}<Category data={budgetData}/>{:else}<p role={budgetError?'alert':'status'}>{budgetError||'Loading fixture category…'}</p>{/if}{:else}<Category data={category(url,id) as any}/>{/if}
 {:else if path==='/spending'||path==='/income'}<Insights data={insight(url,path==='/income'?'income':'expense') as any}/>
 {:else if path==='/budget'}{#if integrated}<aside class="product-panel product-panel-body"><strong>Disposable integration fixture</strong><p>Native Plan actions and real temporary SQLite. This does not test production authentication.</p><div class="product-toolbar"><button class="product-button" disabled={budgetBusy} onclick={()=>budgetRequest('purchase')}>Record fixture purchase</button><button class="product-button" disabled={budgetBusy} onclick={()=>budgetRequest('refund')}>Record fixture refund</button><a class="product-button" href={`/budget?integration=1&month=2024-01&theme=${themeSlug}`}>January fixture</a><a class="product-button" href={`/budget?integration=1&month=2024-02&theme=${themeSlug}`}>February fixture</a></div>{#if budgetError}<p role="alert">{budgetError}</p>{/if}{#if budgetBusy}<p role="status">Loading fixture…</p>{/if}</aside>{#if budgetData}<Budget data={budgetData} form={budgetForm}/>{/if}{:else}<Budget data={{budgets,categories,selectedDate:'2026-11-24'}}/>{/if}
 {:else if path==='/scheduled'}<Scheduled data={{rows:[...scheduled,...(url.searchParams.has('qa')?[{...scheduled[0],id:3,name:'Sample refund',amount_cents:1000,category_id:2},{...scheduled[0],id:4,name:'Sample income reversal',amount_cents:-1000,category_id:1},{...scheduled[0],id:5,name:'Sample transfer',amount_cents:-1000,category_id:3}]:[])].map(s=>({scheduled:s,nextDate:s.start_date})),accounts,categories,tags:[]}}/>
 {:else if path==='/calendar'}<Calendar form={undefined} data={{month:url.searchParams.get('month')??'2026-11',transactions,occurrences:base.upcoming,hideActuals:false,weekStartsOn:'monday',accounts,categories,tags:[]}}/>
 {:else if path==='/cashflow'}<Cashflow data={cashflow}/>
 {:else}<section class="product-panel product-empty"><h1>Outside this component preview</h1><p>This is not the live app. Authenticated acceptance is still required.</p><a class="product-link" href="/">Return to preview overview</a></section>{/if}
</main></div>
<style>
 .preview-banner{position:fixed;inset:0 0 auto;height:32px;z-index:100;background:#fff4c7;color:#493800;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 12px;font-size:10px}.preview-banner button{text-decoration:underline;white-space:nowrap}
 :global(.product-topbar){top:32px}:global(.product-sidebar){top:32px}
 @media(max-width:767px){:global(.product-sidebar){top:98px}.preview-banner strong{font-size:8px}}
</style>
