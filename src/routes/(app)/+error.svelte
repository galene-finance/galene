<script lang="ts">
 import {page} from '$app/state';
 import Title from '$lib/components/Title.svelte';
 const title=$derived(page.status===404?'We couldn’t find that page':page.status===403?'This page isn’t available to this account':'Something didn’t load');
</script>
<Title title="Unable to open page"/>
<div class="product-page"><section class="product-panel product-empty"><h1 style:font-size="24px" style:font-weight="650" style:margin-bottom="12px">{title}</h1><p>{page.status<500?page.error?.message:'We couldn’t load this view. Try again, or return to the overview.'}</p><div class="product-toolbar" style:justify-content="center" style:margin-top="22px"><button class="product-button" onclick={()=>window.location.reload()}>Try again</button><a class="product-button primary" href="/">Go to overview</a></div></section></div>
