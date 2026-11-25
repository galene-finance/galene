<script lang="ts">
 let {month,path='/',label='Month'}:{month:string;path?:string;label?:string}=$props();
</script>
<form method="GET" action={path} class="product-toolbar"><div class="product-field"><label for="report-month">{label}</label><input id="report-month" type="month" name="month" value={month} required/></div><button type="submit" class="product-button">View</button></form>
