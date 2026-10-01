<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Title from '$lib/components/Title.svelte';
	import type { ApiTokenInfo } from '$lib/server/apiTokens';
	import { copyText } from '$lib/clipboard';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { toast } from '$lib/toasts';

	let {
		form,
		data
	}: {
		form: { error?: string; mcpError?: string; token?: string; tokenName?: string; message?: string; ok?: boolean } | undefined;
		data: {
			tokens: ApiTokenInfo[];
			mcpArgs: string[];
			mcpBundleHint: string;
			apiUrl: string;
			isAdmin: boolean;
			mcp: {
				enabled: boolean;
				port: number;
				host: string;
				enabledFromEnv: boolean;
				portFromEnv: boolean;
				hostFromEnv: boolean;
				listening: boolean;
				listenUrl: string;
				version: string;
			} | null;
		};
	} = $props();

	let tokenName = $state('');
	let copied = $state(false);
	let mcpEnabled = $state(false);
	let mcpPort = $state('3001');
	let mcpHost = $state('0.0.0.0');

	$effect(() => {
		if (form?.token) {
			tokenName = '';
			copied = false;
		}
	});

	$effect(() => {
		if (!data.mcp) return;
		mcpEnabled = data.mcp.enabled;
		mcpPort = String(data.mcp.port);
		mcpHost = data.mcp.host;
	});

	async function copyToken() {
		if (!form?.token) return;
		const ok = await copyText(form.token);
		if (!ok) {
			toast('Could not copy — select the token manually', 'error');
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const mcpConfig = $derived(JSON.stringify(
		{
			mcpServers: {
				galene: {
					command: 'bun',
					args: data.mcpArgs,
					env: {
						GALENE_API_URL: data.apiUrl,
						GALENE_API_TOKEN: '<paste your token here>'
					}
				}
			}
		},
		null,
		2
	));

	const mcpHttpConfig = $derived(
		data.mcp
			? JSON.stringify(
					{
						mcpServers: {
							galene: {
								url: data.mcp.listenUrl,
								headers: {
									Authorization: 'Bearer <paste your token here>'
								}
							}
						}
					},
					null,
					2
				)
			: ''
	);

	const endpoints: [path: string, desc: string][] = [
		['/api/v1/summary', 'Balance, month income/expense, recent transactions, top categories'],
		['/api/v1/accounts', 'Accounts with current balances'],
		['/api/v1/transactions', 'Transactions with filters and pagination'],
		['/api/v1/categories', 'Categories'],
		['/api/v1/tags', 'Tags'],
		['/api/v1/budgets', 'Budgets with current-period spend'],
		['/api/v1/scheduled', 'Scheduled expectations'],
		['/api/v1/cashflow', 'Forecast vs. actual by category, by month'],
		['/api/v1/notifications', 'App notifications']
	];

	watchFormToast(() => form);
</script>

<Title title="API" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">API</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">API tokens</h2>
			<p class="text-sm text-muted-foreground">
				Tokens authenticate the REST API and the MCP server. Each token works for your whole account; delete one
				to revoke it.
			</p>
		</div>
		<div class="p-4">
			<form method="POST" action="?/create" use:enhance class="mb-4 flex flex-wrap items-end gap-3">
				<Field label="Name" class="min-w-40 flex-1">
					<Input type="text" name="name" bind:value={tokenName} required placeholder="e.g. laptop, claude" />
				</Field>
				<Button type="submit">Create token</Button>
			</form>

			{#if form?.token}
				<div class="mb-4 rounded-md border border-border bg-background p-3">
					<p class="mb-2 text-sm">
						Token for <span class="font-medium">{form.tokenName}</span> — copy it now, it is only shown once:
					</p>
					<div class="flex items-center gap-2">
						<code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 font-mono text-xs">{form.token}</code>
						<Button type="button" variant="secondary" size="sm" onclick={copyToken}>{copied ? 'Copied' : 'Copy'}</Button>
					</div>
				</div>
			{/if}

			{#if data.tokens.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No tokens yet.</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.tokens as t (t.id)}
						<li class="flex items-center gap-3 py-2.5">
							<span class="flex-1 truncate text-sm">{t.name}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								created {t.created_at} · last used {t.last_used_at ?? 'never'}
							</span>
							<form method="POST" action="?/delete">
								<input type="hidden" name="id" value={t.id} />
								<button type="submit" class="shrink-0 text-sm text-destructive hover:underline">Delete</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	{#if data.isAdmin && data.mcp}
		<section class="rounded-lg border border-border bg-surface">
			<div class="border-b border-border px-4 py-3">
				<h2 class="font-medium">MCP HTTP server</h2>
				<p class="text-sm text-muted-foreground">
					Long-running MCP over HTTP on this host. Off by default (no process, no listener). Turn on to start
					the bundled server; each client sends a Settings → API token per request. Stdio clients can still
					launch the bundle without this toggle.
				</p>
			</div>
			<form
				method="POST"
				action="?/save-mcp"
				use:enhance={() => ({ update }) => update({ reset: false })}
				class="flex flex-col gap-4 p-4"
			>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Enable MCP HTTP listener</span>
					<input type="checkbox" name="enabled" value="1" bind:checked={mcpEnabled} class="size-4 accent-primary" />
				</label>
				{#if data.mcp.enabledFromEnv}
					<p class="text-xs text-muted-foreground">
						Enabled is set by <code class="font-mono text-xs">GALENE_ENABLE_MCP</code> and overrides this
						checkbox at runtime.
					</p>
				{/if}

				<div class="grid gap-3 sm:grid-cols-2">
					<Field label="Port" hint={data.mcp.portFromEnv ? 'Overridden by GALENE_MCP_PORT.' : 'Default 3001.'}>
						<Input type="number" name="port" bind:value={mcpPort} min="1" max="65535" required />
					</Field>
					<Field
						label="Bind address"
						hint={data.mcp.hostFromEnv
							? 'Overridden by GALENE_MCP_HOST.'
							: '0.0.0.0 listens on all interfaces.'}
					>
						<Input type="text" name="host" bind:value={mcpHost} autocomplete="off" />
					</Field>
				</div>

				{#if data.mcp.enabled}
					<div class="rounded-md border border-border bg-background p-3 text-sm">
						<p>
							Status:
							{#if data.mcp.listening}
								<span class="font-medium text-primary">listening</span>
							{:else}
								<span class="font-medium">enabled (starting…)</span>
							{/if}
							— <code class="font-mono text-xs">{data.mcp.listenUrl}</code>
						</p>
						<p class="mt-2 text-muted-foreground">
							Publish the port in compose/quadlet if clients are outside this container. Terminate TLS at
							the reverse proxy; do not expose plain HTTP on a public interface.
						</p>
						<p class="mt-2 mb-1 text-sm">Client config (HTTP):</p>
						<pre class="overflow-x-auto rounded bg-background p-3 font-mono text-xs">{mcpHttpConfig}</pre>
					</div>
				{/if}

				{#if form?.mcpError}
					<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.mcpError}</p>
				{/if}

				<Button type="submit">Save MCP settings</Button>
			</form>
		</section>
	{/if}

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">MCP stdio (client-launched)</h2>
			<p class="text-sm text-muted-foreground">
				Connect an MCP client (Claude Desktop, Grok, …) that launches the bundled stdio server. No Settings
				toggle required — the client starts the process. In the app image the entry is
				<code class="font-mono text-xs">mcp-bundle.js</code>; from source use
				<code class="font-mono text-xs">mcp/index.ts</code>.
			</p>
		</div>
		<div class="p-4">
			<p class="mb-2 text-sm">Add this to your client's MCP config, with one of your tokens:</p>
			<pre class="overflow-x-auto rounded bg-background p-3 font-mono text-xs">{mcpConfig}</pre>
		</div>
	</section>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">REST API</h2>
			<p class="text-sm text-muted-foreground">
				Read-only JSON endpoints under <code class="font-mono text-xs">/api/v1</code>. Authenticate with
				<code class="font-mono text-xs">Authorization: Bearer &lt;token&gt;</code>. All amounts are integer cents,
				dates are YYYY-MM-DD.
			</p>
		</div>
		<div class="p-4">
			<ul class="space-y-1.5 text-sm">
				{#each endpoints as [path, desc] (path)}
					<li class="flex flex-wrap gap-x-3">
						<code class="font-mono text-xs">{path}</code>
						<span class="text-muted-foreground">{desc}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>
</div>
