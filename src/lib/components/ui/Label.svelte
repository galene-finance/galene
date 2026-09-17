<script lang="ts">
	import type { Snippet } from 'svelte';

	let { class: className = '', for: htmlFor, children }: { class?: string; for?: string; children: Snippet } = $props();
</script>

<label for={htmlFor} class="text-sm font-medium {className}">{@render children()}</label>
