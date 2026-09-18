<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/components/ui/Button.svelte';
	import RuleDialog from '$lib/components/RuleDialog.svelte';
	import Title from '$lib/components/Title.svelte';
	import type { Account, CategorizationRule, Category, RuleCondition } from '$lib/types';
	import { toastFormResult } from '$lib/toasts';
	import { formatMoney } from '$lib/utils';

	let {
		form,
		data
	}: {
		form: { message?: string | null; error?: string | null } | undefined;
		data: {
			accounts: Account[];
			categories: Category[];
			rules: (CategorizationRule & { category_name: string | null })[];
		};
	} = $props();

	let ruleOpen = $state(false);
	let ruleEditing = $state<CategorizationRule | null>(null);

	function openNewRule() {
		ruleEditing = null;
		ruleOpen = true;
	}

	function openEditRule(rule: CategorizationRule) {
		ruleEditing = rule;
		ruleOpen = true;
	}

	function closeRule() {
		ruleEditing = null;
	}

	function conditionText(c: RuleCondition): string {
		if (c.field === 'merchant') {
			return `merchant ${c.op === 'equals' ? 'is' : 'contains'} “${c.value}”`;
		}
		if (c.field === 'account') {
			const a = data.accounts.find((x) => String(x.id) === String(c.value));
			return `account is ${a?.name ?? 'unknown'}`;
		}
		const v = formatMoney(Number(c.value));
		switch (c.op) {
			case 'between':
				return `amount between ${v} and ${formatMoney(Number(c.value2 ?? c.value))}`;
			case 'gt':
				return `amount more than ${v}`;
			case 'lt':
				return `amount less than ${v}`;
			default:
				return `amount equals ${v}`;
		}
	}

	// Toast the latest action result (replaces the old top-of-page status block).
	let lastForm = form;
	$effect(() => {
		if (form === lastForm) return;
		lastForm = form;
		toastFormResult(form);
	});
</script>

<Title title="Categorization rules" />

<div class="mx-auto flex max-w-3xl flex-col gap-4 2xl:max-w-5xl">
	<a href="/settings" class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>← Back to Settings</a
	>
	<h1 class="text-2xl font-semibold tracking-tight">Categorization rules</h1>

	<section class="rounded-lg border border-border bg-surface">
		<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
			<div>
				<h2 class="font-medium">Categorization rules</h2>
				<p class="text-sm text-muted-foreground">
					Auto-assign a category to transactions that come in without one.
				</p>
			</div>
			<div class="flex items-center gap-2">
				{#if data.rules.length > 0}
					<form method="POST" action="?/apply-existing" use:enhance>
						<Button type="submit" variant="secondary" size="sm">Apply to existing</Button>
					</form>
				{/if}
				<Button type="button" size="sm" onclick={openNewRule}>+ New rule</Button>
			</div>
		</div>
		<div class="p-4">
			{#if data.rules.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">
					No rules yet. Create one here, or use Remember this payee on any transaction.
				</p>
			{:else}
				<ul class="divide-y divide-border">
					{#each data.rules as rule (rule.id)}
						<li class="flex flex-wrap items-center gap-3 py-2.5">
							<form method="POST" action="?/toggle-rule" class="flex items-center">
								<input type="hidden" name="id" value={rule.id} />
								<input
									type="checkbox"
									name="enabled"
									value="1"
									checked={rule.enabled === 1}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}
									class="size-4 accent-primary"
									aria-label="Enable rule"
								/>
							</form>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium {rule.enabled !== 1 ? 'text-muted-foreground' : ''}">
									{rule.name}
								</span>
								<span class="block truncate text-xs text-muted-foreground">
									{rule.conditions.map(conditionText).join(' and ')} → {rule.category_name ?? 'unknown category'}
								</span>
							</span>
							<button type="button" class="text-sm text-primary hover:underline" onclick={() => openEditRule(rule)}>
								Edit
							</button>
							<form method="POST" action="?/delete-rule">
								<input type="hidden" name="id" value={rule.id} />
								<button type="submit" class="text-sm text-destructive hover:underline">Delete</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>
</div>

<RuleDialog
	bind:open={ruleOpen}
	editing={ruleEditing}
	accounts={data.accounts}
	categories={data.categories}
	{form}
	action="?/save-rule"
	onclose={closeRule}
/>
