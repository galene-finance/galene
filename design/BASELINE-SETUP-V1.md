# Baseline/account-scope setup — feature integration contract

Base: `799f61db90ae6093f73ce65400e836ed452ebd30`. Isolated feature; no shared route/style, existing engine, schema or deployment change.

## Ownership

New files only:
- `src/lib/components/BaselineAccountSetup.svelte`
- `src/lib/baselineSetupTypes.ts`
- `src/lib/server/baselineSetupFeature.ts`
- `src/lib/server/baselineSetupFeature.test.ts`
- `src/lib/server/baselineSetupConcurrency.test.ts`
- `src/lib/server/baselineSetupControls.test.ts`
- `ui-preview/baseline-setup-fixture-server.ts`
- `ui-preview/baseline-setup-browser.mjs`
- this document

## Trusted evidence and cutoff

`BaselineCatalog` is a synchronous server-side resolver `(ownerId, civilDate) => readonly BaselineEvidence[]`, or `null` when no approved source exists. It must return already approved immutable local records, not fetch a network provider while holding a database lock. A record binds its reference, owner, account, currency, integer-cent balance, civil end-of-day date, timezone, actual/accepted-estimate classification, source description and canonical UTC `recordedAt` timestamp.

**Do not manufacture this catalog from current balances, browser amount fields, a bare owner checkbox, or generic history snapshots whose cutoff is unspecified.** An instant snapshot is not end-of-day evidence. The server requires `cutoff: 'end_of_day'`, matching date and trusted timezone, and capture after the day closed but not in the future. `clock.now` is a canonical ISO UTC timestamp including milliseconds; `clock.timeZone` is the server-selected accounting timezone. The latest eligible date is calculated in that timezone, not the browser's locale or UTC by assumption.

The feature does not create/import source evidence or claim a live provider is configured. Supply a reviewed owner-bound closing-statement/capture resolver; until then, pass `null` and show the honest missing-evidence state. Accepted estimates remain visibly estimated and retain their approved provenance. No currency conversion is inferred. All current owner accounts must be included; tracking means excluded from spendable budget cash, not omitted from coverage.

## Read → review → confirm

`baselineSetupModel(database, ownerId, date, catalog, clock)` reads one consistent snapshot. It returns current revision and account-roster fingerprint, each account's approved source offers/missing state, and any already-active opening baseline. Current account balance fields are never used as opening balances. Already-active setup is read-only; there is no reset control.

`baselineSetupAction({database,catalog,clock,locals,request,url,demo?})` handles POST only and returns `BaselineSetupResult`. The route supplies authenticated locals. The adapter refuses anonymous/viewer/token/demo contexts and wrong-origin submissions, limits body size, rejects duplicate/unexpected fields, and does not accept posted balance/currency/owner claims.

The first `stage=review` validates account scopes, complete sources, one currency and the completed-day cutoff. It calls the existing pure ledger projector for opening cash/unassigned amounts. It creates no engine state or financial write. The review renders date, timezone, each account's role, source label and amount, then requires explicit confirmation.

`stage=activate` includes the reviewed-content fingerprint and `confirm=end-of-day`. Under one SQLite IMMEDIATE transaction it rechecks the roster, resolves current approved evidence, rebuilds the canonical payload/digest and invokes existing `BudgetEngine.activate`. The digest detects changed reviewed content; it is **not an authentication token or proof of permission**. Existing owner/Origin/engine guards provide that boundary. The existing revision/receipt protocol resolves concurrent writers and exact retries. An identical original retry may return its old receipt after later allocation writes, without replaying or erasing them. A new key cannot reset an active baseline.

Activation stores only the engine baseline and receipt. It does not rewrite native account balances, transactions, categories, targets, history snapshots or scopes in native account metadata. Initial payment reserves are not fabricated. After activation, W11 must use its verified-pair-aware native coverage refresh and preserve existing transfer evidence before presenting current spendable amounts.

## Proposed W11 shared-route wiring — not applied here

Mount once in an owner-only setup page or the existing Budget setup region. Preserve all existing routes/actions. For example:

```ts
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { productOwner } from '$lib/server/productAccess';
import { baselineClosedDate, baselineSetupModel, baselineSetupAction } from '$lib/server/baselineSetupFeature';

// Existing owner-scoped load; supply real reviewed server config/resolver.
const ownerId = productOwner(locals);
const clock = { now: new Date().toISOString(), timeZone: accountingTimeZone };
const date = url.searchParams.get('baseline_date') ?? baselineClosedDate(clock);
const setup = baselineSetupModel(db(), ownerId, date, approvedClosingCatalog, clock);
// Add setup + commandKey to the existing returned data, do not replace it.

// Add to existing actions; approvedClosingCatalog may be null (fail closed).
baselineSetup: async (event) => {
  const result = await baselineSetupAction({
    database: db(), catalog: approvedClosingCatalog,
    clock: { now: new Date().toISOString(), timeZone: accountingTimeZone },
    locals: event.locals, request: event.request, url: event.url
  });
  return result.ok ? result : fail(result.status, result);
}
```

```svelte
<BaselineAccountSetup
 model={data.setup}
 commandKey={data.commandKey}
 form={baselineForm}
 action="?/baselineSetup"
 loadAction="/budget/setup"
/>
```

The route path is a proposal for W11, not an installed route. Narrow the existing form union by `feature === 'baselineSetup'`, preserve all other action-result types, and keep session/demo/CSRF/permission policies. Pass `loadAction` for the actual chosen setup page; native GET date selection must reach that loader. No hydration-specific event handler is required: the component uses genuine native review/confirmation forms, and the required checkbox works with JavaScript disabled. Shared layout already owns `product.css` and theme selection.

Catch invalid GET dates with the app's ordinary input-error handling rather than silently coercing them. Mint a new command key when beginning a new review, not while replaying an uncertain confirmation. Read back active setup before proposing another attempt.

## Synthetic fixture and reproducible browser acceptance

The fixture refuses startup unless Docker is detected, `ATLAS_SYNTHETIC_BASELINE_QA=1`, and `GALENE_DB_PATH=/scratch/baseline-setup.sqlite`. Run the candidate and existing dependency tree read-only, tmpfs `/scratch`, and bind host **loopback only** `127.0.0.1:24868:5174`. Entry point:

    bun run ui-preview/baseline-setup-fixture-server.ts

It SSR-compiles the actual component with the real theme/product styles and calls the actual adapter/engine. It opens/closes synthetic SQLite on every request. Three explicitly synthetic principals separate no-JS, JS/touch and layout cases; these are not production authentication acceptance.

With a read-only installed Playwright module and a new evidence directory:

    PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
    EVIDENCE_DIR=/absolute/qa/evidence \
    node ui-preview/baseline-setup-browser.mjs

Use a fresh disposable scratch database for the full run. It verifies missing-source gating, native selections, non-mutating preview, required confirmation, saved/reloaded scopes and amounts, exact replay without another mutation, preserved native accounts/transactions, no reset form, and Graphite/Ocean/Dark layouts at 390px and 1280px. Source unit tests additionally cover malformed/foreign/current/future/incomplete evidence, source/roster drift, unexpected balance fields, timezone/leap boundaries and retained targets/allocations. The concurrency test uses two real SQLite writer processes, not two sequential calls.

## Remaining gates / rollback

This is implemented feature code, not live activation. W11 must wire the shared route and the approved evidence resolver; W17 must independently retest the exact feature commit and assembled application. Missing approved closing records are a data/provider prerequisite, not permission to infer history. Do not activate a live baseline as a test. UI integration can be backed out by removing only these imports/action bindings; never delete engine history or replace baseline JSON as rollback.
