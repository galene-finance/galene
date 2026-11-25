# V3 core integration checkpoint

## Implemented, not deployed

- Five real primary destinations: Home, Plan, Activity, Reflect, Accounts. Original recurring/calendar/cashflow/widgets/detailed-trends/settings routes remain reachable.
- Home uses the tested current monthly target total. Its payment preview excludes positive wage expectations without deleting schedules. Actual income/spending remain posted-activity figures, not available cash; balances retain their source/date labels.
- Plan groups native targets by category parent and cadence, separates income goals, shows filled category/amount states, and retains the existing native editor/actions. No ledger or target values were changed by this work. Movement targets are displayed honestly but remain outside the inherited form's editing support.
- Reflect is a real owner-only route with summary and full-month trends. Spending and Income share its segmented navigation and scoped contribution links. Mixed transactions show only matching contributions, with the full-transaction amount separately identified.
- Fixed account filtering in historical series and preserved account scope in month selection/drilldowns. Full-month history now ends at a custom range's end month rather than its start month.
- Graphite/Ocean/Dark share the revised radius; Ocean's primary foreground now meets the tested contrast threshold. Native control color-scheme follows the theme so date-picker icons remain visible. Theme presentation leads with the chosen trio without changing the legacy Light normalization base or deleting custom choices.

## Evidence

- Focused set: 72 pass, 0 fail, 301 expects across eight files.
- Compiler: zero errors, zero warnings.
- Full suite: 303 pass, four OFX-import failures. A clean immutable a917c20 baseline run reproduces exactly the same four names (287 pass, four fail). A read-only independent diagnosis is pending; unchanged failures are not silently waived.
- 18 instrumented synthetic component cases: six views (Home, Plan, Reflect summary/trends, Spending, Income) at 390/1440 in Graphite, plus Home/Plan/Reflect at 390 in Ocean/Dark. The matrix measured no horizontal page overflow and no captured runtime errors. The recorder was verified with controlled uncaught-error and unhandled-rejection probes; earlier uninstrumented zero-fallback observations are superseded.
- Inspected phone/desktop core compositions, three-theme Plan comparison and native target editor. Condensed the mobile Plan after visual review put the first target too far down. Subsequent control check confirms 44px whole-label date target, native dark controls, correct parent-section ARIA and retained account scope when navigating to Spending.
- Evidence artifacts are in the task workspace's `product-v3-core/` and `product-evidence/v3-core-final-*` files. These are synthetic checks, not real signed-in acceptance. The final dark-control/compact-field check supplements the preceding matrix.
- Route inventory now matches all 36 actual page files. Core coverage remains explicitly partial: full theme/tablet/state coverage and authenticated acceptance are still open.

## Next work and retained constraints

Complete Activity/account/category/transaction detail treatment, remaining utilities/settings/auth surfaces, native form/error/keyboard states, and the full route matrix. Native editor controls still need the common form-accessibility pass. Preserve all existing features and data; do not mistake inherited styling or compilation for all-screen acceptance.

Continue the permitted financial audit, including coverage of monthly cost targets against accepted obligations and fee/principal treatment. The current figure is deliberately a target total, not a claim that every cash commitment is represented. Do not blindly add schedules, double-count obligations or silently annualize limits. Retain accepted MMI/Apple sourcing and the unpublished upstream correction.

No production activation, live preference change, financial mutation, public publication or credential use occurred in this pass. Full exact-source review, fresh encrypted external rollback, coordinated activation and authenticated persistence checks remain required.
