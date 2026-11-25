# Trusted history capture provider — W18 continuation

Base: `799f61db90ae6093f73ce65400e836ed452ebd30`.

Ownership: new `src/lib/server/historyCaptureProvider.ts`, `historyCaptureProvider.test.ts`, `historyCaptureProviderUi.test.ts`, and this handoff. No shared routes, engine, schema, CSS, sync connector, runtime configuration, live data or credentials changed. W11 owns route integration and deployment; W17 owns independent acceptance.

## Supported source inputs, verified from this base

- `accounts` stores owner, provider, external identity, signed `provider_balance_cents`, and `provider_balance_as_of`. The schema defines the last field as UTC DB datetime. `sync.ts` uses **provider time OR fetch time** in that same field; that distinction is not persisted. The provider preserves the exact timestamp and says this explicitly in evidence. It never calls this an end-of-day balance.
- Native SimpleFIN/Plaid rows are supported only when a trusted approved policy binds the exact owner account, provider, source account reference and currency. The core account schema has **no currency**. The module does not assume USD or infer currency from locale, a name, or unrelated accounts.
- The inspected base has **no MMI statement/estimation receipt store and no Apple-specific YNAB balance receipt store**. Those source paths can supply `HistoryExternalEvidence` from their approved durable updates. The implemented provider validates and resolves these receipts; it does not fetch them or turn manual/opening balances into them.
- MMI requires the exact source binding, immutable receipt identity, original timestamps, amount/currency, nonempty evidence, `accepted:true`, and the accepted estimation method. It always becomes `accepted_estimate` with the method retained.
- Apple-only YNAB requires the exact `ynab_apple` binding and receipt. It becomes a recorded **YNAB ledger balance**, explicitly not an independently verified bank balance. It cannot satisfy an MMI policy or another account binding.
- Protected MMI/Apple policies never fall back to a connected bank feed. Missing evidence or source mapping returns a per-account gap, not a zero, fabricated history or broad source substitution.
- Ordinary opening balances and transaction-derived account totals are intentionally not candidates. Date-only evidence is not silently promoted to UTC midnight/day-end. Historical reconstruction is not performed here.

## API and trust boundary

```ts
trustedHistoryCaptureProvider(database, access, approvedPolicies, trustedNowISO, trustedExternalReceipts?)
// -> { offers, gaps, resolve, revision }

captureTrustedHistoryEvidence(database, access, approvedPolicies, formData, trustedNowISO, trustedExternalReceipts?)
// -> existing adapter receipt + exact account-day readback
```

`access`, policies, receipt arrays and clock come only from authenticated server context / approved source update paths. **Never deserialize policies or receipts from the form, query, or a browser-authored JSON body.** The provider is a concrete SQLite-backed native source resolver, not a fake/mock resolver. Its optional external receipt seam is not an importer or an unrestricted public endpoint.

Offer discovery is read-only. Offers contain original amount/currency/as-of/provenance plus a short-lived opaque reference. References are HMAC-bound to owner, original source identity, contents and issue time using process-local random signing material; no secret or source-account identifier is returned. References expire after 15 minutes. A restart or a request routed to another process requires reloading offers; fail closed rather than treating a hash as authorization. The existing route must preserve normal owner session/demo/write-toggle/CSRF/size guards. The reference never substitutes for them.

On capture, the wrapper holds an **IMMEDIATE transaction** while re-reading and verifying source rows and invoking the existing engine. Stale source contents, stale revision, forged/expired references, source-identity conflicts, foreign owners and extra form fields are rejected. Only `history_offer`, `revision`, `key` are accepted. A native snapshot's `recordedAt` is capture time, not the older provider timestamp. External receipts retain original recorded-at time. A duplicate retry within the reference lifetime returns the original persisted receipt/payload; already-captured records are omitted from new offers. Original source identity is stable across retries, and conflicting values for one identity are never overwritten.

## Proposed W11 wiring (do not copy guessed account mappings)

