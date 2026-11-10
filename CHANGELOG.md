# Changelog

Notable changes to Galene. Versions use **major.minor** (e.g. `0.1`, tagged
`v0.1`) — not a three-part patch. The version in [`package.json`](package.json)
is the single source of truth and is bumped by the Release workflow (Actions →
Release), which commits it and tags `vX.Y`.

## [Unreleased]

- **Calendar (ADO-68):** match a scheduled occurrence to a transaction from the pill popover or mobile sheet. A suggestion offers **Confirm** and **Not this**; nothing is matched until you confirm. **Match transaction…** picks another transaction. While matched, the occurrence counts as paid (so it is not overdue) and **Mark paid** stays disabled until **Unmatch**. The Scheduled list sorts overdue cards first, and a paid one-time item in the past still shows **Paid** on All. Schema migration adds `scheduled_match` and `scheduled_match_dismissed` (database version 34) — take a backup before upgrading.
- **Calendar (ADO-69):** paid and overdue pills keep each item’s color and the usual dashed style. A check marks paid and an alert marks overdue. The month header count is unchanged. Scheduled list cards keep their color; paid and overdue are an icon and text without a filled band.
- **Calendar (ADO-67):** click a scheduled pill to mark that occurrence paid. Paid is stored per series and occurrence date, does not create a transaction, and does not change other dates. Unpaid items in the last 30 days are marked overdue; the Scheduled list shows that state read-only. Schema migration adds `scheduled_paid` — take a backup before upgrading.
- **SSO hardening (ADO-55):** the first SSO sign-in pins the Galene user to the provider issuer + subject; later sign-ins match on that, and a different subject for a linked email is rejected. Linking by email now requires `email_verified: true` — a provider that omits the claim is rejected (check your IdP sends it). Clearer callback errors, a per-email limit on rejected SSO sign-ins, and **Unlink SSO** in Settings → Users. Schema migration adds `oidc_identities`; take a backup before upgrading.
- MCP HTTP is served on the **app port** at `/mcp` when enabled in Settings → API (**default off**); no separate MCP port.
- **MCP image removed:** no `:mcp-*` tags are published. Use the app image (`:latest` / `:test`), enable MCP in Settings (same port). Stdio: `docker run --entrypoint bun <app-image> mcp-bundle.js`.
- **GHCR tag rename (#157):** image tags drop the `app-` prefix (`:latest`, `:test`, `:test-<sha>`, `:<ver>`). During cutover the Docker workflow dual-publishes legacy `:app-*` aliases so existing host pull refs keep working.
- In-process `/mcp` loads Bun-built `mcp-handler.js` (avoids Vite SSR bundling the MCP SDK).
- Docs: README Highlights and the docs introduction name shipped capabilities (advisor access, settings hub, installable app, theme persist, transaction filters, trends drill-down, HTTP MCP, CSV export, account-menu version).

## [0.1]

Initial public tree under [`galene-finance/galene`](https://github.com/galene-finance/galene).

Self-hostable personal finance MVP: accounts, transactions, categories, tags,
budgets, cashflow, bank sync (SimpleFIN / Plaid / demo), docs site, Docker/Podman
images, and AGPL-3.0 licensing.
