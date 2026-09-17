<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import ColorPicker from '$lib/components/ui/ColorPicker.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Title from '$lib/components/Title.svelte';
	import { toastFormResult } from '$lib/toasts';
	import { ACCOUNT_TYPES } from '$lib/types';
	import type { Account, AccountType } from '$lib/types';
	import {
		centsToDollars,
		defaultOpeningAsOf,
		formatMoney,
		parseAmountToCents,
		suggestedOpeningCents
	} from '$lib/utils';

	type AccountRow = Account & {
		ledger_balance_cents: number;
		earliest_txn_date: string | null;
		txn_sum_cents: number;
	};

	let {
		form,
		data
	}: {
		form:
			| { error?: string | null; ok?: boolean; message?: string | null; source?: string }
			| undefined;
		data: { accounts: AccountRow[] };
	} = $props();

	function formatBankAsOf(s: string | null | undefined): string {
		if (!s) return '';
		const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
		if (Number.isNaN(d.getTime())) return s;
		return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	const typeItems = ACCOUNT_TYPES.map((t) => ({
		value: t,
		label: t.charAt(0).toUpperCase() + t.slice(1)
	}));

	// --- Create / Edit dialog ---
	let editOpen = $state(false);
	let accEditId = $state<number | null>(null);
	let accName = $state('');
	let accType = $state<AccountType>('bank');
	let accColor = $state('');
	let accOpening = $state('');
	let accAsOf = $state('');
	let editError = $state('');
	/** Optional typed "bank says" amount when no provider balance (issue #47). */
	let typedBank = $state('');
	let suggestionDismissed = $state(false);

	const editingAccount = $derived(
		accEditId != null ? (data.accounts.find((a) => a.id === accEditId) ?? null) : null
	);

	/** Provider bank balance when editing a linked account that has one. */
	const providerBankCents = $derived(
		editingAccount?.provider && editingAccount.provider_balance_cents != null
			? editingAccount.provider_balance_cents
			: null
	);

	const suggestAsOf = $derived(
		defaultOpeningAsOf(
			editingAccount?.earliest_txn_date ?? null,
			editingAccount?.provider_balance_as_of ?? null
		)
	);

	/**
	 * With default as-of = earliest txn (or no txns), SUM(on/after) is the full
	 * account txn sum (0 when empty).
	 */
	const suggestTxnSum = $derived(editingAccount?.txn_sum_cents ?? 0);

	const providerSuggestion = $derived.by(() => {
		if (providerBankCents == null || !suggestAsOf) return null;
		const opening = suggestedOpeningCents(providerBankCents, suggestTxnSum);
		return { openingCents: opening, asOf: suggestAsOf, bankCents: providerBankCents };
	});

	const typedSuggestion = $derived.by(() => {
		if (providerBankCents != null) return null; // provider path preferred
		const bank = parseAmountToCents(typedBank);
		if (bank === null || !suggestAsOf) return null;
		// Manual / no provider: still need an as-of — earliest txn, else typed path needs a date.
		const opening = suggestedOpeningCents(bank, suggestTxnSum);
		return { openingCents: opening, asOf: suggestAsOf, bankCents: bank };
	});

	/** Show provider suggestion panel unless dismissed. */
	const showProviderSuggest = $derived(
		!suggestionDismissed && providerSuggestion != null
	);

	function openCreate() {
		accEditId = null;
		accName = '';
		accType = 'bank';
		accColor = '';
		accOpening = '';
		accAsOf = '';
		typedBank = '';
		suggestionDismissed = false;
		editError = '';
		editOpen = true;
	}

	function openEdit(a: AccountRow) {
		accEditId = a.id;
		accName = a.name;
		accType = a.type;
		accColor = a.color ?? '';
		accOpening =
			a.opening_balance_cents != null ? centsToDollars(a.opening_balance_cents) : '';
		accAsOf = a.opening_as_of ?? '';
		typedBank = '';
		suggestionDismissed = false;
		editError = '';
		editOpen = true;
	}

	function closeEdit() {
		editOpen = false;
		accEditId = null;
		accName = '';
		accType = 'bank';
		accColor = '';
		accOpening = '';
		accAsOf = '';
		typedBank = '';
		suggestionDismissed = false;
		editError = '';
	}

	function applySuggestion(openingCents: number, asOf: string) {
		accOpening = centsToDollars(openingCents);
		accAsOf = asOf;
	}

	function applyProviderSuggestion() {
		if (!providerSuggestion) return;
		applySuggestion(providerSuggestion.openingCents, providerSuggestion.asOf);
	}

	function applyTypedSuggestion() {
		if (!typedSuggestion) return;
		applySuggestion(typedSuggestion.openingCents, typedSuggestion.asOf);
	}

	// --- Delete dialog ---
	let deleteOpen = $state(false);
	let pendingDelete = $state<AccountRow | null>(null);
	let reassignTo = $state('');
	let deleteError = $state('');

	const reassignItems = $derived.by(() => {
		const items: { value: string; label: string }[] = [];
		if (!pendingDelete) return items;
		for (const a of data.accounts) {
			if (a.id === pendingDelete.id) continue;
			items.push({ value: String(a.id), label: `${a.name} (${a.type})` });
		}
		return items;
	});

	const canReassign = $derived(reassignItems.length > 0);

	function openDelete(a: AccountRow) {
		pendingDelete = a;
		const others = data.accounts.filter((x) => x.id !== a.id);
		reassignTo = others[0] ? String(others[0].id) : '';
		deleteError = others.length
			? ''
			: 'Create another account first — transactions must move to an account (account is required).';
		deleteOpen = true;
	}

	function closeDelete() {
		deleteOpen = false;
		pendingDelete = null;
		reassignTo = '';
		deleteError = '';
	}

	// Failed dialog submissions keep the dialog open and show the server message.
	let lastError = $state<string | null>(null);
	$effect(() => {
		const e = form?.error ?? null;
		if (e !== lastError) {
			lastError = e;
			if (form?.source === 'save') editError = e ?? '';
			if (form?.source === 'delete') deleteError = e ?? '';
		}
	});

	// Success closes the matching dialog and toasts once per new result.
	let lastForm: typeof form | null = null;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
		if (!form?.ok) return;
		if (form.source === 'save') closeEdit();
		if (form.source === 'delete') closeDelete();
	});
