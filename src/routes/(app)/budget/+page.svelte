<script lang="ts">
	import { enhance } from '$app/forms';
	import TargetSettings from '$lib/components/TargetSettings.svelte';
	import FundingOverview from '$lib/components/FundingOverview.svelte';
 import MoveMoneyControls from '$lib/components/MoveMoneyControls.svelte';
 import CardReserveControls from '$lib/components/CardReserveControls.svelte';
 import type {MovingMoneyModel,MovingMoneyResult} from '$lib/movingMoneyFeatureTypes';
	import CategoryPill from '$lib/components/CategoryPill.svelte';
	import type {budgetFunding} from '$lib/server/budgetIntegration';
	import Badge from '$lib/components/FinancialBadge.svelte';
	import {monthlyPlanTotal} from '$lib/monthlyPlan';
	import {planningGroups} from '$lib/planningGroups';
	import Title from '$lib/components/Title.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { watchFormToast } from '$lib/formToast.svelte';
	import { inclusiveEnd } from '$lib/trendsChart';
	import { formatMoney, periodLabel } from '$lib/utils';
	import type { Budget, Category } from '$lib/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	type BudgetRow = Budget & {
		category_name: string;
		category_color: string | null;
		spentCents: number;
		from: string;
		to: string;
	};

	let { form, data }: {
		form: ({ error?: string | null; targetEffectiveMonth?: string; targetOperation?: string } & Partial<MovingMoneyResult>) | undefined;
		data: { budgets: BudgetRow[]; categories: Category[]; selectedDate: string; moneyControls?:MovingMoneyModel } & Partial<ReturnType<typeof budgetFunding>>;
	} = $props();

	const kinds=$derived(new Map(data.categories.map(c=>[c.id,c.type])));
	const plan=$derived(monthlyPlanTotal(data.budgets,kinds));
	const activeTargets=$derived(data.funding?.plan.lines.filter(t=>t.active)??[]);
	const enginePlan=$derived(activeTargets.length?data.funding!.plan:null);
	const groups=$derived(planningGroups(data.budgets.filter(b=>!activeTargets.some(t=>t.categoryId===b.category_id)),data.categories));
	const withoutTarget=$derived(data.categories.filter(c=>c.type==='expense'&&!data.categories.some(child=>child.parent_id===c.id)&&!data.budgets.some(b=>b.category_id===c.id)&&!activeTargets.some(t=>t.categoryId===c.id)));
	function addForCategory(c:Category){if(data.targetSpecs){openEngineTarget(c.id);return;}openAdd();categoryId=String(c.id);}
	// --- Add / edit dialog ---
	let dialogOpen = $state(false);
	let editing = $state<BudgetRow | null>(null);
	let type = $state<'expense' | 'income'>('expense');
	let amount = $state('');
	let categoryId = $state('');
	let categorySearch = $state('');
	let categoryCreate = $state(false);
	let categoryNewName = $state('');
	let period = $state<'week' | 'month' | 'year'>('month');

	const categoryItems = $derived(
		data.categories
			.filter((c) => c.type === type && c.system_kind !== 'balance_adjustment') // transfers and balance adjustments are excluded from budgets
			.map((c) => ({ value: String(c.id), label: c.name }))
	);

 function openEngineTarget(categoryChoice:number|null=null,legacyId?:number){
  const panel=document.getElementById('target-settings') as HTMLDetailsElement|null;if(!panel)return;panel.open=true;
  const detail=document.getElementById(legacyId===undefined?'new-target':`legacy-target-${legacyId}`) as HTMLDetailsElement|null;
  if(detail){detail.open=true;detail.scrollIntoView({block:'center'});const field=detail.querySelector('select[name=category_id]') as HTMLSelectElement|null;if(field){if(categoryChoice!==null)field.value=String(categoryChoice);field.focus();}}
  else panel.scrollIntoView({block:'start'});
 }
	function openAdd() {
  if(data.targetSpecs){openEngineTarget();return;}
		editing = null;
		type = 'expense';
		amount = '';
		categoryId = '';
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		period = 'month';
		dialogOpen = true;
	}

	function openEdit(b: BudgetRow) {
  if(data.targetSpecs&&data.categories.find(c=>c.id===b.category_id)?.type!=='income'){openEngineTarget(b.category_id,b.id);return;}
		editing = b;
		const cat = data.categories.find((c) => c.id === b.category_id);
		type = cat?.type === 'income' ? 'income' : 'expense';
		amount = (b.limit_cents / 100).toFixed(2);
		categoryId = String(b.category_id);
		categorySearch = '';
		categoryCreate = false;
		categoryNewName = '';
		period = b.period;
		dialogOpen = true;
	}

	function onTypeChange(newType: 'expense' | 'income') {
		if (newType === type) return;
		type = newType;
		const cat = data.categories.find((c) => String(c.id) === categoryId);
		if (cat && cat.type !== newType) {
			categoryId = '';
			categoryCreate = false;
		}
	}

	const handleSubmit: SubmitFunction = ({ formData }) => {
		formData.set('id', editing ? String(editing.id) : '');
		formData.set('type', type);
		formData.set('amount', amount);
		formData.set('period', period);
		if (categoryCreate) {
			formData.set('category_id', '');
			formData.set('category_new', categoryNewName);
		} else {
			formData.set('category_id', categoryId);
			formData.set('category_new', '');
		}
		return async ({ result, update }) => {
			await update();
			// 'success' also covers actions that return an error object — only close when there is none.
			if (result.type === 'redirect' || (result.type === 'success' && !result.data?.error)) {
				dialogOpen = false;
			}
		};
	};

	// Toast the latest action result (replaces the old top-of-page status block).
	watchFormToast(() => form);
