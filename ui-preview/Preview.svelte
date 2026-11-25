<script lang="ts">
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
 let open=$state(false);let themeSlug=$state(url.searchParams.get('theme')??'graphite');
 const theme=$derived(DEFAULT_THEMES.find(t=>t.slug===themeSlug)??DEFAULT_THEMES.find(t=>t.slug==='graphite')!);
 $effect(()=>applyThemeNow(theme));
 const q=url.searchParams.get('q')??'',status=url.searchParams.get('status')??'all',sort=url.searchParams.get('sort')??'newest';
 const items=transactions.filter(t=>(t.merchant??'').toLowerCase().includes(q.toLowerCase())).filter(t=>status==='all'||(status==='posted'?!t.pending:t.pending)).toSorted((a,b)=>sort==='oldest'?a.date.localeCompare(b.date):sort==='amount'?Math.abs(b.amount_cents)-Math.abs(a.amount_cents):b.date.localeCompare(a.date));
 const register:any={data:{items,total:items.length,pages:1},filters:{accountIds:[],categoryIds:[],tagIds:[],emptyFields:[],amountOp:'',amountFrom:null,amountTo:null,dateFrom:'',dateTo:'',q,page:1,pageSize:50,status,sort},accounts,categories,tags:[]};
 const cashflow:any={from:'2026-11-01',to:'2026-11-30',currentMonth:'2026-11',monthList:['2026-11'],monthLabels:["NOV '26"],accounts,categories,filters:{accountIds:[],categoryIds:[]},filtersActive:false,...native.cashflow,transactions:[...native.transactions.filter(t=>!t.pending&&categories.find(c=>c.id===t.category_id)?.type!=='transfer'&&t.category_id!==null),...(url.searchParams.has('invalid_split')?[{...native.transactions.find(t=>t.category_id===2)!,id:9999,amount_cents:-10000,splits:[{category_id:2,amount_cents:9000}]}]:[])],occurrences:native.plannedDrill.map(o=>({...o,accountId:scheduled.find(s=>s.id===o.id)?.account_id??null}))};
</script>
<svelte:head>{@html `<style>${themeToCss(theme)}</style>`}</svelte:head>
<div class="preview-banner"><strong>SYNTHETIC COMPONENT PREVIEW — NO LIVE ACCOUNTS; SAVES DISABLED</strong><select aria-label="Preview theme" bind:value={themeSlug}><option value="graphite">Graphite</option><option value="ocean">Ocean</option><option value="dark">Dark</option></select></div>
<div class="galene-shell" style:padding-top="32px"><ProductNav bind:open user={{id:1,name:'Sample owner',email:'sample@example.invalid',is_admin:1}} branding={{name:'Galene',icon:'emblem'}} themes={DEFAULT_THEMES} selectedTheme={theme.slug}/>
<main id="main-content" class="product-main" inert={open||undefined}>
 {#if path==='/'}<Overview data={base as any}/>
 {:else if path==='/settings'}<Settings data={{isAdmin:!url.searchParams.has('nonadmin'),demo:url.searchParams.has('demo')}}/>
 {:else if path==='/settings/appearance'}<Appearance form={undefined} data={{themes:[],selected:themeSlug,appName:'Galene',icon:'emblem',favicon:'emblem',weekStartsOn:'monday',canPublishTheme:false}}/>
 {:else if path==='/reflect'}<Reflect data={{...base,view:url.searchParams.get('view')==='trends'?'trends':'summary'} as any}/>
 {:else if path==='/accounts'}<Accounts data={{accounts} as any}/>
 {:else if path.startsWith('/accounts/')}<Account data={{...base,account:accounts.find(a=>a.id===id),transactions:transactions.filter(t=>t.account_id===id)} as any}/>
 {:else if path==='/transactions'}<Activity data={register}/>
 {:else if path.startsWith('/transactions/')}<Transaction data={{transaction:id===9?{...transactions[1],id:9,amount_cents:url.searchParams.has('invalid_split')?-9999:-10000,splits:[{category_id:2,category_name:'Sample groceries',amount_cents:6000},{category_id:3,category_name:'Sample card payment',amount_cents:4000}]}:transactions.find(t=>t.id===id),accounts,categories,tags:[]} as any}/>
 {:else if path.startsWith('/categories/')}<Category data={category(url,id) as any}/>
 {:else if path==='/spending'||path==='/income'}<Insights data={insight(url,path==='/income'?'income':'expense') as any}/>
 {:else if path==='/budget'}<Budget data={{budgets,categories,selectedDate:'2026-11-24'}}/>
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
