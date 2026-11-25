# Galene product system — W11

## Expanded domain scope — active owner instruction

All three are now required: irregular/annual/due-date targets; real cash-backed allocation/reallocation with credit-card payment reserves; and provenance/coverage-aware net-worth history. This supersedes any older non-envelope/no-new-ledger exclusion below. Existing transactions/import history and MMI/Apple sources remain preserved; legacy budgets become targets, never automatic funded assignments.

W16 owns isolated domain types/services/calculations/migrations; W11 owns UI/routes/integration and sole production activation; W17 owns isolated QA/review. Versioned backend contract starts at `design/BUDGET-ENGINE-V1.md`; definitive handoff is `design/BUDGET-ENGINE-INTEGRATION-V1.md` on W16 candidate48442039272d6ecde3fe56e12b57fe48859c4658, based on b4ec94a. Handoff/test success is not integration, release or activation approval. UI must consume authoritative typed requirements, available cash, assignments/reserves and history coverage rather than derive them from legacy limits or guess missing amounts. Contract questions on normalized transaction rebuilds, all-writer revisions, activation cutoff, currency and calendar policy remain explicit gates.

## V3 visual contract — 2026-11-25 owner revision

The functioning v2 baseline is retained; its aesthetics/visual acceptance are superseded. Chris approved heavy YNAB inspiration, not a literal clone. Current source research and screenshot observations: YNAB-RESEARCH.md. Same integration task/deployment owner. Existing transaction/import history is preserved; the new allocation ledger is additive under the expanded scope. All older financial safety requirements remain active.

### Routes and shared layouts

- Home `/`: current monthly plan (Cost to be me), recorded actuals, source-aware cash/debt summaries, review attention and next outgoing obligations. No prominent expected-wage metric. A plan target is not money available.
- Plan `/budget`: grouped current targets/limits, classified actuals and clearly labeled remaining-to-limit/over-limit states. Show categories without a target; grouped totals must not be added again to their children. Native create/edit/delete remains functional. Historical actuals must not imply stored historical target versions.
- Activity `/transactions` and detail `/transactions/[id]`: grouped native register, filters/search/sort, split/native edits and visible error recovery; shared row anatomy with date beneath description/category.
- Reflect `/reflect`: reporting entry with segmented Breakdown, Trends and Income vs Spending views. Reuse shared actuals/contributions. Existing `/spending`, `/income` and contribution/category routes retain meaningful navigation and back/filter scope; no unsupported net-worth history.
- Accounts `/accounts`, `/accounts/[id]`: shared grouped surfaces, exact source/as-of distinctions, related activity. Balances are not automatically spendable cash.
- Planning `/scheduled`, `/recurring`, `/calendar`, `/cashflow`: retained valid schedules/history/discovery and native editors; positive expectations stay explicitly forecast and out of actuals. Cash-flow expectations belong here, not in actual-only Reflect totals.
- Native `/settings/*`, `/customize`, authentication and remaining utilities: same tokens, headers, forms, dialogs, statuses and responsive spacing. Do not remove a native operation merely to simplify the navigation.

Primary navigation is consistently Home, Plan, Activity, Reflect, Accounts (desktop sidebar; five labeled compact tabs). Scheduled/Calendar/Settings and retained utilities are secondary destinations. Segment controls switch real views, not decoration; URL state/back works. Sidebars/inspectors become sheets or stacked detail on compact layouts without hiding necessary values.

### Component inventory and state budget

