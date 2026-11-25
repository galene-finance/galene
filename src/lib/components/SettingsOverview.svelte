<script lang="ts">
 import {filterSettingsSections,settingsSections} from '$lib/settingsHub';
 import Badge from './FinancialBadge.svelte';
 let {data,query=$bindable('')}:{data:{isAdmin:boolean;demo?:boolean};query?:string}=$props();
 const sections=$derived(filterSettingsSections(settingsSections(data.isAdmin,{demo:data.demo}),query));
</script>
<div class="product-page">
 <header class="product-heading"><div><h1>Settings</h1><p>Your preferences, money setup and app controls.</p></div><label class="product-field"><span>Find a setting</span><input type="search" bind:value={query} placeholder="Search settings" autocomplete="off"/></label></header>
 {#if data.demo}<aside class="product-panel product-panel-body" role="status"><Badge label="Demo — read only" tone="attention"/><p>Bank sync, backups, API, advisor, users, SSO, two-factor authentication and data wipe remain read-only. Shared demo data resets on a schedule.</p></aside>{/if}
 {#each sections as section(section.id)}<section class="product-panel"><header class="product-panel-header"><h2>{section.label}</h2></header><ul class="product-list">{#each section.cards as card(card.href)}<li><a class="product-row" href={card.href}><span class="setting-icon" aria-hidden="true">{card.icon}</span><span class="product-row-main setting-main"><strong class="product-row-title">{card.title}</strong><span class="product-row-caption setting-description">{card.desc}</span></span>{#if card.admin}<Badge label="Admin"/>{/if}<span class="product-muted" aria-hidden="true">›</span></a></li>{/each}</ul></section>{:else}<section class="product-panel product-empty"><strong>No matching settings</strong><p>Try a different term, or show all settings.</p><button class="product-button" onclick={()=>query=''}>Clear search</button></section>{/each}
</div>
<style>
 .setting-icon{display:grid;place-items:center;flex:0 0 36px;min-height:36px;border-radius:var(--radius);background:var(--pill-neutral-fill);color:var(--pill-neutral-ink);font-size:15px;font-weight:650}
 .setting-main{flex:1}
 .setting-description{max-width:75ch;white-space:normal;overflow-wrap:anywhere}
</style>
