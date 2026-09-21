# Agent instructions (Galene)

## Project

Galene is self-hostable personal finance (SvelteKit + Bun + SQLite). Prefer small diffs. Never invent bank/Plaid/SimpleFIN secrets. Match existing `src/` style.

## Privacy (issues / PRs / comments)

- Never put personal computer names, hostnames, LAN IPs, home-lab topology, or private domains in GitHub issues, PRs, comments, or in-repo docs meant for the public.
- Never put the maintainer’s given name in GitHub issues, PRs, comments, or public docs. Use “the maintainer” or omit.
- Prefer generic labels: local build host, app host, reverse-proxy host, `:app-test`, production URL (or omit).
- Public product names (SimpleFIN, Plaid, Caddy, Authentik, etc.) and generic reverse-proxy examples are fine.

## Delivery flow — issue → PR → `test` → `main` → release

1. **Issue first.** Every change starts from a GitHub issue (create one from chat if needed). Include context, success criteria, constraints, and how to verify.
2. **Feature branch** off `main`: `feat/issue-N-slug` or `fix/issue-N-slug`.
3. **Docs check.** Before calling the work done, review `docs/` for anything the change makes wrong or incomplete. Update pages in the same PR when operators/users need to know; otherwise note `docs N/A` in the issue comment.
4. **Open a PR into `test`** (preferred) or land on `test` only when explicitly asked. CI publishes:
   - `ghcr.io/galene-finance/galene:app-test` / `:mcp-test` (mutable)
   - `ghcr.io/galene-finance/galene:app-test-<sha>` / `:mcp-test-<sha>` (immutable)
5. **Comment on the issue** in the same turn the work lands on `test`: short SHA + commit URL, what changed, docs note, how to verify on `:app-test`. Do **not** close the issue.
6. **Human verifies** on `:app-test` (Settings → About / `GET /version` for the SHA). Approve by merging `test` → `main` (or asking for that ship).
7. **Push/merge to `main`** refreshes `:app-latest` / `:mcp-latest`.
8. **Releases only when asked:** Actions → Release → enter **major.minor** (e.g. `0.2`, not `0.2.0`). That bumps `package.json`, tags `vX.Y`, and publishes `:app-<ver>` / `:mcp-<ver>`.

### Working rules

- Do not push feature work straight to `main` — route through `test` first.
- Do not cut a release unless asked.
- Ask before pushing to GitHub remotes if your local policy requires it; bots that are authorized to push still must follow the flow above.
- Docker images are **always** multi-arch (`linux/amd64` + `linux/arm64`).

## Schema migrations (SQLite)

- Migrations run at startup (`PRAGMA user_version`, transactional). Prefer additive SQL.
- **Never `DROP TABLE` a parent** that children reference with `ON DELETE SET NULL` / `CASCADE` while `PRAGMA foreign_keys = ON`. That wipes or deletes child rows even if you recreate the parent with the same ids (#20).
- SQLite **ignores** `PRAGMA foreign_keys = OFF` inside an open transaction. Use the migration `afterFkOff` hook (runs after COMMIT, with FKs off) for parent-table rebuilds.
- Before bumping `user_version`, migrate asserts categorized txn / split / rule counts did not fall.
- Recommend operators take a **Settings → Backups** copy before upgrading images that include schema migrations.
