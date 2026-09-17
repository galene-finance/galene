<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import type { Branding } from '$lib/types';

	let {
		data,
		children
	}: {
		data: {
			branding: Branding;
			theme: { value: string; slug: string; hash: string } | null;
		};
		children: Snippet;
	} = $props();

	// The server knows this user's theme; it wins over the localStorage
	// copy applied by app.html. Emitted as a string (a literal <script>
	// inside <svelte:head> is raw text — its {} are never compiled) and
	// runs in <head>, so the attribute and stylesheet are in place
	// before first paint.
	const headScript = $derived.by(() => {
		if (!data.theme) return '';
		const t = data.theme;
		return (
			'<script>\n' +
			'(function () {\n' +
			'var slug = ' + JSON.stringify(t.slug) + ';\n' +
			"var href = '/theme.css?theme=' + encodeURIComponent(" +
			JSON.stringify(t.value) +
			") + '&v=' + " +
			JSON.stringify(t.hash) +
			';\n' +
			'document.documentElement.dataset.theme = slug;\n' +
			"var link = document.getElementById('theme-css');\n" +
			'if (!link) {\n' +
			"link = document.createElement('link');\n" +
			"link.id = 'theme-css';\n" +
			"link.rel = 'stylesheet';\n" +
			'document.head.appendChild(link);\n' +
			'}\n' +
			'link.href = href;\n' +
			'})();\n' +
			'</' + 'script>'
		);
	});
</script>

<svelte:head>
	{#if data.theme}
		{@html headScript}
	{/if}
</svelte:head>

{@render children()}
