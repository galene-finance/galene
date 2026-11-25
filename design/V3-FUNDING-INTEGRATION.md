# Native funding integration — first slice, not release approval

## Source and ownership
W11 integrated W16 contract/engine/native replay commits through corrected d12791cef49536acd1d3cb82790e47ee60e46c75. W17's independent backend-d12791c/REPORT.md closes B01/B02 only. W11 has not changed backend-owned implementation files. Production remains untouched; real finance reads/writes still require the supported boundaries.

## Working native slice
- Plan loader reads the authoritative dashboard DTO. Filled funding bubbles distinguish available/funded, underfunded, empty, unknown, unbacked and overspending. Target met remains distinct from cash left. Unknown/unbacked does not display nominal cash as available. Legacy limit remainder is neutral, never funded green.
- Native assignment and posted-register refresh actions enforce owner context, same origin, bounded form bodies, safe amounts/IDs, civil dates, revision and idempotency. Assign/return is allocation, not payment. No baseline activation or invented cash is performed by a page load.
- Historical refresh preserves the maximum already-verified activity horizon. A regression caught shrinking February coverage while viewing January; the action now replays through the retained horizon. SQLite close/reopen and rejected-write invariants are tested.
- Plan uses active engine contribution totals when configured, otherwise existing monthly target intent. These totals are not available cash.
- Category links preserve the allocation cutoff. The native category loader returns the same authoritative funding state only for matching all-account date scope. Account-filtered or differently dated drilldowns never inherit an unrelated funding balance. Shared FundingAmount renders both views.
- Native source tests exercise assignment, exact retry, spending/staleness, refresh, refund, close/reopen, rejected overcommit/foreign category, owner/origin denial, and scoped drilldown agreement. Twelve actual-component tests consume W17's synthetic persisted DTO evidence and boundary states.

## Browser evidence and its limits
Task product-v3-funding-acceptance contains nine recorded transitions and eight unique Plan/category layouts: Graphite390/1440, Ocean390, Dark390. Browser controls exercised assignment, full-page reload, stale/unknown, spend-to-zero while target met, refund restoration, category link and return, rollover, and keyboard overcommit rejection without revision/balance change. Filled backgrounds and no horizontal overflow/runtime errors were measured. Contact sheets were inspected.

An earlier touch-emulated refresh succeeded in product-v3-funding-final. A later touch repeat hit a browser-driver timeout; readback confirmed no new revision. Do not call the latest candidate's touch acceptance complete. W17 must independently retest touch/keyboard and the final exact candidate.

The fixture is a real disposable SQLite database with actual native loaders/actions/service and actual components, reached through a test-only HTTP adapter. It uses a fixed synthetic owner context, NOT production session authentication. Its custom form transport resets successful forms, preserves failures, and fetches only two explicitly allowed same-origin fixture endpoints. Default previews still cannot reach app APIs. The fixture server requires an explicit synthetic flag, exact scratch DB path and Docker; no live data or credentials are mounted. Restart starts a fresh fixture. It is not a replacement for signed-in native SvelteKit HTTP acceptance.

## Explicit remaining scope
The target editor still uses legacy limits; actual cadence/due-date/version editing and legacy-draft adoption remain to be wired. Reallocation and card-reserve controls, source-backed net-worth history and captures, full register drilldowns in the fixture, all-screen polish/states, audit/upstream correction, final integrated review, encrypted rollback/migrations, private activation and exact-origin authenticated acceptance remain open. No all-features completion or release approval is implied by this slice.
