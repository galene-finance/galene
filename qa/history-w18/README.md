# W18 history feature — synthetic integration handoff

## Scope and ownership

Base: `5fa12d90a965d03edb58388461e4f2906a2ba0c2`. This slice adds only:

- `src/lib/components/HistoryOverview.svelte`
- `src/lib/components/HistoryCaptureControls.svelte`
- `src/lib/historyOverview.ts`
- `src/lib/historyOverview.test.ts`
- `src/lib/historyOverviewComponent.test.ts`
- `src/lib/server/historyOverviewAdapter.ts`
- `src/lib/server/historyOverviewAdapter.test.ts`
- `qa/history-w18/{fixture.ts,server.ts,browser.mjs,README.md}`

No shared route, stylesheet, schema, existing test harness, source integration or live deployment change. W11 alone integrates and deploys; W17 reviews the immutable candidate. All example balances are synthetic. The server adapter wraps the existing engine; it adds no schema, importer, provider or HTTP production route.

## Proposed Reflect wiring — W11 only

1. Add a **Net worth** entry to existing `ReflectTabs` linking to `/reflect?view=net-worth`, preserving selected account/date filters. Do not replace existing income/spending trends. Render `HistoryOverview` for this branch of the Reflect route, with normal shell/nav/title.
2. In the authenticated server loader, retain native session/read-only-user policies. Construct `BudgetEngine(db, authenticatedOwnerId)` and `HistoryAccess` from server authorization only. An owner-wide engine must never be given to an account-limited/read-only identity. Do not accept owner IDs or access booleans from requests.
3. Explicitly derive `HistoryAccount[]` from the authorized owner roster and selected account scope. Include debt/tracking accounts where appropriate; never infer historical account inclusion dates from today's roster. Account labels supplied to the component must describe the **same included scope**. If historical inclusion is unknown, retain visible gaps rather than silently dropping the account. Pass explicit known `fromDate/throughDate` only where evidence supports them.
4. Parse `date_from/date_to` with `historyDates` (1–366 civil UTC days). Default to a bounded recent period using the trusted server clock. Pass `maxDate`, `from`, `to`, `action='/reflect'`, and `queryFields` containing `view=net-worth` and the authorized account filter. Civil UTC dates deliberately match the existing engine's snapshot bucketing; no local-midnight reinterpretation. Use `loadHistoryOverview(engine, access, scope, from, to)` and pass the returned points unchanged. Catch rejected mixed-currency/invalid ranges into a plain error state; do not sum, convert, zero-fill or interpolate. The presentation additionally refuses cross-date currency comparison.
5. Render `HistoryCaptureControls` disabled by default (`canCapture=false` / no offers). **The integrated base has no source-bound capture provider or production route.** `recordSnapshot` exists, but its existence alone is not enough to enable capture. Reads must never call it.
6. Only an approved durable source-update path can prepare an immutable evidence reference. The server resolver must bind it to the authenticated owner, source-specific account mapping, original amount/currency/as-of timestamp, accepted-estimate method, recorded-at timestamp, and immutable `sourceKey`. It must not synthesize history from today's balance, change a recorded timestamp on retries, or replace accepted debt provenance with another feed. A reconstructed record is displayed but cannot be manually captured through these controls.
7. For such a supported offer, use `historyCaptureOffer(...)` to project its review details. Pass a fresh server UUID `commandKey`, current engine revision, explicit native POST action (`?/captureHistory`), and authorized `canCapture`. Keep reference+commandKey combined under the engine's 200-character idempotency-key limit. A reference is an opaque server-side lookup key, **not an authority token**.
8. Proposed native action (pseudocode, not an installed route): enforce existing session, demo, write-toggle, CSRF/origin and request-size guards **before** any resolver/write. Then `captureHistoryOverview(engine, access, await request.formData(), ownerBoundResolver, trustedNowISO)`. Only `history_offer`, `revision`, `key` are allowed. Preserve exact payload/key on ambiguous retry; stale revisions require a reload and new intent. Never accept amounts, account IDs, timestamps, currencies or source labels from the browser.
9. Return/redirect through the native loader and show a success message only after durable capture/readback; errors remain visible. Preserve selected dates/account filters in the action/redirect. The adapter returns the receipt and account-day readback; the normal loader recomputes the **whole selected scope**. A successful capture need not make net worth complete, and an older captured record may not supersede newer evidence on that day.
10. Preserve no-JS native form behavior. No freeform balance editing or arbitrary historical reconstruction endpoint belongs in this slice. Run final native-route session/CSRF/owner/demo/write-toggle tests after integration, plus authenticated browser acceptance. The synthetic preview is not proof of production authentication.

