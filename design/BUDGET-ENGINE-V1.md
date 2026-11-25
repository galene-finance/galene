# Budget engine v1 — integration contract and ownership

Status: implemented backend candidate; see BUDGET-ENGINE-INTEGRATION-V1.md for the definitive service/DTO and integration gates. Not deployed. Baseline b4ec94a84bd89296624060b899dd6555ebcfc43a (committed successor to 322831e). W16 branch atlas/w16-budget-engine. W11 remains sole integrator/deployer; W17 independent reviewer. No production data used.

## Ownership
W16 exclusively owns new `src/lib/budget/*`, `src/lib/server/budgetEngine/*`, their tests, this contract, and additive migration hook in `src/lib/server/db.ts`. W11 owns UI/components/page loaders/actions and existing presentation helpers. Coordinate any existing server finance/writeApi modifications through W11; engine uses dependency-injected SQLite rather than global database creation. No changes to imports, schedules, identities, opening balances, credential delivery or deployment.

## Stable public entry points
- `src/lib/budget/types.ts`: version 1 domain/DTO contract (integer cents, ISO civil dates/months, UTC timestamps).
- `src/lib/budget/targets.ts`: `evaluateTarget(target, month, progress)` and `costToBeMe(targets, month, progressByCategory, obligations)`. Refills subtract cycle-start carryover; set-aside counts net assignments independent of spending; balance targets use currently available balance. Annual/custom goals distribute remaining requirement through due month. Weekly targets count actual anchored weekday occurrences, not 52/12. Auditable contribution lines; schedules in targeted categories are coverage evidence, never an extra cost. Uncovered obligations reported separately.
- `src/lib/budget/ledger.ts`: `projectLedger(accounts, categories, events, throughDate)` returns actual cash, RTA, category cash available, separate unfunded credit spending and payment reserves; conservation checked. Immutable ordered postings and allocation commands; no future income. Positive category balances and negative cash overspending roll forward. Credit overspending remains explicit debt until funded, not fictitious negative cash. Payments and internal transfers are not expenses.
- `src/lib/server/budgetEngine/service.ts`: `BudgetEngine(database, ownerId)` for owner-scoped versioned targets, explicit activation, idempotent allocation/posted-event commands, revision checks, monthly view and snapshot/history reads. Integration must pass authenticated OWNER id, never request owner id; viewer/demo/write-policy checks stay in existing route boundary. Command writes must supply expected revision and idempotency key. Reusing key with different payload is conflict. Writes use SQLite immediate transactions.
- `src/lib/budget/history.ts`: evidence-only net worth series. Each point lists included/missing account ids, actual/accepted-estimate/reconstructed source, as-of time and coverage. No interpolated zeroes or silent carry-forward. Only complete, bounded transaction evidence plus an anchor permits reconstruction. A missing point returns null total, with known subtotal separate.

## Persistence / integration policy
Additive versioned tables only. Existing budget limits migrate to versioned target definitions, never assignments. Legacy limits lack funding behavior/anchors: preserve cadence/amount as reviewable target drafts, never invent due dates or history. Multiple legacy cadences for one category are review conflicts, not summed. Accounts require explicit budget-cash/budget-credit/tracking classification and accepted dated baseline before allocation activation. Activation does not mutate account opening/provider balances or create transactions. Initial allocations/reserves are ZERO; existing card debt is unfunded until explicitly assigned. Partial/unknown activity blocks a claimed complete available balance. Preserve original transaction/schedule records and duplicate prevention.

Posted events are a normalized accounting seam, not another bank importer. Every event needs a unique source identity; pending/forecast rows must never enter the ledger. Existing transaction edits require an explicit projection refresh/rebuild from authoritative records, not a second append under a different identity. Linked two-sided transfers become one event; unpaired transfer categories are unresolved, never guessed. Budget/tracking crossings carry explicit expense/income/category meaning. Allocation changes are app records only, never bank payments.

## Source and product choices
Reviewed official primary documentation 2026-11-25: YNAB Understanding Target Types; Credit Card Refunds and Returns; When the Month Rolls Over. Actual Budget How Budgeting Works; Credit Cards and Actual Budget. URLs retained as code/source references below. Actual subtracts credit debt from its on-budget pool; this product instead exposes separately cash-backed payment reserves, so do not mix the two models. Adopt actual-money-only allocation and transfer conservation; choose explicit reserve accounting. Existing accepted debt-estimate provenance and narrow Apple source remain authoritative; no engine routine overwrites them.

```text
https://support.ynab.com/en_us/getting-started-with-targets-ryAEP08xC
https://support.ynab.com/en_us/credit-card-refunds-and-returns-H1J7qDWkj
https://support.ynab.com/en_us/when-the-month-rolls-over-a-guide-rkyyd6qC9
https://actualbudget.org/docs/budgeting/
https://actualbudget.org/docs/budgeting/credit-cards/
```

## Acceptance gates
Synthetic tests: target cross-month/year/leap-date semantics; conservation after every event; refunds/credit surplus/card payment/no double expense; allocation/reallocation/overspending; budget/tracking boundaries; owner isolation; stale revisions/idempotency collisions/concurrent connections; migration dry-run and transactional rollback without existing row changes; provenance/coverage/missing-history. W17 reviews exact committed source. W11 integrates real route flows and validates private authenticated deployment. Backend tests do not establish deployed completion.
