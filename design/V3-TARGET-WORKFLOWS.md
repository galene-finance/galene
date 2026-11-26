# Native target workflows — next integrated slice

This supersedes the target-editor limitation in V3-FUNDING-INTEGRATION for the current source, not for the frozen5fa12d9 review copy. W17 independently APPROVED the5fa12d9 funding/Plan/category/HomeQA002 slice, including27 theme/size cases and actual isolated-browser keyboard/emulated touch. This is not whole-app/authentication/deployment approval.

## Implemented
- Actual native target save and version-removal actions share the guarded owner/origin/bounded-body/revision/idempotency boundary. Targets may be configured before a funding baseline; this does not create balances or assign cash. Income categories cannot become spending targets.
- Explicit monthly, weekly, annual and custom-date cadence; refill/set-aside/balance behavior; start, effective month, required weekday/deadline, optional custom repeat interval. Target category stays immutable. Weekly days and annual deadlines missing from an old limit require explicit selection.
- Existing native limits are shown as reviewable starting points, not automatically converted to assignments. Saving accepted settings preserves the native limit record and history. Competing category targets remain engine-rejected rather than silently summed.
- Selected-month edits and removals preserve earlier versions. Removal explicitly says later scheduled versions are preserved. Native success receipts state the effective month so a future save is not mistaken for a failed present-month edit.
- Dashboard/target specifications are read in one database snapshot. Native Home and Plan use the same authoritative configured monthly contribution amount, with a selected-month link; the legacy plan shape remains available only as the unversioned fallback. This is target intent, not cash available.

## Verification
Native action and actual-component tests cover annual goals, weekly before-start boundaries, invalid deadlines/revision preservation, future edits/removal/history, unchanged allocation ledger, no-baseline target creation and Home/Plan agreement.

product-v3-targets/version-flow.json records six browser transitions through actual native actions/loaders and temporary SQLite: adopt annual; preserve January monthly goal; apply February weekly goal; custom repeating due date; remove March version; retain original January annual history. Cash remained100000 synthetic cents; the original limit record remained present. Target summary/editor layouts: Graphite390/1440, Ocean390, Dark390;8 cases, no overflow/runtime errors, controls at least44px. Four additional Home layouts and home-plan-readback verify30000-cent monthly intent agrees with Plan while100000-cent cash is unchanged.

The annual test oracle was corrected: in February an unfunded120000-cent annual goal has a February contribution of10910 with11 months remaining, not a flat10000. With4000 weekly intent,14910 is correct. The initial fixture allowed only January/February; it now permits valid2024 months for archive/history checks. Earlier attempt evidence is retained; these were harness/oracle corrections, not changes to authoritative accounting.

Fixture scope is still synthetic owner-context transport, not production session acceptance. The explicit development origin is loopback24865, separate from frozen W17 lane24863. The synthetic native opening balance now agrees with the fixture's end-of-day allocation baseline. No real balance, source, history or runtime was changed.

## Still open
Independent exact-source review of this slice; broader behavior/cadence/adoption/conflict keyboard/touch cases and saved theme persistence; reallocation/card-reserve controls and reliable pair review; accepted baseline/account-scope workflow; approved source-specific history capture and history UI; remaining all-screen states/audit/upstream work; recovery-preserving release and real authenticated acceptance. Do not call this a completed app or deploy it under the earlier scoped approval.


## Target behavior follow-up (extends frozen 839a5d1)
- Behavior-specific help explains refill cycle-start shortfall, current-balance goals, and new contribution goals. Text is tied to the actual selected native control, not a generic funding claim.
- Native regressions prove refill can be met while only 5000 cents remains; switching the same 10000-cent goal to balance requires 5000 more. Cash ledger is identical before/after both target edits.
- Replay returns the original receipt without a revision increment; changed payload under the same key, stale revision, foreign category, and oversized form are rejected without mutations.
- SSR explanation regression failed first, then passed after implementation. Full follow-up gates:393 tests/0 failures/1673 expectations, compiler0 errors/0 warnings, build exit0 (see exact execution receipt; no release approval inferred).
- Actual browser selection checked all three behavior explanations. Four layout cases: Graphite/Ocean/Dark at390px and Graphite1440px; no horizontal overflow and all target controls at least44px high. Artifacts:product-v3-target-behavior/{help-checks,layouts}.json and named screenshots.
- Dedicated mutable synthetic integration fixture is bound to127.0.0.1:24911, with an explicit test-only origin allowlist entry. Frozen funding24863 and target24865 copies are untouched. No production authentication or live financial acceptance claimed.
