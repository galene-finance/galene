// Synthetic fixture only: render the actual production components, without hydration.
import {plugin} from 'bun';import {readFileSync} from 'node:fs';import {compile} from 'svelte/compiler';import {render} from 'svelte/server';
import {DEFAULT_THEMES,themeToCss} from '../src/lib/themes';
import type {MovingMoneyModel,MovingMoneyResult} from '../src/lib/movingMoneyFeatureTypes';
plugin({name:'move-money-native-fixture',setup(build){build.onLoad({filter:/\.svelte$/},({path})=>({contents:compile(readFileSync(path,'utf8'),{filename:path,generate:'server',css:'injected'}).js.code,loader:'js'}));}});
const {default:Move}=await import('../src/lib/components/MoveMoneyControls.svelte');const {default:Card}=await import('../src/lib/components/CardReserveControls.svelte');
export function nativeMoneyHTML(model:MovingMoneyModel,result?:MovingMoneyResult){
 const props={model,commandKey:crypto.randomUUID(),form:result};
 const move=render(Move,{props:{...props,action:'/__move-native?kind=move'}}),card=render(Card,{props:{...props,action:'/__move-native?kind=reserve'}});
 const tokens=themeToCss(DEFAULT_THEMES.find(t=>t.slug==='graphite')!);
 return `<!doctype html><html lang="en" data-theme="graphite"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic native allocation forms</title><link rel="stylesheet" href="/preview.css?direct"><link rel="stylesheet" href="/@fs/candidate/src/lib/product.css?direct"><style>${tokens}body{background:var(--background);color:var(--foreground)}main{max-width:950px;margin:auto;padding:24px}section{margin:20px 0}</style>${move.head}${card.head}</head><body><main><p>SYNTHETIC · actual server-rendered components · no hydration script</p>${move.body}${card.body}<p>Saved revision ${model.revision}</p></main></body></html>`;
}
