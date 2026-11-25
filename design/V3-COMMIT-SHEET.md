# V3 commit sheet — native finance product

1. **No cinematic peak.** The moment of care is a meaningful amount/category pill that leads to the records explaining it without losing the user's date/account context. Repeated components, not spectacle, define this product.
2. **Color commitment: restrained.** Chris selected Graphite; retain its neutral charcoal and warm action accent rather than choosing a fashionable dark fintech default. Browser-measured body color: `oklch(0.185402 0.00517164 248.178)` (#111315). Accent: `oklch(0.768595 0.16468 70.0701)` (#f59e0b). Body L is 0.1854; target painted mean L approximately 0.23 with layered panels, not a claim of measured mean. Ocean and Dark are alternatives, not palette forks. Semantic fills are separate from the brand accent; all five badge states have tested text contrast at least 4.5:1 across six built-ins.
3. **Type.** Local platform system sans: 28px page title, 18–20px section title, 14–16px working text, 11–12px metadata, tabular amounts. No display serif or imported Inter. Hierarchy and native platform familiarity provide contrast; this is a working finance tool, not an editorial landing page.
4. **Grid break.** A wide plan/actuals pane with a narrower obligations/account rail, not identical metric tiles. Incomplete-data context precedes the figures in both visual and DOM order. Phone becomes one meaningful sequence with a five-destination bottom navigation.
5. **Motion.** Zero scroll patterns, no animated counters. Only brief 120–180ms control transitions where useful; no information depends on animation. Respect reduced motion.
6. **Reflex check.** First-order: glossy fintech cards, decorative charts and a giant net-worth hero. Second-order: a terminal-like dark dashboard with tiny mono labels and neon. Chosen deviation: native grouped rows, filled state labels, direct editing/drilldowns and explicit source/date scope. No unsupported net-worth or funded-money claims.
7. **House tells deliberately broken.** No mono service labels; use readable system text. No wordmark-as-hero, glow, scroll-instruction footer or marketing-stat grid. Dark charcoal and amber are retained only because they are the owner's selected Graphite identity (`auteur-allow`: selected palette, not a reflex).

## Visual gate — provisional style approval, not product acceptance

The isolated, clearly labeled synthetic mockup uses the actual FinancialBadge component and monthlyPlanTotal helper. Nine distinct theme/viewport combinations were captured: Graphite/Ocean/Dark at 390, 768 and 1440. Contact sheets and individual frames were inspected; no horizontal overflow in the measured matrix. A lower-page phone inspection confirmed row dates beneath identifying content and the last row above the fixed navigation (733.5px versus nav top 782px).

The inspection caught an incomplete-data notice appearing after the figures on narrow screens. It was moved ahead of the figures in DOM and visual order; all nine combinations now assert that condition. The plan preview now names its other target group so its visible subgroup cannot be mistaken for the whole total. Links in the mockup have 44px hit height.

Approved direction for production integration: layered rounded sections, neutral/green/amber/red/blue filled badges with visible meanings, five primary destinations and date-left row anatomy. Apply the pattern to actual pages next; the static mockup does not prove real routes, editors, authentication, persistence, complete keyboard behavior or financial reconciliation. Source-level theme/default tests, badge SSR and the native Home loader are already exercised separately.

## Remaining implementation checks

- Integrate the shell, Home, Plan and Reflect, then the rest of the inventoried routes. Do not leave any destination as a dead link or a static mockup.
- Prefer Graphite/Ocean/Dark in theme-picker presentation without changing the native array's legacy Light normalization base or deleting custom themes.
- Verify primary-button foreground contrast and other controls, not just badges. The successful badge contrast test is not full accessibility acceptance.
- Preserve account/date filters in history and contribution links; existing productInsights history requires scoped-account review before reuse in Reflect.
- Keep financial state classification tied to activityParts/summarizeActivity, never positive amount alone. Unknown credits are not automatically income, and movements are not spending.
- Do not change the existing deployed app or real preferences until the successor passes release gates. The source foundation remains separate from live 3fe0b3a.
