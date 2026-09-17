# Galene docs agents

Starlight site for Galene (`docs/` in the app repo). Public host later: `docs.galene.finance` (not wired yet).

## Issue workflow (required)

When implementing or fixing an **app** issue, agents must also:

1. **Check** whether `docs/src/content/docs/` needs updates (install, deploy, config, security, features, API/MCP).
2. **Update** those pages in the same issue delivery when something user- or operator-facing changed.
3. **Record** in the GitHub issue comment either the docs paths touched or an explicit **docs N/A** reason.

See the root [`AGENTS.md`](../AGENTS.md) delivery flow (docs check step).

Preview: `bun install && bun run dev` from this directory → http://localhost:4321 (use `--host 0.0.0.0` to reach from another machine on the LAN).

---

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
