/** Synthetic-only executable UI. No production route/auth claims or live data mounts. */
import {plugin} from 'bun';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';
plugin({name:'history-w18-preview',setup(build){build.onLoad({filter:/(HistoryOverview|HistoryCaptureControls|FinancialBadge)\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const {default:Overview}=await import('../../src/lib/components/HistoryOverview.svelte');const {default:Controls}=await import('../../src/lib/components/HistoryCaptureControls.svelte');
import {DEFAULT_THEMES,themeToCss} from '../../src/lib/themes';
import {BudgetEngine} from '../../src/lib/server/budgetEngine/service';
import {fixture,access,accounts,labels,resolveEvidence,now} from './fixture';
import {captureHistoryOverview,loadHistoryOverview,historyCaptureOffer} from '../../src/lib/server/historyOverviewAdapter';
const data=process.env.HISTORY_SYNTHETIC_DIR;if(!data)throw new Error('Set HISTORY_SYNTHETIC_DIR to a disposable synthetic-only directory.');mkdirSync(data,{recursive:true});
const dbPath=join(data,'history-w18.sqlite');fixture(dbPath).close();
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const css=readFileSync('src/lib/product.css','utf8');
const port=Number(process.env.PORT??4198);
const server=Bun.serve({hostname:process.env.HISTORY_CONTAINER==='1'?'0.0.0.0':'127.0.0.1',port,async fetch(request){
 const url=new URL(request.url);if(url.pathname!=='/')return new Response('Not found',{status:404});
 if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405});
 const db=fixture(dbPath),engine=new BudgetEngine(db,1);
 try{
 const mode=url.searchParams.get('mode')??'',theme=['graphite','ocean','dark'].includes(url.searchParams.get('theme')??'')?url.searchParams.get('theme')!:'graphite';
 const currentAccess={...access,canCapture:mode!=='readonly',canRead:mode!=='denied'};
 if(request.method==='POST'){
  if(request.headers.get('origin')!==url.origin)return new Response('Origin rejected',{status:403});
  if(Number(request.headers.get('content-length')??0)>8192)return new Response('Too large',{status:413});
  try{captureHistoryOverview(engine,currentAccess,await request.formData(),resolveEvidence,now);}
  catch(e){return new Response(e instanceof Error?e.message:'Rejected',{status:400});}
  url.searchParams.set('saved','1');return Response.redirect(url.toString(),303);
 }
 const from=url.searchParams.get('date_from')??'2026-11-21',to=url.searchParams.get('date_to')??'2026-11-25';let points:ReturnType<typeof loadHistoryOverview>=[],error:string|null=null;
 try{points=loadHistoryOverview(engine,currentAccess,accounts,from,to);}catch(e){error=e instanceof Error?e.message:'History unavailable';}
 if(mode==='mixed'&&points[0]?.sources[0])points=points.map((p,i)=>({...p,sources:p.sources.map(s=>({...s,currency:i===0?'EUR':s.currency}))}));
 if(mode==='empty')points=[];
 const overview=render(Overview,{props:{points,accounts:labels,from,to,maxDate:'2026-11-25',queryFields:{theme,mode},action:'/',error}});
 const offer=currentAccess.canCapture&&currentAccess.canRead?[historyCaptureOffer(engine,currentAccess,'synthetic-debt-25',resolveEvidence,now)]:[];
 const controls=render(Controls,{props:{offers:mode==='unsupported'?[]:offer,revision:engine.view('2026-11').revision,commandKey:crypto.randomUUID(),action:`/?theme=${theme}&mode=${mode}`,canCapture:currentAccess.canCapture&&currentAccess.canRead,success:url.searchParams.has('saved')?'Evidence saved and reloaded from the synthetic database.':null}});
 return new Response(`<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic history review</title><style>${themeToCss(DEFAULT_THEMES.find(t=>t.slug===theme)!)}${css}*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:15px system-ui}main{max-width:1000px;margin:auto;padding:20px}h1{font-size:26px}p{line-height:1.5}button,input{font:inherit}a{color:var(--primary)}.fixture-nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:20px}.fixture-nav a{min-height:44px;display:inline-flex;align-items:center}</style>${overview.head}${controls.head}</head><body><main><h1>Net worth history</h1><p>Synthetic evidence only · not your financial records</p><nav class="fixture-nav" aria-label="Review theme">${['graphite','ocean','dark'].map(t=>`<a href="/?theme=${t}">${escape(t)}</a>`).join('')}</nav>${overview.body}${controls.body}</main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 }finally{db.close();}
}});
console.log(`Synthetic history UI listening on ${server.url}; SQLite closed/reopened per request.`);
