<script lang="ts">
 import {onMount} from 'svelte';import Move from '$lib/components/MoveMoneyControls.svelte';import Card from '$lib/components/CardReserveControls.svelte';
 import {DEFAULT_THEMES,applyThemeNow} from '$lib/themes';import type {MovingMoneyModel,MovingMoneySubmit} from '$lib/movingMoneyFeatureTypes';
 let model=$state<MovingMoneyModel|null>(null),key=$state(''),error=$state('');
 async function reload(){const r=await fetch('/__moveqa');if(!r.ok)throw new Error('Fixture load failed');const data=await r.json();model=data.model;key=data.commandKey;}
 onMount(()=>{applyThemeNow(DEFAULT_THEMES.find(t=>t.slug==='graphite')!);reload().catch(e=>error=e.message);});
 const submit:MovingMoneySubmit=async(kind,body)=>{const r=await fetch(`/__moveqa?kind=${kind}`,{method:'POST',body});const data=await r.json();model=data.model;key=data.commandKey;return data.result;};
 async function activity(kind:string){const r=await fetch(`/__moveqa?fixture=${kind}`,{method:'POST'});if(!r.ok)throw new Error('Fixture activity failed');await reload();}
</script>
<main class="product-page fixture-page"><header class="product-heading"><div><p class="product-row-caption">SYNTHETIC DATA · FEATURE TEST · NOT A BANK CONNECTION</p><h1>A little room to adjust</h1><p>Move allocations where you need them, and keep card payments covered.</p></div></header>
 <nav class="fixture-tools" aria-label="Synthetic test controls">{#each ['graphite','ocean','dark'] as slug}<button class="product-button" onclick={()=>applyThemeNow(DEFAULT_THEMES.find(t=>t.slug===slug)!)}>{slug}</button>{/each}<button class="product-button" onclick={()=>activity('purchase')}>Synthetic card purchase</button><button class="product-button" onclick={()=>activity('refund')}>Synthetic refund</button><button class="product-button" onclick={()=>activity('payment')}>Synthetic payment</button></nav>
 {#if error}<p role="alert">{error}</p>{/if}{#if model}<Move {model} commandKey={key} {submit}/><Card {model} commandKey={key} {submit}/><output class="product-row-caption" data-testid="saved-revision">Saved revision {model.revision}</output>{:else}<p role="status">Loading synthetic fixture…</p>{/if}
</main>
<style>.fixture-page{max-width:1000px;margin:0 auto;padding:28px 22px}.fixture-tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}.fixture-tools button{min-height:44px}.fixture-page>section{margin-bottom:22px}@media(max-width:560px){.fixture-page{padding:18px 12px}.fixture-tools{gap:6px}}</style>