- Buttons: primary / secondary / quiet / danger / icon (5 variants); 44px touch target, named icon controls.
- Navigation: primary destination / secondary destination (2); segmented view control (1 component), all with semantic current/selected state.
- Surface: page / grouped section / inset detail / dialog (4); rounded grouped sections are intentional repeated product structure, not a decorative marketing-card grid.
- Field: input / select / textarea (3); one consistent label, help/error, focus and disabled recipe.
- Ledger row: normal / selectable (2); category/source/status tokens shared with all list/detail surfaces. Date always under identifying content, never tucked under amount.
- Highest visual acceptance priority: prominent filled amount bubbles and rounded grouped sections. Activity uses green inflows/red outflows with sign/type labels, distinct transfers/refunds and explicit pending/review states; Budget uses real funded/underfunded/overspent states from the engine, never limit remainder. Category identity is separate: saved colors or a stable ID-based palette, consistent across lists/charts/themes. Do not impose universal red/green meanings across tabs. Preserve readable labels/icons and test actual computed fill, keyboard/touch, persisted mutations and scoped drilldowns.
- Chart: shared chart frame, legend, empty/error/partial state and linked textual contribution list. Report types share period/filter controls and signed arithmetic.

Every interactive variant has default, hover (hover-capable devices only), focus-visible, pressed, disabled-with-reason, in-place loading, selected/current, empty-next-action and local error/retry states as applicable. Partial data stays visible with source/as-of context. Preserve native dialog focus/Escape restoration and server validation feedback. No animated counters or invented values.

### Visual commitment

Graphite leads/default: preserve its existing neutral charcoal family (page #111315, panel #1a1d20, inset #23272b) and restrained warm action accent. Ocean keeps its blue-black character; Dark remains a distinct polished alternative. Existing nonselected/custom themes are not deleted or silently overwritten. Default selection, persisted owner preference and signed-out fallback must be tested separately.

Use local platform system sans, tabular amounts, 12/14/16/20/28px roles. Section radii around 18–22px; fields/buttons around 10–12px; true pill radii for status. Layering comes from meaningful surface contrast and grouping, not gradients/glass/glow. Layout is an asymmetric working pane with an optional inspector, never a generic tile grid. Motion budget: no scroll choreography, only brief 120–180ms state transitions and reduced-motion support.

Moment of care: tap a surprising number or badge and reach the explanation/contributing records without losing context. Deliberately retain Graphite dark/amber because Chris selected it, not as an automatic aesthetic reflex (auteur-allow: selected dark palette/action accent). Reject mono service labels, huge hero metrics, glow, generic fintech gradients and decorative empty cards. Native grouped rows and meaningful color-filled pills are a deliberate owner requirement, not decorative repeated cards.

### Legacy planning arithmetic until the new domain contract is integrated

Cost to be me totals each valid current monthly planning target once; income targets are not a cost. It is unaffected by spending, refunds, current balances, forecast wages or funding fields. Monthly movement/payment targets can express planned commitments without becoming spending. Separate nonmonthly cadence unless a documented native rule can produce its current-month requirement; do not silently annualize or invent due dates. Do not blindly add schedules to limits: obligations may already overlap targets, including mixed fee/principal payments. Show schedules separately with scope, preserving all history. Missing/invalid targets are explicit, not invented zero-cost or funded amounts.

Received-income actuals use posted income contributions, not schedules. Preserve refund/reversal signs, pending/movement exclusion and partial-history signals. No spendable metric unless its actual source semantics support it. Existing working MMI/Apple values remain clearly sourced, never forced into agreement with incomplete ledger history.

### Acceptance

Inventory every route/component/state before broad implementation. Follow failing-first pure planning/theme/state tests, existing accounting regressions, native actions, build and exact-source independent review. Inspect Graphite/Ocean/Dark at 390/768/1440 (plus narrow reflow); keyboard/contrast/dialog/scroll and persistence checks. Private activation only with verified rollback and exact artifact identity. Saved exact-origin Bitwarden login exists, but authoritative readiness is still a hard gate: no secret handling/bypass or repeated enrollment request. Synthetic previews are not authenticated acceptance.

## Retained v2 notes — historical visual specification

The following source/research/financial notes are preserved for provenance. The V3 route, navigation and visual contract above supersedes conflicting visual choices below.

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
