# Galene product system — W11

Decision date: 2026-11-24. Full product redesign authorized. This is an implementation contract, not the delivered result. Existing live release remains available until replacement passes gates.

## Product principles

One shared native Galene dataset, no new ledger/importer. Professional daily-use tool, not a landing page or dashboard of generic cards. Show the meaning, date scope and source of each financial number. A figure must link to its contributing records. Preserve feeds and accepted MMI estimates; YNAB supplies the budget template only, Apple is the narrow balance-sourcing exception. No unverified spendable-cash or net-worth claim.

## Route map

- Overview `/`: current period review, recorded income/spending, review attention, account sources and next expectations; links into every relevant detail. Native customization retained through a secondary customize control.
- Budget `/budget`: grouped spending limits versus classified actuals, period/limit semantics visible, category drilldown. Not an envelope allocation engine.
- Accounts `/accounts`: cash/debt/investments grouped, provider snapshot and ledger shown distinctly with dates. Detail `/accounts/[id]`: provenance, coverage and scoped transaction register; no invented balance history.
- Activity `/transactions`: native searchable/filterable/sortable register and existing edit/split affordances. Detail `/transactions/[id]`: full transaction attributes, related account/category, pending/source/notes and native edit route.
- Insights `/spending` and `/income`: shared period selector and accounting classifier; accessible comparison bars and category/payee rows that drill into contributing transactions. Uncategorized and transfers separated from true earnings/spend.
- Recurring `/scheduled`: explicit income/expense/transfer labels, cadence and forecast timing, filters; drill into native schedule editor/calendar. `/recurring` remains discovery, not synonym for confirmed bills.
- Cash flow `/cashflow`: actuals versus expectations explicitly separated; account movement and income/expense semantics not silently mixed. Calendar remains secondary schedule view.
- Settings `/settings/*`: existing native tools preserved, subordinate navigation rather than hiding ordinary accounts here.

## Navigation

Desktop: persistent 224px leading navigation grouped into Daily (Overview, Activity, Budget, Accounts), Insights (Spending, Income, Cash flow), Planning (Recurring, Calendar), Settings. Compact: four persistent labeled destinations Overview, Activity, Budget, Accounts; Insights/Planning accessible through explicit top menu, not an overloaded fifth More tab. Preserve URL state on drilldown/back. Current state uses aria-current and shape/text, not color alone. Keyboard-visible skip link.

## Component contract

- Button variants: primary, secondary, quiet, danger; standard 40px desktop / 44px touch minimum, compact icon button separately declared 36px desktop with accessible name. Hover only hover-capable devices; focus-visible 2px ring+offset; pressed surface; disabled native attribute + explanatory copy if non-obvious; loading preserves dimensions and labels progress.
- Navigation link: default/current. Same typography and icon width on all routes. Focus visible, real anchors.
- Field: label, input/select, description/error; one consistent border/radius and no placeholder-only labels. Error linked via aria-describedby; busy state doesn't erase input.
- Page header: title, succinct explanatory scope, contextual action and period/filter toolbar. No huge hero metrics or uppercase eyebrow stack.
- Data table/list: selectable/sortable column headings; tabular right-aligned values; sticky header verified after scrolling; mobile readable priority columns with explicit detail links. No CSS-hidden essential values.
- Summary strip: compact named quantities with period and definition; each drillable value is an anchor. Missing/unknown is not zero.
- Status: neutral/source, success, attention, destructive; text/icon redundancy, no red/green-only meaning.
- Detail panel: wide two-column information, narrow stacked rows; transaction/schedule dialog remains native with focus trap and Escape restoration.
- Chart: bar/line with textual equivalent and real links; no fake history, decorative rings or pointer-only drilldown.

All content surfaces require default, empty (reason+next action), loading (stable skeleton/aria-busy), error (plain explanation+retry), and stale/partial (preserve data+as-of) states. Never fabricate real data for production or authenticated acceptance. Synthetic fixtures are only for isolated tests/previews.

## Visual commitment

Moment of care: any surprising number leads to an explanation and the exact contributing records without losing the date/filter scope.
Color: restrained blue at approximately OKLCH 0.49 0.16 255; near-neutral light page L≈0.97, white panels, ink/navy text. Dark mode uses layered neutral surfaces, not glowing neon. Semantic greens/reds confined to directional meaning with text. Measured contrast >=4.5 body, >=3 large/nontext essential controls.
Type: local system humanist sans (-apple-system/BlinkMacSystemFont/Segoe UI), tabular numeric alignment; no external font/tracker or decorative serif. Compact typography scale 12/14/16/20/28px, consistent line heights.
Structure: sidebar plus clear horizontal page hierarchy; generous but not oversized whitespace, purposeful rows and separators rather than identical cards.
Motion: short 120–180ms opacity/color; no scroll choreography, transition:all, animated financial counts or layout shift. Reduced motion supported.
Reflexes rejected: fintech gradient/card mosaic; alternative terminal-dark neon; huge metric tiles and monospaced uppercase labels. Intentionally choose bright calm working pages and dense readable financial rows.