## Executable synthetic UI

Requirements: pinned repo dependencies, Bun 1.4.0 (tested), Chrome for the host Playwright runner. All SQLite is disposable, no credentials/production volumes. From this candidate root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun x --no-install svelte-kit sync
HISTORY_SYNTHETIC_DIR=<new-disposable-directory> PORT=4198 bun qa/history-w18/server.ts
HISTORY_EVIDENCE_DIR=<evidence-directory> node qa/history-w18/browser.mjs
```

Default listener is loopback. For a container, use `HISTORY_CONTAINER=1`, `PORT=4198`, read-only source mount, tmpfs `/scratch`, `HISTORY_SYNTHETIC_DIR=/scratch`, and **publish only `127.0.0.1:4198:4198`**. The retained test image may have an inherited `PORT=3000`; override explicitly. Do not mount any real database/config/credentials. The preview closes and reopens SQLite on each request and renders the actual two Svelte components plus the actual shared badge and theme/product CSS. It does not fetch or mock live APIs. Its synthetic principal/origin guard is deliberately separate from native production session acceptance.

Run the browser suite against a **fresh synthetic database**, because it intentionally persists a capture. It tests nine theme/viewport combinations (390, 768, 1440), native Enter disclosure, native date validation and GET filters, native touch POST, full browser reload, negative total, readonly/unsupported/denied modes, mixed currencies, and origin rejection. Screenshots and results JSON go only to the selected evidence directory. Modes: `?mode=mixed`, `readonly`, `unsupported`, `empty`, `denied`.

## Verification commands and results

```sh
bun test src/lib/historyOverview.test.ts src/lib/historyOverviewComponent.test.ts src/lib/server/historyOverviewAdapter.test.ts
bun test src/lib/budget src/lib/server/budgetEngine src/lib/historyOverview.test.ts src/lib/historyOverviewComponent.test.ts src/lib/server/historyOverviewAdapter.test.ts
bun run check
bun run build
bun test
```

Author evidence: focused 8 tests / 56 assertions; history plus engine 62 tests / 246 assertions; full suite 397 tests / 1680 assertions, all passing. Svelte check: zero errors and warnings. Build: exit 0. Browser suite: nine theme/viewport combinations, no horizontal overflow, buttons >=44px, minimum rendered badge contrast 7.59:1, keyboard disclosure and trusted emulated touch save/reload passed. Screenshots inspected for phone and desktop. Physical iPhone/Safari and authenticated integration remain W11/W17 acceptance gates.

Full-suite container invocation requires an explicitly disposable mounted data directory: `GALENE_DATA_DIR=/scratch`, `TMPDIR=/scratch`, and `--tmpfs /scratch:mode=1777`. The first attempt inherited `/app/data` and correctly failed the application ephemeral-volume guard in existing sync tests. The corrected, isolated invocation passed; no product guard was weakened. The first browser run found a test-oracle formatting assumption (`-50.00` versus actual `-USD 50.00`), corrected after exact rendered-text inspection. Visual review moved axis labels outside SVG to keep phone text readable. No fabricated results were substituted.

## Remaining gates

- W17 independent source/behavior review and any returned findings.
- W11 shared-route wiring and **real supported source resolver** before enabling capture.
- Integrated native route/auth/demo/write-toggle/CSRF verification, signed-in private desktop/phone acceptance and eventual sole-owner deployment.
- No claim that historical source data exists beyond actual saved/reconstructed evidence. Empty/partial history is a correct feature state.

Docs review: existing engine integration contract remains accurate; this isolated handoff contains the proposed route usage. No public documentation/publication or release is authorized by this slice.
