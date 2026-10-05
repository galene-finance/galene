<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ConditionCards, { type DialogCondition } from './ConditionCards.svelte';
	import Button from './ui/Button.svelte';
	import Checkbox from './ui/Checkbox.svelte';
	import Dialog from './ui/Dialog.svelte';
	import Field from './ui/Field.svelte';
	import Input from './ui/Input.svelte';
	import { withPending } from '$lib/formPending';
	import type { Account, Category, RuleCondition } from '$lib/types';
	import { centsToDollars } from '$lib/utils';

	export type WebhookDraft = {
		id: number;
		name: string;
		url: string;
		secret_hint: string;
		events: string[];
		fields: string[];
		enabled: number;
		filters: { conditions?: RuleCondition[] };
	};

	let {
		open = $bindable(false),
		editing = null,
		accounts,
		categories,
		events,
		fields,
		form,
		onclose
	}: {
		open?: boolean;
		editing?: WebhookDraft | null;
		accounts: Account[];
		categories: Category[];
		events: string[];
		fields: string[];
		form?: { webhookError?: string };
		onclose?: () => void;
	} = $props();

	let name = $state('');
	let url = $state('');
	let selectedEvents = $state<Record<string, boolean>>({});
	let selectedFields = $state<Record<string, boolean>>({});
	let conditions = $state<DialogCondition[]>([]);
	let enabled = $state(true);
	let saving = $state(false);
	let ready = $state(false);

	function toDialog(conds: RuleCondition[] | undefined): DialogCondition[] {
		return (conds ?? []).map((c) => ({
			field: c.field,
			op: c.op,
			value: c.field === 'amount' ? centsToDollars(Math.abs(Number(c.value))) : String(c.value ?? ''),
			value2:
				c.value2 != null
					? c.field === 'amount'
						? centsToDollars(Math.abs(Number(c.value2)))
						: String(c.value2)
					: undefined
		}));
	}

	function checkedMap(catalog: string[], selected: string[]): Record<string, boolean> {
		const on = new Set(selected);
		return Object.fromEntries(catalog.map((item) => [item, on.has(item)]));
	}

	$effect(() => {
		if (!open) {
			ready = false;
			return;
		}
		if (editing) {
			name = editing.name;
			url = editing.url;
			selectedEvents = checkedMap(events, editing.events);
			selectedFields = checkedMap(fields, editing.fields);
			conditions = toDialog(editing.filters.conditions);
			enabled = editing.enabled === 1;
		} else {
			name = '';
			url = '';
			selectedEvents = checkedMap(events, ['transaction.created']);
			selectedFields = checkedMap(fields, ['event', 'id', 'amount_cents', 'merchant']);
			conditions = [];
			enabled = true;
		}
		ready = true;
	});

	const handleSubmit: SubmitFunction = withPending(
		(v) => (saving = v),
		({ formData, action }) => {
			const rotate = String(action).includes('rotate');
			const remove = String(action).includes('delete');
			if (!rotate && !remove) {
				formData.set('name', name);
				formData.set('url', url);
				formData.set('enabled', enabled ? '1' : '0');
				if (editing) formData.set('id', String(editing.id));
				for (const event of events) {
					if (selectedEvents[event]) formData.append('events', event);
				}
				for (const field of fields) {
					if (selectedFields[field]) formData.append('fields', field);
				}
				for (let i = 0; i < conditions.length; i++) {
					const c = conditions[i];
					formData.set(`cond_field_${i}`, c.field);
					formData.set(`cond_op_${i}`, c.op);
					formData.set(`cond_value_${i}`, String(c.value ?? ''));
					formData.set(`cond_value2_${i}`, String(c.value2 ?? ''));
				}
			} else if (editing) {
				formData.set('id', String(editing.id));
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success' && !result.data?.webhookError) {
					open = false;
					onclose?.();
				}
			};
		}
	);
</script>

<Dialog
	bind:open
	size="lg"
	busy={saving}
	title={editing ? 'Edit webhook' : 'Create webhook'}
	description="HTTPS delivery, HMAC-signed. Conditions use the same builder as Auto transaction rules."
