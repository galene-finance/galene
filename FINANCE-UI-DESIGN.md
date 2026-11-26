# Finance overview redesign

## Research and design decisions

- Nielsen Norman Group, *Dashboards: Making Charts and Graphs Easier to Understand* (https://www.nngroup.com/articles/dashboards-preattentive/): favor quick scan and linear magnitude encoding. Applied zero-based, directly labeled bars, not decorative pies, and a clear monthly income/expense comparison.
- W3C WAI, *Designing for Web Accessibility* (https://www.w3.org/WAI/tips/designing/): readable contrast, non-color labels, visible links/focus, heading/spacing groups, responsive views. Applied tabular money, explicit warning text, tested light/dark semantic colors, content-led phone cards.
- IBM Carbon, *Color palettes* (https://www.carbondesignsystem.com/building-blocks/data-visualization/color-palettes): restrained categorical/sequential color, alerts distinct from ordinary data. Applied teal/slate bars; amber discrepancy text; red only for negative/error semantics. This is an adaptation, not a claim of Carbon conformance.

## Data contract

This is a presentation change, not a ledger correction. No database, sync, auth, API, account type, category, budget, or transaction mutation code changed. Native customization endpoints and controls remain.

Accounts are visually grouped by native type; loan/mortgage names are placed with debts even if imported as bank/other. This is a name heuristic, explicitly disclosed, not a persisted reclassification. Supplied signs are preserved. Bank and ledger balances remain separate, with actual as-of timestamp or an unavailable state. Differences are labeled, without claiming which is correct. No combined balance is presented as spendable cash or net worth.

Monthly net is labeled as recorded income minus expenses. Spending bars use only supplied points and exact visible values. Current-month and missing-history caveats remain visible. Empty budgets/schedules do not imply no obligations.

## Layout and appearance

Light theme: slate/navy typography, pale cool background, white cards, deep teal accents, accessible amber and red. Dark and custom native themes remain available. Light/dark foregrounds and semantic labels are regression-tested at 4.5:1 on their surfaces/backgrounds. Existing optional theme palettes are preserved; not all custom themes can be guaranteed accessible.

Reading mode grows grid rows to fit content; edit mode retains native grid sizing. Phones stack cards with full text, no nested vertical scroll. Existing widget ordering, filters, add/remove, resize and native theme persistence remain supported. The synthetic preview offers both a proposed roomy arrangement and `?native` for existing default geometry. The proposed arrangement is **not silently installed** into any saved preference.

## Verification / release boundary

`ui-preview/` is an isolated Vite harness importing the actual production components, with synthetic data and synthetic fetch responses. It has no finance database, credentials, live API routes, or production auth bypass. It is not part of the SvelteKit production routes. Use loopback host publication only. Preview persistence is mocked, not evidence of live saved settings.

The production source compiles; focused tests and source/record safety gates are recorded outside this document. Any baseline-wide typecheck failures must be compared to the exact preserved baseline, not called passing. Installation requires independent review, image/source provenance, rollback, and authenticated live visual acceptance. A synthetic preview is not live verification.
