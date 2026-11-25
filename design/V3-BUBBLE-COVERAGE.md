# Filled-bubble acceptance — current scope, not release approval

Chris's highest visual priority is prominent filled bubbles and rounded grouped sections. Activity green inflows/red outflows describe direction, not Budget funding. Explicit signs/types distinguish refunds, transfers and unclassified inflows; pending/invalid allocation review stays visible. Category identity is independent and stable across themes, honors saved colors, and uses a stable ID fallback with readable black/white ink.

## Implemented source

- Shared amount/status/balance components: Home, Plan's legacy target/limit view, Reflect, Spending, Income, Activity, Accounts, account detail, transaction detail, category detail, recurring schedules and Cashflow summary. This is component coverage, not every field/state or final integrated approval.
- Current increment: Activity spending red, inflows green without inventing income classification, movement blue, signs separate from warning icons. Home QA-002 generic Recorded bubble replaced with the shared semantic renderer; fresh actual SSR and browser label regression covers refund/transfer/unclassified inflow/pending.
- Stable category identity: Activity's native editable/readonly category cells; Income/Spending category pills and corresponding category bars. Same category color independent of amount status, ordering and theme. No stored colors changed.
- Cashflow: grouped posted actuals versus scheduled expectations. Forecast bubbles neutral; neither difference is available cash. Native filter HTTP/network failures now show a recoverable error, retain submitted draft and permit manual retry. Mock failures only; no real save tested.

## Exact remaining bubble/UI coverage

1. **True budget funding:** W16 authoritative cash/target states, assignment/reallocation, card reserves, underfunded/overspent/unknown states, rollover, saved mutations and reload persistence are not wired yet. Current limit remainder must never be called funded.
2. **Calendar:** native agenda/month/event popup amounts and category treatments still need shared/context-aware bubble conversion and responsive interaction tests. A synthetic baseline route was added, not accepted as finished.
3. **Cashflow detail:** summary converted; native spreadsheet/category rows and contribution/schedule drilldowns still need consistent bubble treatment.
4. **Recurring discovery, import/review flows, customizable dashboard widgets and legacy Trends:** money/category presentation not yet fully converted or accepted. Redirect-only paths must be verified as such rather than marked styled by assumption.
5. **Category-identity propagation:** Home captions, account activity/ProductTransactions, Plan groups, transaction/category detail and ContributionList, scheduled/calendar/discovery rows and category-management listings remain outside the new shared identity component. The fresh stable-color guarantee is limited to Activity and Income/Spending category chart/list surfaces.
6. **History/reserve surfaces:** backend-covered net-worth evidence, missing coverage and cash-backed card-reserve UI remain pending integration.
7. **Forms and nonfinancial routes:** numeric edit fields need readable controls, not fake status pills. Settings/auth/security pages still require their full state/accessibility review; financial-status coverage is not applicable merely because no amount badge is present.
8. **All release acceptance:** W17 exact-source retest, integrated synthetic authenticated routes and persistence, real touch behavior, all themes/long values/error/empty/loading cases, private activation/rollback and signed-in real acceptance remain open.

## Evidence

`product-v3-planning/checks.json`: sixteen unique synthetic actual-component cases (Home, Activity, Spending, Cashflow × Graphite390/1440, Ocean390, Dark390). Six additional phone detail views of category charts and forecast panels are recorded in detail-checks.json and visually inspected alongside the sixteen main views. Filled backgrounds are measured, not text-color-only; category input and category chart bar use the same saved/fallback identity. Native category keyboard open/close and >=44px inputs verified for all three phone themes; no selection/save attempted. Contrast helper covers fallback and custom test colors, including a gray case that required true black/white ink. Final test/build fingerprints are in task `product-evidence/v3-planning-execution.json`.

A 36-route static traversal is recorded in `product-evidence/bubble-source-coverage.json`. It proves only component reachability, explicitly not complete runtime/state acceptance. Synthetic images contain invented fixture records and are never real finance evidence. No production/finance/vault mutation occurred.
