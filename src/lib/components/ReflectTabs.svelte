<script lang="ts">
 let {query,current='summary'}:{query:string;current?:'summary'|'spending'|'income'|'trends'}=$props();
 const tabs=[{key:'summary',label:'Summary',path:'/reflect?'},{key:'spending',label:'Spending',path:'/spending?'},{key:'income',label:'Income',path:'/income?'},{key:'trends',label:'Trends',path:'/reflect?view=trends&'}] as const;
</script>
<nav class="product-segments" aria-label="Reflect views">{#each tabs as tab}<a href={tab.path+query} aria-current={current===tab.key?'page':undefined}>{tab.label}</a>{/each}</nav>
