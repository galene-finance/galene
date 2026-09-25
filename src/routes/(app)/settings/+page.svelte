<script lang="ts">
	import Title from '$lib/components/Title.svelte';

	let {
		data
	}: {
		data: { isAdmin: boolean };
	} = $props();

	const pages = $derived([
		...(data.isAdmin
			? [
					{ href: '/settings/users', title: 'Users', desc: 'Create accounts, manage admin access, and remove users.' },
					{
						href: '/settings/backups',
						title: 'Backups',
						desc: 'Copy the database to a local folder, on a schedule, with automatic cleanup of old copies.'
					}
			  ]
			: []),
		{
			href: '/settings/advisor',
			title: 'Advisor access',
			desc: 'Accountant packs and read-only viewer invites, with an expiry you can revoke.'
		},
		{ href: '/settings/appearance', title: 'Appearance', desc: 'Theme, app name, and icons.' },
		{
			href: '/settings/security',
			title: 'Security',
			desc: 'Two-factor authentication with an authenticator app.'
		},
		{
			href: '/settings/sync',
			title: 'Bank sync',
			desc: 'Connect a bank provider and import your accounts and transactions.'
		},
		{ href: '/settings/accounts', title: 'Accounts', desc: 'Bank, credit, cash, and investment accounts.' },
		{
			href: '/settings/categories',
			title: 'Categories',
			desc: 'Expense and income categories, with optional subcategories.'
		},
		{ href: '/settings/tags', title: 'Tags', desc: 'Free-form labels for transactions.' },
		{
			href: '/settings/rules',
			title: 'Categorization rules',
			desc: 'Auto-assign a category to transactions that come in without one.'
		},
		{
			href: '/settings/api',
			title: 'API',
			desc: 'API tokens and the MCP server for scripts and AI assistants.'
		},
		{
			href: '/settings/data',
			title: 'Data',
			desc: 'Delete specific data — accounts, transactions, categories, and more — or all of it at once.'
		},
		{
			href: '/settings/about',
			title: 'About',
			desc: 'Version, build info, and how to check for updates.'
		}
	]);
</script>

<Title title="Settings" />

<div class="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>

	<div class="flex flex-col gap-2">
		{#each pages as p (p.href)}
			<a
				href={p.href}
				class="group flex min-w-0 items-center justify-between overflow-hidden rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-primary/40 hover:bg-surface-hover"
			>
				<div class="min-w-0 flex-1 overflow-hidden">
					<p class="truncate font-medium group-hover:text-primary">{p.title}</p>
					<p class="truncate text-sm text-muted-foreground">{p.desc}</p>
				</div>
				<span class="ml-3 shrink-0 text-muted-foreground group-hover:text-primary">→</span>
			</a>
		{/each}
	</div>
</div>
