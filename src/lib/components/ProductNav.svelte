<script lang="ts">
 import { page } from '$app/state';
 import { afterNavigate } from '$app/navigation';
 import {primaryNavigation,navigationMatches,navigationCurrent} from '$lib/productNavigation';
 import {themePresentationOrder} from '$lib/themes';
 import type { User,Branding,Theme,AppNotification } from '$lib/types';
 import Icon from './ProductIcon.svelte';
 import Utilities from './TopNav.svelte';
 let {user,branding,themes=[],selectedTheme='',themeAction=null,notifications=[],notificationsUnread=0,viewer=false,open=$bindable(false)}:{user:User;branding:Branding;themes?:Theme[];selectedTheme?:string;themeAction?:string|null;notifications?:AppNotification[];notificationsUnread?:number;viewer?:boolean;open?:boolean}= $props();
 const daily=primaryNavigation;
 const tools=[{href:'/recurring',name:'Find recurring',icon:'recurring'},{href:'/trends',name:'Detailed trends',icon:'spending'},{href:'/customize',name:'Widgets',icon:'home'}];
 const planning=[{href:'/scheduled',name:'Recurring',icon:'recurring'},{href:'/calendar',name:'Calendar',icon:'calendar'},{href:'/cashflow',name:'Cash flow',icon:'activity'}];
 function active(href:string){return navigationMatches(href,page.url.pathname);}
 let menuButton:HTMLButtonElement|undefined=$state();
 let wasOpen=false;
 $effect(()=>{if(open)queueMicrotask(()=>document.querySelector<HTMLAnchorElement>('#product-navigation a')?.focus());else if(wasOpen)menuButton?.focus();wasOpen=open;});
 afterNavigate(()=>{wasOpen=false;open=false;});
</script>
{#if viewer}
 <Utilities {user} {branding} themes={themePresentationOrder(themes)} {selectedTheme} {themeAction} {notifications} {notificationsUnread} {viewer} bind:open/>
{:else}
<a class="skip-content" href="#main-content">Skip to content</a>
<aside class:expanded={open} class="product-sidebar" aria-label="Primary navigation" id="product-navigation">
 <a class="product-brand" href="/"><span class="brand-symbol" aria-hidden="true">g</span>{branding.name}</a>
 {#each [{label:'Your finances',links:daily},{label:'Planning',links:planning}] as section}
 <nav aria-label={section.label}><p class="nav-section-title">{section.label}</p>{#each section.links as link}<a href={link.href} class:current={active(link.href)} aria-current={navigationCurrent(link.href,page.url.pathname)}><Icon name={link.icon} size={19}/><span>{link.name}</span></a>{/each}</nav>
 {/each}
 <details class="product-nav-more"><summary>More tools</summary><nav aria-label="More tools">{#each tools as link}<a href={link.href} class:current={page.url.pathname===link.href}><Icon name={link.icon} size={19}/>{link.name}</a>{/each}</nav></details>
 <nav class="sidebar-footer" aria-label="Preferences"><a href="/settings" class:current={page.url.pathname.startsWith('/settings')}><Icon name="settings" size={19}/>Settings</a><span class="profile-label">{user.name}</span></nav>
</aside>
<header class="product-topbar">
 <div class="mobile-brand"><span class="brand-symbol" aria-hidden="true">g</span>{branding.name}</div>
 <a class="search-shortcut" href="/transactions"><Icon name="search" size={17}/><span>Find a transaction</span></a>
 <div class="topbar-actions"><Utilities {user} {branding} themes={themePresentationOrder(themes)} {selectedTheme} {themeAction} {notifications} {notificationsUnread} utilitiesOnly/><button bind:this={menuButton} class="mobile-menu product-icon-button" aria-label={open?'Close menu':'Open navigation'} aria-expanded={open} aria-controls="product-navigation" onclick={()=>open=!open}><Icon name={open?'close':'menu'} size={21}/></button></div>
</header>
{#if open}<button class="menu-scrim" aria-label="Close navigation" onclick={()=>open=false}></button>{/if}
<nav inert={open||undefined} class="product-bottom-nav" aria-label="Everyday finances">{#each daily as link}<a href={link.href} class:current={active(link.href)} aria-current={navigationCurrent(link.href,page.url.pathname)}><Icon name={link.icon} size={21}/><span>{link.name}</span></a>{/each}</nav>
{/if}
<svelte:window onresize={()=>{if(window.innerWidth>=768)open=false;}} onkeydown={(e)=>{if(e.key==='Escape')open=false;}}/>
