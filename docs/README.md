# Galene Docs

Documentation site for [Galene](../README.md), built with [Starlight](https://starlight.astro.build) (Astro).

This is a **separate package** from the root SvelteKit app: it has its own `package.json`, dependencies, and build output, and nothing here is bundled into the app image.

## Commands

All commands run from this directory (`docs/`) with [Bun](https://bun.sh):

| Command           | Action                                              |
| :---------------- | :-------------------------------------------------- |
| `bun install`     | Install dependencies                                |
| `bun run dev`     | Dev server at <http://localhost:4321> (hot reload)  |
| `bun run build`   | Production build to `dist/`                         |
| `bun run preview` | Preview the production build locally                |
| `bun run check`   | Type-check (`astro check`)                          |

## Layout

- `src/content/docs/` — all pages (`.mdx`), one file per route
- `astro.config.mjs` — Starlight config: site title, sidebar groups (Start / Self-host / Features / Reference)
- `src/styles/custom.css` — Galene theme (teal accent, light + dark)
- `src/components/SiteTitle.astro` — header brand: wave mark + “Galene Docs”
- `public/favicon.svg` — wave mark favicon

## Publishing

The intended public host is **`docs.galene.finance`** — not wired up yet (no DNS, Caddy, or CI for it in v1). `site` in `astro.config.mjs` already points there; when it is, build this directory and serve `dist/` as static files.

## Keeping docs current

App issue work must check and update these pages when behavior changes (see root `AGENTS.md`). Stub pages under `src/content/docs/` are the starting IA — expand them as features ship rather than leaving `DEPLOY.md` as the only source of truth forever.

## Publishing to the app host

Production static files live on the app host at `/opt/galene-docs` (served later via a TLS reverse proxy / edge proxy as `docs.galene.finance`).

From a local build host that can SSH to the app host (not GitHub-hosted CI — runners cannot reach a private LAN):

```bash
cd docs
./scripts/publish-app-host.sh
```

SSH target defaults via `GALENE_DOCS_SSH` (local SSH Host alias) and destination via `GALENE_DOCS_DEST` (default `/opt/galene-docs`). After docs land on `main`, run this in the same turn (see root `AGENTS.md`).

