<script lang="ts">
	/** Amber banner for Settings pages that stay visible but non-mutating in demo mode. */
	let {
		demo = false,
		feature = 'These controls'
	}: {
		demo?: boolean;
		/** Short noun phrase, e.g. "Two-factor authentication" */
		feature?: string;
	} = $props();
</script>

{#if demo}
	<div
		class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
		role="status"
	>
		<strong class="font-medium">Demo — read only</strong>
		— {feature} can’t be changed on the public demo. Run your own Galene instance to use
		{feature.toLowerCase().startsWith('these') ? 'them' : 'it'}.
	</div>
{/if}
