<script lang="ts">
	let {
		importHref = '/transactions/import',
		exportHref = '/transactions/export.csv',
		size = 'md'
	}: {
		importHref?: string;
		exportHref?: string;
		size?: 'md' | 'sm';
	} = $props();

	const box = $derived(size === 'sm' ? 'size-8' : 'size-9');
	const icon = $derived(size === 'sm' ? 'size-4' : 'size-5');
	const chrome =
		'inline-flex items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
</script>

<a href={importHref} class="{chrome} {box}" aria-label="Import CSV" title="Import CSV">
	<svg
		class={icon}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<path d="M17 8l-5-5-5 5" />
		<path d="M12 3v12" />
	</svg>
</a>
<a href={exportHref} class="{chrome} {box}" aria-label="Export CSV" title="Export CSV">
	<svg
		class={icon}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<path d="M7 10l5 5 5-5" />
		<path d="M12 15V3" />
	</svg>
</a>
