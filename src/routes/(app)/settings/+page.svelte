<script lang="ts">
 import Title from '$lib/components/Title.svelte';
 import Overview from '$lib/components/SettingsOverview.svelte';
 let {data}:{data:{isAdmin:boolean;demo?:boolean}}=$props();
</script>
<Title title="Settings"/><Overview {data}/>