>
	{#if ready}
	<form
		method="POST"
		action={editing ? '?/update-webhook' : '?/create-webhook'}
		use:enhance={handleSubmit}
		class="flex flex-col gap-3"
		aria-busy={saving ? 'true' : undefined}
	>
		<fieldset disabled={saving} class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
			<div class="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
				<Field label="Name">
					<Input type="text" bind:value={name} required placeholder="Kroger over $25" />
				</Field>
				<Field label="HTTPS URL">
					<Input type="url" bind:value={url} required placeholder="https://hooks.example.com/galene" class="font-mono text-xs" />
				</Field>
			</div>

			{#if editing}
				<Field label="Signing secret">
					<div class="flex flex-wrap items-center gap-2">
						<code class="min-w-40 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
							····{editing.secret_hint}
						</code>
						<Button
							type="submit"
							variant="secondary"
							formaction="?/rotate-webhook"
							formmethod="POST"
						>
							Rotate secret
						</Button>
					</div>
					<p class="mt-1 text-xs text-muted-foreground">Hint only. The full secret is shown once after create or rotate.</p>
				</Field>
			{/if}

			<div class="rounded-md border border-border bg-surface p-3">
				<p class="text-sm font-medium">
					On events
					<span class="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">
						select one or more
					</span>
				</p>
				<p class="mb-2 mt-1 text-xs text-muted-foreground">Fires when a matching change is saved.</p>
				<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
					{#each events as event (event)}
						<label class="flex min-h-6 items-center gap-2 text-xs">
							<Checkbox bind:checked={selectedEvents[event]} />
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.78em]">{event}</code>
						</label>
					{/each}
				</div>
			</div>

			<ConditionCards
				bind:conditions
				{accounts}
				{categories}
				allowEmpty
				includeCategory
				heading="When"
				sub="All must match"
			/>

			<div class="rounded-md border border-border bg-surface p-3">
				<p class="text-sm font-medium">Then</p>
				<div class="mt-2 flex items-start gap-2 text-sm">
					<span class="mt-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">
						Fire
					</span>
					<div>
						Fire this webhook (HTTPS, HMAC-signed).
						<p class="mt-1 text-xs text-muted-foreground">
							{editing
								? 'Rotate the secret if the previous value may be compromised.'
								: 'The secret is shown once after create. There is no unsigned option.'}
						</p>
					</div>
				</div>
				<label class="mt-3 flex items-center gap-2 text-sm">
					<button
						type="button"
						role="switch"
						aria-checked={enabled}
						aria-label="Enabled"
						class="relative h-5 w-9 shrink-0 rounded-full border {enabled
							? 'border-transparent bg-primary'
							: 'border-border bg-muted'}"
						onclick={() => (enabled = !enabled)}
					>
						<span
							class="absolute top-0.5 size-3.5 rounded-full {enabled
								? 'right-0.5 bg-primary-foreground'
								: 'left-0.5 bg-muted-foreground'}"
						></span>
					</button>
					<span>Enabled</span>
				</label>
			</div>

			<div class="rounded-md border border-border bg-surface p-3">
				<p class="text-sm font-medium">
					Payload fields
					<span class="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-primary">
						unused omitted
					</span>
				</p>
				<p class="mb-2 mt-1 text-xs text-muted-foreground">The JSON body includes only the fields you pick.</p>
				<div class="grid grid-cols-2 gap-1.5">
					{#each fields as field (field)}
						<label class="flex min-h-6 items-center gap-2 text-xs">
							<Checkbox bind:checked={selectedFields[field]} />
							<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.78em]">{field}</code>
						</label>
					{/each}
				</div>
			</div>

			{#if form?.webhookError}
				<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.webhookError}</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
				<Button type="submit" pending={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create webhook'}</Button>
				<Button variant="secondary" type="button" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
				{#if editing}
					<Button
						type="submit"
						variant="ghost"
						class="ml-auto text-destructive hover:bg-destructive/10"
						formaction="?/delete-webhook"
					>
						Delete webhook
					</Button>
				{/if}
			</div>
		</fieldset>
	</form>
	{/if}
</Dialog>
