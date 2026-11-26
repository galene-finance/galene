<script lang="ts">
 import type {PageData} from './$types';
 import Insights from '$lib/components/ProductInsights.svelte';
 let {data}:{data:PageData}=$props();
</script>
<Insights {data}/>
