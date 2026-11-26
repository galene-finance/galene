# Moving allocations and card reserves — isolated feature contract

Base: integrated `5fa12d90a965d03edb58388461e4f2906a2ba0c2`. This feature adds only uniquely named files. No shared route, shared style, existing engine or schema is modified. The integration owner keeps its newer target/Home work and applies only the new-file commit.

## Owned files
- `src/lib/components/MoveMoneyControls.svelte`
- `src/lib/components/CardReserveControls.svelte`
- `src/lib/movingMoneyFeatureTypes.ts`
- `src/lib/server/movingMoneyFeature.ts`
- `src/lib/server/movingMoneyFeature.test.ts`
- `src/lib/server/movingMoneyControls.test.ts`
- `ui-preview/move-money-{App.svelte,fixture-server.ts,fixture.html,main.ts,vite.config.ts,native-render.ts,native-browser.mjs}`
- this document

## Server model and action seam

`movingMoneyModel(database, authenticatedOwnerId, selectedMonth, trustedCutoff)` returns one read-transaction snapshot: revision, coverage, currency, RTA, assignable cash after cash overspending, category allocations and credit-account reserves. Incomplete/stale coverage makes all monetary values null. Raw reserved allocation and cash-backed reserve remain distinct; no fabricated money when cash backing is missing.

`movingMoneyCommand('move'|'reserve', {database,locals,request,url,today,demo?})` returns `MovingMoneyResult`. It rejects anonymous/viewer/token/demo requests, wrong Origin, non-POST, excessive/ambiguous fields, fractional-cent or unsafe amounts, foreign owner references, future/out-of-month dates, stale revisions, conflicting retries, overcommit and incomplete coverage. Trusted server `today` must come from the application's clock, not submitted form data. Native engine mutation remains authoritative and is executed under the same SQLite IMMEDIATE transaction as the coverage check. Form retries retain their key and payload; never blindly retry a network-uncertain save with a new key.

The move command carries a positive amount from one category to another. A destination with unfunded card spending may direct the allocation to the payment reserve instead of increasing category cash: the component explains this and does not optimistically invent a post-save balance. Reserve commands add a positive amount from RTA or release a positive amount back to RTA. The adapter converts direction into the existing signed engine reserve event. These are budget records, **never bank transfers or card payments**.

Components accept `{model,commandKey,form?,action?,submit?}`. Defaults are native progressively enhanced-by-navigation POST forms; no JavaScript-only saving requirement. `submit` is an optional async transport for the isolated fixture or an integration-owner-approved enhancement. Successful native actions must reload the model and mint a new commandKey. Native field validation, semantic labels, keyboard navigation, 44px+ targets, pending/disabled feedback, errors, unknown coverage and empty-card states are included. Both components consume the existing filled FinancialBadge theme tokens and shared product panel/button styles; they do not redefine Graphite/Ocean/Dark.

## Proposed shared-route wiring (integration owner only)

The following is a wiring sketch, **not an applied shared-file change**. Merge with the existing target-editor and Home implementation rather than replacing either route.

```ts
// Existing budget/+page.server.ts imports
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { movingMoneyModel, movingMoneyCommand } from '$lib/server/movingMoneyFeature';
import { todayISO } from '$lib/utils';

// In the existing owner-scoped load, after budgetFunding has computed its cutoff:
const moneyControls = movingMoneyModel(db(), userId, selectedDate.slice(0, 7), fundingDate);
return { /* retain all existing loader fields */, moneyControls };

// Add names to the existing actions object; do not overwrite other actions.
moveMoney: async (event) => {
  const result = await movingMoneyCommand('move', {
    database: db(), locals: event.locals, request: event.request,
    url: event.url, today: todayISO()
  });
  return result.ok ? result : fail(result.status, result);
},
cardReserve: async (event) => {
  const result = await movingMoneyCommand('reserve', {
    database: db(), locals: event.locals, request: event.request,
    url: event.url, today: todayISO()
  });
  return result.ok ? result : fail(result.status, result);
}
```

```svelte
<!-- Existing budget/+page.svelte: extend its typed data/form union, keep targets. -->
<script lang="ts">
 import MoveMoneyControls from '$lib/components/MoveMoneyControls.svelte';
 import CardReserveControls from '$lib/components/CardReserveControls.svelte';
 import type {MovingMoneyResult} from '$lib/movingMoneyFeatureTypes';
 // Existing props plus moneyControls model; preserve other action-result types.
 // Narrow form with `form && 'feature' in form` before passing these components.
</script>
<MoveMoneyControls model={data.moneyControls} commandKey={data.commandKey} form={moneyForm}/>
<CardReserveControls model={data.moneyControls} commandKey={data.commandKey} form={moneyForm}/>
```

