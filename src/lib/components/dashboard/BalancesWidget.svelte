<script lang="ts">
 import { formatMoney } from '$lib/utils';
 import { accountSection, bankTimestamp } from '$lib/financePresentation';
 import type { DashboardWidgetData } from '$lib/types';
 type Data = Extract<DashboardWidgetData, {kind:'balances'}>;
 let { data }: {data: Data} = $props();
 const sections = [{key:'cash',label:'Cash accounts'}, {key:'debts',label:'Cards & loans'}, {key:'other',label:'Investments & other'}] as const;
</script>

{#if data.items.length === 0}
 <div class="finance-empty"><strong>No matching accounts</strong><p>Check your filters or review <a href="/settings/accounts">Accounts</a>.</p></div>
{:else}
 <p class="finance-caption mb-4">Bank snapshots and ledger records are separate views. Neither is a spendable-cash estimate.</p>
 {#each sections as section}
  {@const accounts = data.items.filter(a => accountSection(a) === section.key)}
  {#if accounts.length}
   <section class="account-section" aria-label={section.label}>
    <h4 class="finance-eyebrow">{section.label} <span class="account-count">{accounts.length}</span></h4>
    {#each accounts as a (a.id)}
     <div class="account-row">
      <div class="account-name"><span class="account-dot" style:background={a.color ?? 'var(--primary)'}></span><span>{a.name}</span></div>
      <dl class="account-values">
       <div><dt>Bank snapshot</dt><dd>{a.bankCents == null ? 'Not supplied' : formatMoney(a.bankCents)}</dd></div>
       <div><dt>Ledger</dt><dd>{formatMoney(a.balanceCents)}</dd></div>
      </dl>
      {#if a.bankCents != null}
       <p class="finance-caption">{bankTimestamp(a.bankAsOf)}</p>
       {#if a.bankCents !== a.balanceCents}
        <p class="balance-warning"><span aria-hidden="true">!</span> Balances differ · {formatMoney(Math.abs(a.bankCents - a.balanceCents))} gap</p>
       {/if}
      {:else}
       <p class="finance-caption">Ledger only · no bank comparison available</p>
      {/if}
      {#if section.key === 'debts'}<p class="finance-caption">Debt account · signed balances as recorded</p>{/if}
     </div>
    {/each}
   </section>
  {/if}
 {/each}
 <p class="finance-caption mt-4 border-t border-border pt-3">Grouped by account type and loan/mortgage names. Balances are not reconciled here; no combined cash or net-worth total is implied.</p>
{/if}
