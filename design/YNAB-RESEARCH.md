# YNAB-informed product revision — primary-source research

Read 2026-11-25. This extends the earlier finance-app/Apple/Material/WCAG research. The complete Ultimate Get Started Guide (all five substantive chapters) and eight targeted help articles were read, not just search snippets. Reference screenshots are public YNAB examples, never evidence about this user's finances. Use original Galene copy and styling, no YNAB branding or copied assets in the application.

## Sources and implications

1. **Full getting-started guide** — https://www.ynab.com/guide/the-ultimate-get-started-guide
Categories express priorities; irregular expenses need planning alongside ordinary monthly bills. Targets describe intent. Cash assignment follows money already held, not an anticipated paycheck. Later chapters distinguish ongoing transaction recording from revising the plan. Adopt editable grouped targets and actual-only income; do not imitate assignment controls without an allocation ledger. Preserve existing accounts/history rather than following onboarding/reset suggestions.

2. **Cost to Be Me / Edit Plan** — https://support.ynab.com/en_us/plan-and-adjust-with-edit-plan-and-cost-to-be-me-ByR7vpqPyx
Cost to Be Me totals the current month's targets. Target edits change it; spending and assigning money do not. YNAB also offers expected-income comparison, but Chris explicitly wants that de-emphasized. Galene's metric will be a current monthly-plan total, never a spendable balance. Preserve forecasts in their proper secondary view. Do not add scheduled obligations a second time to targets that already cover them.

3. **Targets** — https://support.ynab.com/en_us/how-to-use-targets-rk5kkI9ks
Cadence, due dates and refill/set-aside/balance behaviors matter. Galene limits do not contain all of this funding state. Do not manufacture equivalent annual sinking-fund progress, weekly due dates or historical target versions. Present unsupported cadence separately rather than silently flattening it into an exact current-month total.

4. **Colors and icons** — https://support.ynab.com/en_us/colors-and-icons-in-your-plan-HJQv_XHko
Filled status treatments are meaningful, not decoration. YNAB's funding/overspending meanings cannot simply be copied. Galene's labels will describe within limit, over limit, no target, pending, received, refund, movement and source uncertainty. Pair color with a visible label/icon and accessible name; use genuinely filled amount/category badges rather than colored text alone.

5. **Spending Breakdown** — https://support.ynab.com/en_us/spending-breakdown-H1H7YxmD0
Use a category/group hierarchy and drill into the transactions behind a selected figure. Keep date/account/category scope visible and stable between the summary and detail. Prefer readable category rows with amounts and shares over a decorative chart alone.

6. **Reflection exports** — https://support.ynab.com/en_us/how-to-export-reflection-data-Bykou09
Exports depend on report type and visible selection. This is a behavior reference, not permission for an assistant to export this user's ledger. Preserve existing native exports; do not add a misleading report-export control whose scope differs from its displayed contributions. Test any export behavior only with synthetic data.

7. **Credit cards** — https://support.ynab.com/en_us/getting-started-credit-cards-in-ynab-H1pdorTTWl
YNAB moves assigned money into payment categories after funded card purchases. Galene does not implement that funding engine. Keep card purchases as spending and payment movements separate; never imply money has been reserved for payment, or count a purchase and its payment as two expenses.

8. **Income vs spending / income v expense** — https://support.ynab.com/en_us/income-v-expense-Byu1BYWRq
Mobile emphasizes a compact comparison; desktop adds monthly/payee/category detail and transaction drilldowns. Refund inflows are not earnings. Net income is not net worth. Adopt useful conventional hierarchy, but retain Galene's tested signed refund/reversal, movement and partial-history rules rather than copying YNAB-specific account exceptions.

9. **Spending Trends** — https://support.ynab.com/en_us/spending-trends-H1inlhzAc
A month/group/category/transaction drilldown and scope-aware totals are the useful reporting pattern. Adapt it to both phone and desktop, including textual values and keyboard-accessible alternatives. Never invent history for empty months or assert a complete average from incomplete coverage.

## Actual screenshot inspection

- Plan/detail screenshot from source 3: https://cdn.bfldr.com/NIEXAZS5/at/7xqkrtx886348bmzng8q77/Target-Funding-Web-Help-Article.png?auto=webp&format=png
Observed: compact navigation, month context, segmented filters, grouped rows, rounded selected row, filled amount pills, and a stacked inspector. Borrow grouping and hierarchy. Do not copy Assigned/Available/Funded claims as visual decoration. Those owner-requested semantics now require the real allocation engine and integrated state/mutation acceptance.
- Mobile report screenshot from source 8: https://cdn.bfldr.com/NIEXAZS5/at/5hbqn35qbgqphgg9bgjt39jr/Income-Vs-Spending-6-Months-Dark-iOS-Help-Article.png?auto=webp&format=png
Observed: one rounded dark surface, readable conclusion before the paired bars, shared baseline, month labels and explicit Income/Spending legend. The image is a cropped report card, not evidence of navigation or interactive behavior. Use a truthful computed summary only where coverage supports one; otherwise describe the visible recorded period.

## Deliberate departures

Graphite is the selected default, with polished Ocean and Dark alternatives. Use local system typography, original wording, layered neutral surfaces and bounded semantic colors. Home leads with the monthly plan and useful recorded-state summaries, not forecast wages. The current limit-only Plan is not yet a funded allocation ledger; Chris has now requested one, and future funding states must come from the real versioned backend engine. Reflect presents actuals and contributions, not an unsupported historical net-worth chart. Dates belong beneath the row's name/category; the amount column holds only value and state. All screens, including editors/settings/errors, must share the same component contract.
