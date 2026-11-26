<script lang="ts">
 let {name,size=20}:{name:string;size?:number}=$props();
 const paths:Record<string,string>={home:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',activity:'M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4',budget:'M4 5h16v15H4ZM4 9h16m-6 6h3',accounts:'m3 8 9-5 9 5H3m2 3v7m7-7v7m7-7v7M3 21h18',spending:'M4 20V10h3v10m4 0V4h3v16m4 0v-7h3v7',income:'m3 17 6-6 4 4 8-10m-7 0h7v7',recurring:'M4 10a8 8 0 0 1 14-5l3 3m0-6v6h-6M20 14A8 8 0 0 1 6 19l-3-3m0 6v-6h6',calendar:'M4 5h16v16H4ZM4 10h16M8 2v6m8-6v6',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',menu:'M4 6h16M4 12h16M4 18h16',close:'m5 5 14 14M5 19 19 5'};
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]??paths.activity}/></svg>
