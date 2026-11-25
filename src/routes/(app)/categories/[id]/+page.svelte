<script lang="ts">
 import type {PageData} from './$types';
 import Title from '$lib/components/Title.svelte';
 import Overview from '$lib/components/CategoryOverview.svelte';
 let {data}:{data:PageData}=$props();
</script>
<Title title={data.category.name}/><Overview {data}/>
