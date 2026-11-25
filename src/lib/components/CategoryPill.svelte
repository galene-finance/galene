<script lang="ts">
 import {categoryIdentity} from '$lib/categoryIdentity';
 let {id,name,color}:{id?:number|null;name:string;color?:string|null}=$props();
 const identity=$derived(categoryIdentity(id,color));
</script>
<span class="category-pill" data-category-id={id??undefined} style:background={identity.fill} style:color={identity.ink}>{name}</span>
<style>.category-pill{display:inline-flex;align-items:center;max-width:100%;border-radius:999px;padding:5px 10px;font-size:12px;font-weight:650;line-height:1.35;overflow-wrap:anywhere;white-space:normal}</style>
