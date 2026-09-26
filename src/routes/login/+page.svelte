<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import Checkbox from '$lib/components/ui/Checkbox.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import Title from '$lib/components/Title.svelte';
	import { DEFAULT_THEMES } from '$lib/themes';
	import type { Branding } from '$lib/types';

	let {
		form,
		data
	}: {
		form: { error?: string | null; email?: string; name?: string; mfa?: boolean } | undefined;
		data: {
			setup: boolean;
			branding: Branding;
			version: string;
			mfa: { email: string } | null;
			oidc: { enabled: boolean; mode: 'optional' | 'required'; providerLabel: string } | null;
		};
	} = $props();

	let showPassword = $state(false);

	// Re-seed name/email from a failed submission so they survive the re-render
	// (the component's local state is reset when the form data updates).
	let name = $state('');
	let email = $state('');
	let code = $state('');
	let demoData = $state(false);
	$effect(() => {
		if (form?.name) name = form.name;
		if (form?.email) email = form.email;
	});

</script>

<Title title={data.setup ? 'Set up your account' : 'Sign in'} />

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
	<div class="absolute right-4 top-4">
		<ThemePicker themes={DEFAULT_THEMES} />
	</div>

	<div class="w-full max-w-sm">
		<div class="mb-6 flex flex-col items-center gap-2">
			<img
				src="/brand/galene-emblem.png"
				alt=""
				width="40"
				height="40"
				class="size-10 rounded-full object-cover"
				decoding="async"
			/>
			<h1 class="text-xl font-semibold tracking-tight">{data.branding.name}</h1>
			<p class="text-sm text-muted-foreground">Calm seas. Clear books.</p>
			<p class="text-sm text-muted-foreground">
				{data.setup ? 'Set up your account to get started' : 'Sign in to your account'}
			</p>
			{#if data.setup}
				<p class="text-xs text-muted-foreground">The first account created on this server is the administrator.</p>
			{/if}
		</div>

		<div class="rounded-lg border border-border bg-surface p-5">
			{#if data.setup}
				<form method="POST" action="?/signup" use:enhance class="flex flex-col gap-3">
					<Field label="Name">
						<Input type="text" name="name" bind:value={name} required autocomplete="name" placeholder="Your name" />
					</Field>
					<Field label="Email">
						<Input type="email" name="email" bind:value={email} required autocomplete="email" placeholder="you@example.com" />
					</Field>
					<Field label="Password" hint="At least 8 characters">
						<Input type="password" name="password" required autocomplete="new-password" placeholder="••••••••" />
					</Field>
					<div class="flex items-start gap-2">
						<Checkbox bind:checked={demoData} name="demo_data" label="Load demo data" class="mt-0.5" />
						<p class="text-xs leading-4 text-muted-foreground">
							Starts the account with sample accounts, ~3 months of transactions, budgets, and rules.
						</p>
					</div>
					{#if form?.error}
						<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
					{/if}
					<Button type="submit">Create account</Button>
				</form>
			{:else if data.mfa}
				<div class="flex flex-col gap-3">
					<p class="text-sm text-muted-foreground">Sign in as {data.mfa.email}</p>
					<form method="POST" action="?/verify" use:enhance class="flex flex-col gap-3">
						<p class="text-sm text-muted-foreground">
							Enter the 6-digit code from your authenticator app, or a backup code.
						</p>
						<Field label="Code">
							<Input
								type="text"
								name="code"
								bind:value={code}
								required
								autocomplete="one-time-code"
								placeholder="123456"
							/>
						</Field>
						{#if form?.error}
							<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
						{/if}
						<Button type="submit">Verify</Button>
					</form>
					<form method="POST" action="?/cancel" class="flex justify-center">
						<button type="submit" class="text-xs text-muted-foreground hover:text-foreground">
							Cancel and sign in again
						</button>
					</form>
				</div>
			{:else if data.oidc?.mode === 'required' && !showPassword}
				<div class="flex flex-col gap-3">
					<p class="text-center text-sm text-muted-foreground">This household signs in with single sign-on.</p>
					<a
						href="/auth/oidc/start"
						class="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
					>
						Continue with SSO
					</a>
					<p class="text-center text-xs text-muted-foreground">via {data.oidc.providerLabel}</p>
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground"
						onclick={() => (showPassword = true)}
					>
						Use local password
					</button>
				</div>
			{:else}
				<form method="POST" action="?/login" use:enhance class="flex flex-col gap-3">
					<Field label="Email">
						<Input type="email" name="email" bind:value={email} required autocomplete="email" placeholder="you@example.com" />
					</Field>
					<Field label="Password">
						<Input type="password" name="password" required autocomplete="current-password" placeholder="••••••••" />
					</Field>
					{#if form?.error}
						<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
					{/if}
					<Button type="submit">{data.oidc?.mode === 'required' ? 'Sign in with password' : 'Sign in'}</Button>
				</form>
				{#if data.oidc}
					<div class="my-4 flex items-center gap-3 text-xs text-muted-foreground">
						<span class="h-px flex-1 bg-border"></span>
						<span>or</span>
						<span class="h-px flex-1 bg-border"></span>
					</div>
					<a
						href="/auth/oidc/start"
						class="inline-flex h-9 w-full items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-muted"
					>
						Continue with SSO
					</a>
					<p class="mt-2 text-center text-xs text-muted-foreground">via {data.oidc.providerLabel}</p>
				{/if}
			{/if}
		</div>

		<p class="mt-4 text-center text-xs text-muted-foreground">{data.branding.name} v{data.version}</p>
	</div>
</div>
