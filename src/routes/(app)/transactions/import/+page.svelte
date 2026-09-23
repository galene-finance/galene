<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import Title from '$lib/components/Title.svelte';
	import { formatMoney } from '$lib/utils';
	import { toastFormResult } from '$lib/toasts';

	let {
		form,
		data
	}: {
		form:
			| { error?: string | null; ok?: boolean; result?: { created: number; skipped: number; failed: number } }
			| undefined;
		data: {
			accounts: { id: number; name: string }[];
			preview: {
				id: string;
				okCount: number;
				errorCount: number;
				options: { createAccounts: boolean; createCategories: boolean; createTags: boolean };
				createAccountNames: string[];
				createCategoryNames: string[];
				createTagNames: string[];
				rows: {
					line: number;
					date: string;
					dateParsed: string | null;
					account: string;
					amount: string;
					merchant: string;
					category: string;
					tags: string;
					status: string;
					errors: string[];
					willCreateAccount: boolean;
					willCreateCategory: boolean;
					willCreateTags: string[];
					parsed?: { type: string; amountCents: number };
				}[];
			} | null;
		};
	} = $props();

	let lastForm = untrack(() => form);
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
		if (form?.ok && form.result) {
			void goto('/transactions');
		}
	});
</script>

<Title title="Import transactions" />