</script>

<Title title="Accounts" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-semibold tracking-tight">Accounts</h1>
		<Button type="button" onclick={openCreate}>Add account</Button>
	</div>

	<section class="rounded-lg border border-border bg-surface">
		<div class="border-b border-border px-4 py-3">
			<h2 class="font-medium">Accounts</h2>
			<p class="text-sm text-muted-foreground">
				Bank, credit, cash, and investment accounts. Ledger is Galene’s computed balance; Bank is the
				last provider-reported balance after sync (hidden for manual accounts).
			</p>
		</div>
		<div class="p-4">
			{#if data.accounts.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">No accounts yet.</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.accounts as account (account.id)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
							<span
								class="size-3 shrink-0 rounded-full"
								style="background: {account.color ?? 'transparent'}"
							></span>
							<span class="min-w-0 flex-1 truncate text-sm">{account.name}</span>
							<span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								>{account.type}</span
							>
							{#if account.opening_as_of}
								<span
									class="hidden rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground sm:inline"
									title="Opening balance as of {account.opening_as_of}"
									>opening</span
								>
							{/if}
							<div class="flex w-full flex-col items-end text-right text-xs sm:w-auto sm:min-w-[9rem]">
								<span
									class="font-medium {account.ledger_balance_cents < 0
										? 'text-destructive'
										: 'text-foreground'}"
								>
									<span class="mr-1 font-normal text-muted-foreground">Ledger</span>
									{formatMoney(account.ledger_balance_cents)}
								</span>
								{#if account.provider && account.provider_balance_cents != null}
									<span
										class={account.provider_balance_cents < 0
											? 'text-destructive'
											: 'text-muted-foreground'}
										title={account.provider_balance_as_of
											? `Bank as of ${formatBankAsOf(account.provider_balance_as_of)}`
											: 'Bank balance from last sync'}
									>
										<span class="mr-1 text-muted-foreground">Bank</span>
										{formatMoney(account.provider_balance_cents)}
									</span>
								{/if}
							</div>
							<button
								type="button"
								class="text-sm text-primary hover:underline"
								onclick={() => openEdit(account)}
							>
								Edit
							</button>
							<button
								type="button"
								class="text-sm text-destructive hover:underline"
								onclick={() => openDelete(account)}
							>
								Delete
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>

<Dialog
	bind:open={editOpen}
	title={accEditId ? 'Edit account' : 'Add account'}
	description={accEditId
		? 'Update name, type, color, or opening balance.'
		: 'Create a bank, credit, cash, investment, or other account.'}
>
	<form method="POST" action="?/save-account" use:enhance class="flex flex-col gap-4">
		<input type="hidden" name="id" value={accEditId ?? ''} />
		<Field label="Name" error={editError || null}>
			<Input type="text" name="name" bind:value={accName} required placeholder="e.g. Chase Checking" />
		</Field>
		<Field label="Type">
			<Select name="type" bind:value={accType} items={typeItems} />
		</Field>
		<Field label="Color">
			<ColorPicker name="color" bind:value={accColor} />
		</Field>
		<div class="rounded-md border border-border bg-muted/40 p-3">
			<p class="mb-3 text-xs text-muted-foreground">
				Opening balance is the balance <span class="font-medium">before</span> transactions on
				or after the as-of date. Current balance = opening + those transactions. Leave both blank
				to use transaction history only. Signs match transactions (negative = money out / liability).
			</p>
			<div class="flex flex-col gap-3 sm:flex-row">
				<Field label="Opening balance" class="flex-1">
					<Input
						type="text"
						name="opening_balance"
						bind:value={accOpening}
						inputmode="decimal"
						placeholder="e.g. 1250.00"
						autocomplete="off"
					/>
				</Field>
				<Field label="As of" class="flex-1">
					<Input type="date" name="opening_as_of" bind:value={accAsOf} />
				</Field>
			</div>

			{#if showProviderSuggest && providerSuggestion}
				<div class="mt-3 rounded-md border border-border bg-surface p-3">
					<p class="text-xs text-muted-foreground">
						<span class="font-medium text-foreground">Suggested from bank</span>
						— bank {formatMoney(providerSuggestion.bankCents)} minus transactions on/after
						{providerSuggestion.asOf}
						{#if editingAccount?.earliest_txn_date}
							(earliest imported transaction).
						{:else}
							(sync / bank balance date; no imported transactions yet).
						{/if}
						Does not save until you apply and save the account.
					</p>
					<p class="mt-2 text-sm">
						Opening <span class="font-medium">{formatMoney(providerSuggestion.openingCents)}</span>
						as of <span class="font-medium">{providerSuggestion.asOf}</span>
					</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<Button type="button" size="sm" onclick={applyProviderSuggestion}>Use suggestion</Button>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							onclick={() => (suggestionDismissed = true)}>Dismiss</Button
						>
					</div>
				</div>
			{:else if editingAccount && providerBankCents == null}
				<!-- Manual / no provider balance: optional typed bank target (issue #47) -->
				<div class="mt-3 rounded-md border border-dashed border-border p-3">
					<p class="mb-2 text-xs text-muted-foreground">
						No bank balance on file. Optionally type what the bank shows; Galene can suggest
						opening = that amount − transactions on/after the default as-of
						{#if editingAccount.earliest_txn_date}
							({editingAccount.earliest_txn_date}, earliest imported txn).
						{:else}
							(set an as-of date first, or import transactions).
						{/if}
					</p>
					{#if suggestAsOf}
						<div class="flex flex-col gap-2 sm:flex-row sm:items-end">
							<Field label="Bank says (optional)" class="flex-1">
								<Input
									type="text"
									bind:value={typedBank}
									inputmode="decimal"
									placeholder="e.g. 1250.00"
									autocomplete="off"
								/>
							</Field>
							{#if typedSuggestion}
								<Button type="button" size="sm" onclick={applyTypedSuggestion}
									>Use suggestion</Button
								>
							{/if}
						</div>
						{#if typedSuggestion}
							<p class="mt-2 text-xs text-muted-foreground">
								Would fill opening {formatMoney(typedSuggestion.openingCents)} as of
								{typedSuggestion.asOf} (still need Save).
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
		<div class="flex justify-end gap-2">
			<Button type="button" variant="secondary" onclick={closeEdit}>Cancel</Button>
			<Button type="submit">{accEditId ? 'Save changes' : 'Add account'}</Button>
		</div>
	</form>
</Dialog>

<Dialog
	bind:open={deleteOpen}
	title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete account?'}
	description="Every transaction must stay on an account. Choose where to move this account’s transactions (and scheduled items), then the account is removed."
>
	{#if pendingDelete}
		<form method="POST" action="?/delete-account" use:enhance class="flex flex-col gap-4">
			<input type="hidden" name="id" value={pendingDelete.id} />
			{#if canReassign}
				<Field label="Move transactions to…" error={deleteError || null}>
					<Select name="reassign_to" bind:value={reassignTo} items={reassignItems} />
				</Field>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={closeDelete}>Cancel</Button>
					<Button type="submit" variant="destructive">Delete account</Button>
				</div>
			{:else}
				<p class="text-sm text-destructive">{deleteError}</p>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="secondary" onclick={closeDelete}>Close</Button>
				</div>
			{/if}
		</form>
	{/if}
</Dialog>
