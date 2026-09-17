<script lang="ts">
	let { class: className = '', value = $bindable(), ...rest } = $props();
</script>

<input
	{...rest}
	bind:value
	class="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50 {className}"
/>