1. Keep existing Reflect net-worth owner-session restriction. Obtain approved per-account policies from the actual verified mapping/configuration source. All source inputs remain server-side. **Do not build policies simply by mapping every connected account to its current provider**: that would erase MMI/Apple source preference. If no approved mapping exists, show returned gaps and keep that account unavailable for capture.
2. In the authorized loader, call `trustedHistoryCaptureProvider(db(), access, policies, new Date().toISOString(), receipts)`. Use the returned `revision` and `offers` for `HistoryCaptureControls`; preserve the selected account scope by filtering the approved policy/receipt inputs or displayed offers to that scope without changing their identity. The provider returns gaps for other owner accounts; present only gaps for the selected scope. Pass a fresh server UUID `commandKey`, `canCapture:true` only when native write policy permits it, and explicit `action='?/captureHistory'` plus preserved date/account/theme routing parameters as appropriate. Do not call the provider for an unauthorized viewer/API-token/read-only context merely to hide its results afterward.
3. If a selected-scope action is required, the native action must independently validate that the offered account belongs to the server-approved selected scope. All-owner authorization is the provider's base contract; query filters are presentation, not permission.
4. Native action sketch after existing guards:

```ts
const access = {ownerId: authenticatedOwnerId, canRead: true, canCapture: true};
const now = new Date().toISOString();
const result = captureTrustedHistoryEvidence(
  db(), access, approvedOwnerPolicies, await request.formData(), now,
  receiptsFromApprovedUpdatePath
);
// redirect/reload the selected Reflect scope and recompute history
```

5. Keep the GET loader read-only. Call the capture action only on the explicit save intent. Do not create snapshots on page load, synthesize a source timestamp, or claim source coverage from an exhausted transaction page.
6. Handle offer expiry/source drift with a reload, not a blind retry with new timestamps. Preserve an exact payload/key for ambiguous retries. A saved receipt can exist even if the original offer expired; inspect normal history before claiming a failed save or offering it again. Readback is through the existing engine and normal loader, not a fabricated success DTO.
7. Route tests must exercise native owner/viewer/token/demo/write-toggle/origin restrictions and preserved navigation scope. This module's synthetic access booleans and component rendering do not prove production session authentication.

## Executable synthetic verification

No live databases, source records, credentials or external requests are used.

```sh
bun install --frozen-lockfile --ignore-scripts
bun x --no-install svelte-kit sync
bun test src/lib/server/historyCaptureProvider.test.ts src/lib/server/historyCaptureProviderUi.test.ts
bun run check
bun test
```

The component test renders the actual `HistoryCaptureControls`, reads its actual hidden POST fields, saves through the new provider wrapper and existing engine, closes/reopens a real disposable SQLite file, then renders `HistoryOverview` from persisted points. It verifies a negative total, retained MMI method and an unfilled prior-day gap. It is executable component/persistence acceptance, **not** a new browser route or authenticated live acceptance claim.

Author results before sealing: 13 focused tests / 76 assertions passing; full suite 426 tests / 1919 assertions passing; Svelte check zero errors/warnings; production build exit 0. Container tests use disposable tmpfs `/scratch` with `GALENE_DATA_DIR=/scratch` and `TMPDIR=/scratch`; source mounted from the isolated checkout, no production volumes. The initial focused test intentionally failed because the new module did not yet exist.

Covered: native timestamp preservation, missing currency/source metadata, zero/negative/unsafe amounts, invalid/future dates, accepted MMI method, Apple source isolation, foreign owner, readonly denial, duplicate mapping/receipts, forged extra fields, signed reference tampering/expiry, source drift, stale revision, save/reopen/retry identity, prior gaps and saved-identity conflicts. Existing source account/opening balances and transaction rows remain untouched.

## Remaining integration/data gates

- W17 independent review of this immutable slice.
- W11 wiring of the shared route and its native guards, followed by integrated browser acceptance.
- Approved source/currency mappings and genuine MMI/Apple receipts must exist for those accounts to offer capture. Their absence is a truthful data/source-policy gap, not permission to manufacture records.
- No activation, source fetch, credential setup or live finance verification has been performed.

Docs review: the existing engine/history documentation remains accurate; this handoff specifies the new provider's contract and limitations. No public issue/PR/release was created.