</script>

<Title title="Plan" />
<div class="product-page">
 <header class="product-heading plan-heading"><div><h1>Plan</h1></div><button class="product-button primary" onclick={openAdd}>Add a target</button></header>
 <section class="product-panel"><header class="product-panel-header"><div><h2>Cost to be me</h2><p class="product-row-caption">{enginePlan?'Planned contribution this month':'Existing monthly target intent'}</p></div>{#if enginePlan?.totalCents!==null&&enginePlan?.totalCents!==undefined}<Badge value={formatMoney(enginePlan.totalCents)} label="Monthly plan"/>{:else if plan.totalCents!==null}<Badge value={formatMoney(plan.totalCents)} label="Existing monthly plan"/>{:else}<Badge label={plan.needsReview?'Review targets':'No monthly targets'} tone={plan.needsReview?'attention':'neutral'}/>{/if}</header><footer class="product-details">{enginePlan?activeTargets.length:plan.targetIds.length} targets · not money available.</footer></section>
 <form method="GET" class="product-toolbar"><label class="product-field" for="plan-date"><span>Compare activity as of</span><input id="plan-date" type="date" name="date" value={data.selectedDate} required/></label><button class="product-button">View</button></form>
 {#if form?.targetEffectiveMonth}<p class="product-details" role="status">Target version {form.targetOperation} effective {form.targetEffectiveMonth}. Earlier views are preserved.</p>{/if}
 {#if form?.error}<div class="product-attention" role="alert">{form.error}</div>{/if}
 {#if data.funding&&data.fundingDate&&data.commandKey}<FundingOverview funding={data.funding} fundingDate={data.fundingDate} commandKey={data.commandKey} categories={data.categories}/>{/if}
 {#if data.moneyControls&&data.commandKey}{#key data.commandKey}
 <MoveMoneyControls model={data.moneyControls} commandKey={data.commandKey} form={form?.feature?form as MovingMoneyResult:undefined}/>
 <CardReserveControls model={data.moneyControls} commandKey={data.commandKey} form={form?.feature?form as MovingMoneyResult:undefined}/>
 {/key}{/if}
 {#if data.targetSpecs&&data.funding&&data.commandKey}<TargetSettings targets={data.targetSpecs} categories={data.categories} budgets={data.budgets} month={data.selectedDate.slice(0,7)} revision={data.funding.view.revision} commandKey={data.commandKey}/>{/if}
 {#if !data.budgets.length&&!activeTargets.length}<section class="product-panel product-empty"><strong>Start with a category that matters</strong><p>Add a target you can adjust as the month unfolds.</p><button class="product-button" onclick={openAdd}>Add your first target</button></section>{/if}
 {#each groups as group (group.key)}
  {@const groupPlan=monthlyPlanTotal(group.items,kinds)}
  <section class="product-panel"><header class="product-panel-header"><div><h2>{group.name}</h2><p class="product-row-caption">{group.period==='month'?'Monthly':group.period==='week'?'Weekly':'Yearly'} · {group.items.length} targets{group.income?' · separate from planned costs':''}</p></div>{#if groupPlan.totalCents!==null}<Badge value={formatMoney(groupPlan.totalCents)} label="Monthly targets"/>{/if}</header>
   {#each group.items as b (b.id)}
    {@const income=kinds.get(b.category_id)==='income'}
    {@const movement=kinds.get(b.category_id)==='transfer'}
    {@const over=b.spentCents>b.limit_cents}
    {@const tone=movement?'movement':income?(b.spentCents>=b.limit_cents?'positive':'neutral'):(over?'negative':'neutral')}
    <div class="budget-line">
     <button type="button" class="budget-category" aria-label={`Edit ${b.category_name} target`} onclick={()=>openEdit(b)} disabled={movement} title={movement?'Movement targets are not editable in this form':undefined}><span class="budget-category-title"><CategoryPill id={b.category_id} name={b.category_name} color={b.category_color}/><span class="budget-edit-hint">{movement?'Movement':'Edit'}</span></span><span class="product-row-caption">{periodLabel(b.period,b.from,b.to)}</span>{#if !movement}<span class="product-row-caption">{income?'Posted income':'Recorded spending'} {formatMoney(b.spentCents)} · {formatMoney(b.limit_cents)} {income?'goal':'limit'}</span>{/if}</button>
     <a class="budget-difference" href={`/categories/${b.category_id}?date_from=${b.from}&date_to=${inclusiveEnd(b.to)}`} aria-label={`View ${b.category_name} activity`}><Badge value={formatMoney(movement?b.limit_cents:Math.abs(b.limit_cents-b.spentCents))} label={movement?'Planned movement':income?(over?'Above goal':b.spentCents===b.limit_cents?'Goal reached':'To income goal'):(over?'Over limit':'Left to limit')} {tone}/></a>
    </div>
   {/each}
  </section>
 {/each}
 {#if withoutTarget.length}<details class="product-panel product-details"><summary>Categories without a target ({withoutTarget.length})</summary><p>A category without a target is not proof of spending or of money available.</p><ul class="product-list">{#each withoutTarget as c}<li class="product-row"><CategoryPill id={c.id} name={c.name} color={c.color}/><button class="product-button" onclick={()=>addForCategory(c)}>Add target</button></li>{/each}</ul></details>{/if}
 <details class="product-panel product-details"><summary>How the plan works</summary><p>Targets are current; changing the comparison date does not restore past targets. The comparison uses posted, categorized activity. Income goals and other cadences are separate from Cost to be me. Refunds reduce spending in their category. Transfers and card payments are not new spending. Each target retains its own week, month or year period. Changing a target changes the plan; it does not move money or reserve an account balance. Category groups collect their individual targets without adding the group total a second time.</p></details>
</div>

<Dialog
	bind:open={dialogOpen}
	size="md"
	title={editing ? 'Edit target' : 'Add target'}
	description={editing ? undefined : 'Set a spending limit or an income goal.'}
>
	<form id="budget-dialog-form" method="POST" action="?/save" use:enhance={handleSubmit} class="flex flex-col gap-4">
		<div class="flex gap-2" role="group" aria-label="Target type">
			<button
				type="button"
				onclick={() => onTypeChange('expense')}
                aria-pressed={type === 'expense'}
				class="flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors {type === 'expense'
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground hover:bg-muted'}"
			>
				Expense
			</button>
			<button
				type="button"
				onclick={() => onTypeChange('income')}
                aria-pressed={type === 'income'}
				class="flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors {type === 'income'
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground hover:bg-muted'}"
			>
				Income
			</button>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<Field label="Limit amount">
				<Input type="text" inputmode="decimal" bind:value={amount} placeholder="0.00" required autocomplete="off" />
			</Field>
			<Field label="Period">
				<Select
					bind:value={period}
					items={[
						{ value: 'week', label: 'Week' },
						{ value: 'month', label: 'Month' },
						{ value: 'year', label: 'Year' }
					]}
				/>
			</Field>
		</div>

		<Field label="Category">
			<Combobox
				bind:value={categoryId}
				bind:search={categorySearch}
				items={categoryItems}
				allowCreate
				createLabel="Create category"
				placeholder="Search or create category"
				onselect={(_, label, typed) => {
					categoryCreate = label === null;
					if (label === null) categoryNewName = typed;
				}}
			/>
		</Field>

		{#if form?.error}
			<p class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</p>
		{/if}

	</form>
	{#snippet footer()}
		<div class="flex items-center gap-2">
			{#if editing}
				<form
					method="POST"
					action="?/delete"
					class="mr-auto"
					onsubmit={(event) => {
						if (!confirm('Remove this budget limit? Your transactions and account balances will not change.')) {
							event.preventDefault();
						}
					}}
				>
					<input type="hidden" name="id" value={editing.id} />
					<Button variant="destructive" type="submit">Remove limit</Button>
				</form>
			{/if}
			<Button variant="secondary" type="button" onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button type="submit" form="budget-dialog-form">{editing ? 'Save changes' : 'Add budget'}</Button>
		</div>
	{/snippet}
</Dialog>
<style>
 .plan-heading{flex-direction:row;align-items:center}
 .budget-line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:17px 22px;border-bottom:1px solid var(--border)}
 .budget-line:last-child{border-bottom:0}.budget-category{min-width:0;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-height:44px;border:0;background:transparent;color:var(--foreground)}
 .budget-category-title{display:flex;align-items:center;gap:10px;max-width:100%}.budget-edit-hint{font-size:11px;color:var(--muted-foreground)}.budget-difference{display:inline-flex;align-items:center;justify-content:flex-end;min-height:44px;text-decoration:none}
 @media(max-width:767px){.budget-line{gap:12px;padding:16px}.budget-category-title{gap:6px}.budget-category .product-row-caption{font-size:11px}}

</style>