## Accounting acceptance matrix

- Positive income category is income regardless of internal forecast_behavior='bill'. 'bill' means on-date timing and is presented as 'On scheduled date'.
- Category expense refund reduces spending, not earnings; negative income reversals reduce income.
- Transfers and card payments excluded from income/spending summaries, still visible in account movements and obligation planning.
- Uncategorized positive activity is not silently called earned income; show review/coverage explicitly.
- Default posted-only summaries exclude pending; include-pending views label both scope and amounts.
- Splits counted exactly once by signed category portions, never parent plus children.
- All date ranges use shared inclusive UI/end-exclusive query conversion and consistent timezone/local calendar boundaries.
- Dashboard, insights, budget category details and transaction drilldowns agree under equal scope; schedule estimates never add to actuals.
- Loan principal/provider balances not derived by summing incomplete history. MMI fee/principal allocation not duplicated. Current accepted debt estimates remain labeled by source/date.
- No unsupported net worth, available-to-spend or funded savings total.

## Current research → decisions

1. Copilot, Cash Flow Tab Overview (official, read 2026-11-24): separates income/spending/net, period comparison and category/transaction drilldown; actuals exclude future/unpaid expectations. Adopt linked metrics and explicit actual/forecast split, not its exact skin. https://help.copilot.money/en/articles/9682232-cash-flow-tab-overview
2. Monarch, Transfers and Credit Card Payments (official): transfers/payments excluded from spending/budget totals to prevent double-counting. Adopt explicit movement semantics and scope explanations. https://help.monarchmoney.com/hc/en-us/articles/360048393292-Transfers
3. Actual Budget, How Budgeting Works (official): real-money envelope funding is different from forecast/limit budgeting. Do NOT claim Galene limits are funded envelopes. https://actualbudget.org/docs/budgeting/
4. YNAB, How to Use Targets (official): targets differ from assigned/available, include recurring/date-bound behaviors. Preserve amount/cadence meaning, do not flatten all targets. https://support.ynab.com/en_us/how-to-use-targets-rk5kkI9ks.md
5. Buckets, Categories/Method/Bucket Types (official): income and transfers distinct; date-goal and recurring bucket types not interchangeable. Use explicit types and preserve expectations versus cash. https://docs.budgetwithbuckets.com/app/categorizing/ ; https://docs.budgetwithbuckets.com/app/buckets/
6. Apple HIG Sidebars and Tab Bars (official, current June 2026 guidance): sidebar when width allows, stable labeled top-level destinations on compact screens; tabs navigate, not execute actions. Adopt responsive shell without requiring glass effects. https://developer.apple.com/design/human-interface-guidelines/sidebars ; https://developer.apple.com/design/human-interface-guidelines/tab-bars
7. Material 3 Breakpoints (official): adapt structure/panes at meaningful widths, not simply shrink content. Adopt deliberate compact/medium/expanded layouts. https://m3.material.io/foundations/layout/breakpoints/window-size-classes
8. W3C WCAG 2.2 quickref (official): text alternatives, focus, reflow, contrast, target sizing, semantic status/error. Validate with keyboard, 320/390/768/1440px layouts, contrast calculations and automated checks. https://www.w3.org/WAI/WCAG22/quickref/
9. Galene Calendar docs (official): schedules are expectations not transactions, newer upstream has occurrence/match support. Verify installed source before claiming those newer features; do not upgrade schema just for a visual refresh. https://docs.galene.finance/features/calendar/

## Upstream feedback (verified authenticated gh reads)

Issue https://github.com/galene-finance/galene/issues/225 points to PR https://github.com/galene-finance/galene/pull/226. Nov24 CHANGES_REQUESTED by galene-bot at head 3f149380f97d7fab53acea59258e918e1e1e985a:
- Remove shared hooks/resolveApiBearer delta from public PR (maintainers will handle separately).
- Order-based dashboard PUT: validate id/type/w/h/filters, ignore positions, normalize; stale request gets 409/current revision.
- Reuse themes/icons/dashboard/writeApi helpers; allow native radius range; Object.hasOwn catalog validation; sanitized validation messages; smaller body cap.
- Rebase onto test, preferably one commit; fix docs 400/422, clarify no new MCP tools, add changelog.
Prepare separate local upstream branch/diff; do not publish without authorization. Do not blindly remove live local auth protections because public PR scope changes.

## Release gate

Working native routes/data, regressions+build, independent final-source review, isolated synthetic cross-route visual checks, exact private deployment+rollback, then signed-in desktop/phone real-data interaction. Current verified browser is logged out; refresh approved vault path, coordinate exact owner sign-in only if required. Never call a mock or authenticated API read a signed-in UI acceptance.
