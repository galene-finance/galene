# Supporting-screen slice — integration handoff

## Scope and ownership

Base: `5fa12d90a965d03edb58388461e4f2906a2ba0c2`. Isolated branch `atlas/w19-supporting`.

Application delta only:
- `src/routes/(app)/cashflow/+page.svelte`
- `src/routes/(app)/calendar/+page.svelte`

Verification-only additions: `supporting-qa/{index.html,main.ts,vite.config.ts,browser-check.mjs}` and this document. No backend, shared CSS/tokens, history, reserve, budget, target, navigation or existing preview files changed. No new dependencies. Integration/release owner alone applies this commit; independent reviewer must assess the final combined candidate.

## User-visible changes

Cashflow detail lists retain the name on the LEFT with the date directly beneath it, now including year and semantic `time` markup. Amounts remain on the RIGHT. Long names wrap rather than being silently truncated. Actual contribution badges distinguish included spending, refunds, income, and income reversals using existing filled FinancialBadge tokens. Scheduled amounts remain explicitly neutral expectations, never funded/received cash. The four existing table drilldown button variants now have 44px minimum targets and a visible keyboard focus outline. No financial aggregation, category identity or source semantics changed.

Calendar's week selector is a group of ordinary pressed-state buttons, not an incomplete ARIA tablist lacking tab panels/arrow-key behavior. Escape explicitly dismisses the information popup and clears its accessible description. Existing date selection, schedule forms, tap behavior and month navigation are retained.

Accounts, Activity and Settings were inspected and smoke-tested without redesign or edits.

## Verification and boundaries

`supporting-qa` mounts the ACTUAL route components using the retained synthetic fixtures and aliases. It never mounts financial data or credentials. Fetches other than empty synthetic notifications throw; form submissions are stopped. Failed filter save tests therefore exercise actual error/recovery UI, not successful persistence. No successful save or authenticated acceptance is claimed.

Run with a loopback-published Vite listener, dependencies available read-only, writable disposable Vite/Svelte caches. Use a disposable execution copy for `bun run build`.

```sh
bun x --no-install svelte-kit sync
bun run check
# isolated container only; DATA_DIR must point to disposable synthetic storage
GALENE_ALLOW_EPHEMERAL_DATA=1 DATA_DIR=/scratch/w19-suite bun test
bun run build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs QA_ORIGIN=http://127.0.0.1:24869 QA_OUTPUT=/absolute/evidence/after node supporting-qa/browser-check.mjs
```

The browser matrix covers Graphite/Ocean/Dark × 390px touch / 1280px keyboard desktop: actual/refund badge meaning, date-under-name geometry, linked posted activity scope, neutral forecast details, dialog open/close, failed filter save and recovery, calendar selection/empty day/form, trusted emulated touch, Accounts search/empty/detail navigation, Activity empty/detail, Settings destination and overflow. Screenshots are written per theme/size; inspect them, not only JSON results.

Baseline red evidence: missing filled Cashflow contribution badges and incorrect Calendar tab semantics. Early harness issues (missing disposable mountpoint, unavailable bundled Chromium, immediate dialog-transition assertion) were corrected without changing application behavior. System Chrome is used in an isolated headless browser context. An initial suite invocation lacked the synthetic ephemeral database flag; rerun with the proper disposable DATA_DIR passed. Do not treat that setup failure as a product regression.

## Integration gates

- Cherry-pick application and QA/doc delta, not any synthetic results or execution directory.
- Re-run the integrator's whole-app check/build/suite and the browser matrix against the final combined tree.
- Independent review by the existing reviewer remains required. Author checks are not independent approval.
- Physical Safari/phone, authenticated app navigation and persistence, and deployment are NOT covered. No production changes occurred.
- Docs review: existing operator docs need no change; no configuration/API/accounting behavior changed.