<div class="mx-auto flex max-w-5xl flex-col gap-6">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold tracking-tight">Import transactions</h1>
			<p class="text-sm text-muted-foreground">
				Download the CSV template, fill it in, upload for a preview, then confirm to create transactions.
			</p>
		</div>
		<a href="/transactions" class="text-sm text-primary underline-offset-2 hover:underline">← Transactions</a>
	</div>

	{#if form?.error}
		<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
	{/if}

	{#if !data.preview}
		<section class="rounded-lg border border-border bg-surface p-5">
			<h2 class="text-base font-semibold">1. Template</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Required columns: <code class="text-xs">date</code>, <code class="text-xs">account</code>,
				<code class="text-xs">amount</code>. Dates:
				<code class="text-xs">YYYY-MM-DD</code>, <code class="text-xs">YYYY/MM/DD</code>, or US
				<code class="text-xs">M/D/YYYY</code> / <code class="text-xs">MM/DD/YYYY</code> (also
				<code class="text-xs">-</code> separators and 2-digit years). Amount is dollars — negative for
				expenses, positive for income. Optional: <code class="text-xs">merchant</code>,
				<code class="text-xs">notes</code>, <code class="text-xs">category</code>,
				<code class="text-xs">tags</code> (semicolon- or pipe-separated).
			</p>
			{#if data.accounts.length === 0}
				<p class="mt-3 text-sm text-destructive">
					No accounts yet — enable “Create missing accounts” below, or add one in Settings first.
				</p>
			{:else}
				<p class="mt-2 text-xs text-muted-foreground">
					Your accounts: {data.accounts.map((a) => a.name).join(', ')}
				</p>
			{/if}
			<div class="mt-4">
				<a
					href="/transactions/import/template"
					class="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-muted"
				>
					Download CSV template
				</a>
			</div>
		</section>

		<section class="rounded-lg border border-border bg-surface p-5">
			<h2 class="text-base font-semibold">2. Upload</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				You’ll see a row-by-row preview before anything is saved. Creating missing accounts, categories, or
				tags only happens if you opt in below — never silently.
			</p>
			<form
				method="POST"
				action="?/preview"
				enctype="multipart/form-data"
				use:enhance
				class="mt-4 flex flex-col gap-4"
			>
				<label class="flex min-w-0 flex-col gap-1 text-sm">
					<span class="text-muted-foreground">CSV file</span>
					<input
						type="file"
						name="file"
						accept=".csv,text/csv"
						required
						class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
					/>
				</label>
				<fieldset class="rounded-md border border-border p-3">
					<legend class="px-1 text-sm font-medium">If a name isn’t in Galene yet</legend>
					<div class="mt-1 flex flex-col gap-2 text-sm">
						<label class="flex items-start gap-2">
							<input type="checkbox" name="create_accounts" class="mt-1" />
							<span>Create missing <strong>accounts</strong> (type: bank)</span>
						</label>
						<label class="flex items-start gap-2">
							<input type="checkbox" name="create_categories" class="mt-1" />
							<span
								>Create missing <strong>categories</strong> (type from amount: expense vs income)</span
							>
						</label>
						<label class="flex items-start gap-2">
							<input type="checkbox" name="create_tags" class="mt-1" />
							<span>Create missing <strong>tags</strong></span>
						</label>
					</div>
				</fieldset>
				<div>
					<Button type="submit">Preview import</Button>
				</div>
			</form>
		</section>
	{:else}
		<section class="rounded-lg border border-border bg-surface p-5">
			<h2 class="text-base font-semibold">3. Preview</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				{data.preview.okCount} ready to import
				{#if data.preview.errorCount > 0}
					· <span class="text-destructive">{data.preview.errorCount} with errors (will be skipped)</span>
				{/if}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Create options:
				accounts {data.preview.options.createAccounts ? 'on' : 'off'}, categories
				{data.preview.options.createCategories ? 'on' : 'off'}, tags
				{data.preview.options.createTags ? 'on' : 'off'}.
			</p>
			{#if data.preview.createAccountNames.length || data.preview.createCategoryNames.length || data.preview.createTagNames.length}
				<div class="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
					<p class="font-medium">Will create on confirm</p>
					<ul class="mt-1 list-inside list-disc text-muted-foreground">
						{#if data.preview.createAccountNames.length}
							<li>Accounts: {data.preview.createAccountNames.join(', ')}</li>
						{/if}
						{#if data.preview.createCategoryNames.length}
							<li>Categories: {data.preview.createCategoryNames.join(', ')}</li>
						{/if}
						{#if data.preview.createTagNames.length}
							<li>Tags: {data.preview.createTagNames.join(', ')}</li>
						{/if}
					</ul>
				</div>
			{/if}

			<div class="mt-4 galene-scroll-x min-w-0 max-w-full overflow-x-auto rounded-md border border-border">
				<table class="w-full min-w-[720px] text-left text-sm">
					<thead class="border-b border-border bg-muted/40 text-xs text-muted-foreground">
						<tr>
							<th class="px-3 py-2 font-medium">Line</th>
							<th class="px-3 py-2 font-medium">Date</th>
							<th class="px-3 py-2 font-medium">Account</th>
							<th class="px-3 py-2 font-medium">Amount</th>
							<th class="px-3 py-2 font-medium">Merchant</th>
							<th class="px-3 py-2 font-medium">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.preview.rows as row (row.line)}
							<tr class="border-b border-border last:border-0 {row.status === 'error' ? 'bg-destructive/5' : ''}">
								<td class="px-3 py-2 text-muted-foreground">{row.line}</td>
								<td class="px-3 py-2">
									{#if row.dateParsed}
										<span class="tabular-nums">{row.dateParsed}</span>
										{#if row.date !== row.dateParsed}
											<span class="block text-xs text-muted-foreground">from {row.date}</span>
										{/if}
									{:else}
										{row.date}
									{/if}
								</td>
								<td class="px-3 py-2">
									{row.account}
									{#if row.willCreateAccount}
										<span class="ml-1 text-xs text-primary">(new)</span>
									{/if}
								</td>
								<td class="px-3 py-2 tabular-nums">
									{#if row.parsed}
										<span class={row.parsed.type === 'expense' ? '' : 'text-success'}
											>{formatMoney(
												row.parsed.type === 'expense' ? -row.parsed.amountCents : row.parsed.amountCents
											)}</span
										>
									{:else}
										{row.amount}
									{/if}
								</td>
								<td class="px-3 py-2">{row.merchant || '—'}</td>
								<td class="px-3 py-2">
									{#if row.status === 'ok'}
										<span class="text-success">OK</span>
										{#if row.willCreateCategory || row.willCreateTags.length}
											<span class="block text-xs text-muted-foreground">
												{#if row.willCreateCategory}new category{/if}
												{#if row.willCreateCategory && row.willCreateTags.length}, {/if}
												{#if row.willCreateTags.length}new tags: {row.willCreateTags.join(', ')}{/if}
											</span>
										{/if}
									{:else}
										<span class="text-destructive">{row.errors.join('; ')}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="mt-4 flex flex-wrap gap-2">
				<form method="POST" action="?/commit" use:enhance>
					<input type="hidden" name="preview_id" value={data.preview.id} />
					<Button type="submit" disabled={data.preview.okCount === 0}>
						Import {data.preview.okCount} transaction{data.preview.okCount === 1 ? '' : 's'}
					</Button>
				</form>
				<a
					href="/transactions/import"
					class="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
				>
					Cancel / new file
				</a>
			</div>
		</section>
	{/if}
</div>
