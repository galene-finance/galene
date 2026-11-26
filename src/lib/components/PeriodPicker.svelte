<script lang="ts">
 let {month,path='/',label='Month',accountId=null,view=null}:{month:string;path?:string;label?:string;accountId?:number|null;view?:string|null}=$props();
</script>
<form method="GET" action={path} class="product-toolbar">
 {#if accountId!==null}<input type="hidden" name="account" value={accountId}/>{/if}
 {#if view!==null}<input type="hidden" name="view" value={view}/>{/if}
 <label class="product-field" for="report-month"><span>{label}</span><input id="report-month" type="month" name="month" value={month} required/></label><button type="submit" class="product-button">View</button>
</form>