Mount each component once per page. Place them alongside/after cash allocations or behind the integration owner's existing progressive disclosure; do not duplicate the old assignment UI or remove target editing. Keep existing session, CSRF, demo and owner scope guards. `product.css` is already owned by the shared layout; no new global style import is needed in production.

## Synthetic browser lane

`ui-preview/move-money-fixture-server.ts` refuses to start outside Docker or without `ATLAS_SYNTHETIC_MOVE_QA=1` and the exact synthetic DB path `/scratch/move-money/db.sqlite`. It creates only synthetic data, calls the real feature adapter and engine, and runs the actual Svelte components. It does not import a production route or bypass production authentication. Its fixed synthetic owner is explicitly not authenticated-session acceptance.

Example isolated container setup (use a verified local Bun/dependency image and read-only dependency tree):

```sh
# Disposable scratch database; expose only host loopback, never public/tailnet.
docker run --name galene-move-feature-qa --read-only \
  --tmpfs /tmp --tmpfs /scratch:mode=1777 \
  --tmpfs /candidate/node_modules/.vite-temp:mode=1777 \
  -p 127.0.0.1:24867:5173 \
  -e ATLAS_SYNTHETIC_MOVE_QA=1 \
  -e GALENE_DB_PATH=/scratch/move-money/db.sqlite \
  -v "$CANDIDATE:/candidate:ro" -v "$DEPS:/candidate/node_modules:ro" \
  -w /candidate --entrypoint bun "$BUN_IMAGE" \
  run ui-preview/move-money-fixture-server.ts
```

Generate `.svelte-kit` in the isolated candidate using the normal check command first. Open `/move-money-fixture.html`. The fixture uses the real Graphite/Ocean/Dark theme implementation; it includes explicit synthetic purchase/refund/payment controls, not fake success responses.

Browser acceptance sequence exercised: move 75.25 between categories; add 50.00 to a card reserve; return 20.00; reject overcommit with unchanged saved model; reload; post synthetic card purchase/refund/payment; reject stale revision; save another move and replay its identical key without another mutation; Tab between named controls; verify all three themes at desktop/390px phone width without horizontal overflow and with 44px+ inputs/buttons. Unit tests separately verify owner/token/demo/origin guards, unknown coverage and native financial semantics. Independent QA must rerun against the delivered commit; production authenticated integration remains the integration owner's gate.

## Transfer-pair integration dependency

The reviewed engine already persists exact confirmed pairs in owner-scoped `budget_engine_state.register_json` after successful refresh. Missing public readback is not missing storage. The smallest separate follow-up is an owner-scoped catalog reader that revalidates stored pair identities with the existing normalizer and supplies them to the next refresh, reporting changed/deleted/invalid pairs rather than silently clearing them. Do not call refresh with an unconditional empty array and do not infer pairs from matching amounts. This feature neither edits that shared seam nor repurposes transfer transactions.

## QA-M01 progressive enhancement correction

SSR must not disable a known-covered form based on selections that only client reactivity can observe. The native move button remains usable; HTML required/amount/date checks and the unchanged server/engine financial guards validate the submission. Native card forms use the direction-neutral `Update reserve` label, show explicitly named per-card summaries, and do not display a selected-direction limit that cannot change without JavaScript. After mount, the existing selection-sensitive disabled states, live limits and directional labels are enabled. Native submit handlers do not disable successful fields before the browser serializes them.

The guarded fixture supports `ATLAS_MOVE_NATIVE_FIXTURE=1` to seed real synthetic RTA=0/reserve=10000, `/__move-native` to SSR the actual components without hydration, and `move-money-fixture.html?native=1` to exercise hydrated components using ordinary browser POST instead of the optional async transport. `ui-preview/move-money-native-browser.mjs` accepts `PLAYWRIGHT_MODULE` and `EVIDENCE_DIR`, launches JavaScript-disabled and enabled Chrome contexts, and tests native move/release persistence, unchanged zero-RTA reserve-add rejection, hydrated touch add/release, and native POST field preservation. It imports an existing Playwright package read-only and closes its test browser. This is synthetic acceptance, not production authentication acceptance.

## Release boundary

No migration, engine rewrite, live data, credential or deployment change. The feature candidate requires integration-owner route wiring and independent review before release. Shared target editor/Home and historical-balance work proceed independently. Removing these new imports/actions reverses the UI integration without deleting the engine's durable allocation history; do not erase saved events as rollback.
