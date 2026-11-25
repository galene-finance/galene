# V3 Activity and account integration

Status: local candidate only; production unchanged. Continues the existing V3 core rather than replacing the app or data model.

- Shared amount pills distinguish posted income, spending, refunds, income reversals, transfers/payments, pending activity and category review. Positive signs alone never establish income.
- Mixed splits retain a neutral whole-transaction state. Invalid or unknown allocations receive review labels; valid parts show their signed category contribution.
- Account balance pills distinguish unavailable values, owed credit balances, negative non-credit balances and ordinary balances. No unavailable amount becomes zero; provider/working-source disclosures remain in place.
- Wired to native Activity table/mobile layouts, Accounts, account detail, transaction detail, and Home account rows. Native filter, category, edit and split actions retained. Account activity uses shared grouped rows and formatted dates; desktop Activity dates moved under merchant names.
- Regression evidence: failing state/SSR assertions followed by passing production-helper/component tests; final suite 313 pass, zero fail, 1194 expectations; compiler zero errors/warnings. Exact post-commit build and test receipts are stored outside the repo under the existing task evidence directory.
- Synthetic evidence: `product-v3-register/checks.json` contains 18 unique layout/runtime cases (Graphite phone/tablet/desktop, selected Ocean/Dark phone cases, Home balance integration). Separate interactions cover account search, month-preserving drilldown, invalid-split review labels, native edit/split dialog opening, Enter activation and Escape dismissal. No saves attempted.
- Limits: synthetic preview is not authenticated acceptance. Full 36-screen/state/accessibility coverage, remaining audit, exact-source review, final release/rollback and authenticated theme persistence remain open. Screenshots are component evidence, not live balances or deployment proof.
