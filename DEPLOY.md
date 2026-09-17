# Galene — Container Deployment Guide (Docker & Podman)

Galene ships as **two images** built from one [`Dockerfile`](Dockerfile):

| Target | Image | What it is |
| --- | --- | --- |
| `app` | `galene:app` | The web app: Bun.serve on port **3000**, single-file SQLite database in `/app/data` |
| `mcp` | `galene:mcp` | The MCP (Model Context Protocol) stdio server — a self-contained bundle that talks to a running Galene instance over its REST API |

Both images:

- are based on **`oven/bun:1.4.0-slim`** (pinned; the build stage uses full `oven/bun:1.4.0`), Debian 13 (trixie) underneath
- run as a **non-root user** `galene` (uid 10001)
- contain only the build output and the Bun runtime — no `node_modules`, no source

The app is a **single replica**: it runs in-process schedulers (bank auto-sync, backups, notifications) and a single SQLite file. Run one instance; put your TLS-terminating proxy in front if you want HTTPS.

---

## Quick start (Docker Compose)

```bash
docker compose up -d
```

That's it. The included [`docker-compose.yml`](docker-compose.yml) builds the `app` target, runs it on port **3000**, and mounts the database on a named volume. Open <http://localhost:3000> — the first account you create is the **admin** (see [First run](#first-run-and-admin-account)).

To use a prebuilt image (e.g. from GHCR) instead of building locally, comment out the `build:` block in the compose file and set:

```yaml
image: ghcr.io/<owner>/<repo>:app-latest
```

To try a pre-release build before it reaches `main`, use `:app-test` (the latest build of the `test` branch) — see [Testing a build before it reaches `main`](#testing-a-build-before-it-reaches-main).

The same file works with **`podman-compose`** (see [Podman](#podman)).

---

## The two images

### `app` — the web app

```
FROM oven/bun:1.4.0-slim
USER galene            # non-root, uid 10001
WORKDIR /app
ENV GALENE_DATA_DIR=/app/data  PORT=3000  NODE_ENV=production
EXPOSE 3000
HEALTHCHECK  GET /api/v1 → 401 means healthy
CMD ["bun", "build/index.js"]
```

Notes:

- **No `VOLUME` instruction, on purpose.** The app has a startup check that **refuses to run if its data directory is not a mounted volume** (see [Data, volumes, backups](#data-volumes-and-backups)). A bare `docker run` without `-v` will not start — that is the point.
- **Healthcheck:** `GET /api/v1` answers `401` (JSON) when the server is up and reachable; the container reports `healthy` on that. `docker ps` / `docker compose ps` shows the state.
- **Shutdown:** the app's shutdown handler waits up to 30 s to finish in-flight work (WAL checkpoint, etc.); the compose file sets `stop_grace_period: 40s` to give it headroom before SIGKILL.

### `mcp` — the MCP server

```
FROM oven/bun:1.4.0-slim
USER galene
ENV GALENE_API_URL=http://localhost:3000
CMD ["bun", "mcp-bundle.js"]
```

- **stdio transport** — an MCP client (Claude Desktop, Grok, …) launches it; it is not a long-running daemon and has no port.
- **`GALENE_API_TOKEN` is required at runtime** — the process exits with an error message if it is missing.
- **`GALENE_API_URL`** is the base URL of your Galene instance (default `http://localhost:3000`).
- It exposes the read-only API as tools: `galene_summary`, `galene_accounts`, `galene_transactions`, `galene_budgets`, `galene_scheduled`, `galene_categories`, `galene_notifications`, and `galene_version` (which Galene server version is running).

Usage is covered in [MCP server usage](#mcp-server-usage).

---

## Data, volumes, and backups

### Required: the database on a volume

Everything — accounts, transactions, budgets, bank-connection credentials, sessions, API tokens — lives in **one SQLite file** (`galene.db`, WAL mode) inside the data directory. The default data directory in the container is **`/app/data`**.

The app checks at startup (Linux only, via `/proc/mounts`) that the data directory sits on a **real mounted volume**, not the container's writable layer. If it doesn't, it refuses to start with:

```
Galene will not start: the data directory /app/data is on the container's
ephemeral filesystem, not a mounted volume. The database would be lost when
the container is removed. Mount a volume at /app/data (e.g. `docker run
-v galene_data:/app/data` or add a volumes entry to your compose file). Set
GALENE_ALLOW_EPHEMERAL_DATA=1 to override.
```

So every deployment must mount a volume:

```yaml
# compose
volumes:
  - galene_data:/app/data
```

```bash
# docker run
docker run -d --name galene \
  -v galene_data:/app/data \
  -p 3000:3000 \
  galene:app
```

- **Named volumes** (as above) are the simplest choice and survive container recreation.
- **Bind mounts** work too (`-v /path/on/host:/app/data`). The directory must be writable by uid **10001** (the `galene` user) — on a fresh bind mount you may need `chown 10001:10001 /path/on/host`. On SELinux systems (Fedora), add `:z` (or `:Z`) to the mount (see [Podman](#selinux)).
- The image pre-creates `/app/data` owned by `galene`, so a **fresh named volume** initialized from the image is already writable — no permission surprises.
- The check is skipped on non-Linux hosts (no `/proc/mounts`) so local development on macOS/Windows is unaffected, and can be overridden with **`GALENE_ALLOW_EPHEMERAL_DATA=1`** — do not use that override in a real deployment; it means the database dies with the container.

### Optional: a second volume for backups

Settings → **Backups** (admin only) copies the database to a **destination directory on the server** — an absolute path, created if it doesn't exist — on demand or on a schedule (15 minutes to a week), with an automatic retention period.

The UI's default placeholder is `/Volumes/backups/galene` (a macOS-style path). **In a container, set it to `/app/backups`** and mount that path on its own volume so backups survive container recreation:

```yaml
volumes:
  - galene_data:/app/data
  - galene_backups:/app/backups   # uncomment in docker-compose.yml
```

```bash
docker run -d --name galene \
  -v galene_data:/app/data \
  -v galene_backups:/app/backups \
  -p 3000:3000 \
  galene:app
```

Then in the UI: Settings → Backups → Folder → `/app/backups` → Save folder. (The compose file ships with the backups volume commented out — uncomment it if you use scheduled backups.)

> Backups are full copies of the database file, so they contain **every user's data** and all stored credentials. Treat the backups volume like the data volume: keep it private, and copy it off-box if you want redundancy beyond the host.

---

## Configuration (environment variables)

| Variable | Default (in container) | Description |
| --- | --- | --- |
| `GALENE_DATA_DIR` | `/app/data` | Directory for the database file. Must be a mounted volume (see above). |
| `GALENE_DB_PATH` | `$GALENE_DATA_DIR/galene.db` | Full path to the SQLite database. |
| `PORT` | `3000` | HTTP port the app listens on. |
| `NODE_ENV` | `production` (baked into the image) | Affects the session cookie's `Secure` flag by default — see below. |
| `GALENE_COOKIE_SECURE` | *(unset → follow `NODE_ENV`)* | Explicit override for the session cookie's `Secure` flag: `1`/`true`/`yes`/`on` → set; `0`/`false`/`no`/`off` → don't set. |
| `PROTOCOL_HEADER` | *(unset)* | Bun adapter: header name for the public scheme behind a TLS proxy — set to `x-forwarded-proto`. Required when TLS terminates upstream; without it origins stay `http://` under HTTPS and login/`use:enhance` can fail. |
| `HOST_HEADER` | *(unset → request `Host`)* | Bun adapter: header for the public hostname — `host` or `x-forwarded-host`. |
| `ADDRESS_HEADER` | *(unset)* | Optional Bun adapter: client IP header (e.g. `x-forwarded-for`) for logging / rate limits. |
| `XFF_DEPTH` | `1` | Optional Bun adapter: which hop in `X-Forwarded-For` is the client when `ADDRESS_HEADER=x-forwarded-for`. |
| `GALENE_ALLOW_EPHEMERAL_DATA` | *(unset)* | `1` disables the startup volume check. Only for throwaway/test containers. |

MCP image only:

| Variable | Default | Description |
| --- | --- | --- |
| `GALENE_API_URL` | `http://localhost:3000` | Base URL of the Galene instance the MCP server calls. |
| `GALENE_API_TOKEN` | — (**required**) | An API token from Settings → API. |

### The `Secure` cookie flag and plain HTTP

The session cookie is `Secure` by default in the image (production build). Over **plain HTTP** (no TLS-terminating proxy in front), browsers will not send a `Secure` cookie back — login appears to succeed, then immediately "fails" on the next request. The compose file therefore ships with **`GALENE_COOKIE_SECURE: "0"`** for plain-HTTP self-hosting.

- **Plain HTTP, no proxy** (LAN, Tailscale, WireGuard, …): leave `GALENE_COOKIE_SECURE: "0"`.
- **Behind a TLS-terminating reverse proxy**: set **`GALENE_COOKIE_SECURE: "1"`** so the cookie is only ever sent over HTTPS.

### TLS: you bring your own proxy

There is deliberately **no reverse-proxy service in the compose file** — the app listens on plain HTTP `:3000` and you put your own proxy (Caddy, nginx, Traefik, …) in front. Proxy to **HTTP** on the app port (never `https://` to the container). Minimal Caddyfile:

```
galene.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy’s `reverse_proxy` already sets `X-Forwarded-Proto` / host; the **app** must still opt in. In compose (or container env):

```yaml
environment:
  GALENE_COOKIE_SECURE: "1"
  PROTOCOL_HEADER: x-forwarded-proto
  HOST_HEADER: host
```

Checklist behind TLS:

1. Upstream is `http://127.0.0.1:3000` (or the app’s LAN/`host:port`) — not `https://` to the container.
2. `GALENE_COOKIE_SECURE: "1"`.
3. `PROTOCOL_HEADER: x-forwarded-proto` and `HOST_HEADER: host` (or `x-forwarded-host`).
4. Recreate the container so env takes effect; confirm login HTML uses `https://…` URLs (view-source), not `http://…`.

If the proxy and the container are on the same host, `127.0.0.1:3000` works; from a separate host/container, use the app's address on the network you share. Full examples: `docs/src/content/docs/self-host/reverse-proxy.mdx`.

---

## First run and admin account

1. Start the container and open <http://localhost:3000> (or your domain).
2. You land on **"Set up your account"** — the first account created on a server is always the **admin**.
3. Optionally tick **"Load demo data"** to seed sample accounts, ~3 months of transactions, budgets, and rules.
4. After that, the page is the normal login form.

Additional accounts (and more admins) are created by an admin under Settings → Users. Bank connections (SimpleFIN, Plaid, demo bank) are configured per user under Settings → Bank sync — no environment variables involved.

---

## Healthcheck and monitoring

- `docker ps` / `podman ps` shows `healthy` / `unhealthy`.
- The healthcheck is `GET /api/v1` → **401** (a reachable, answering server). Any other status, or a connection failure, marks the container unhealthy.
- The app logs to stdout/stderr — `docker logs galene` / `podman logs galene`.

---

## Checking the running version

The version (**major.minor** from `package.json`) plus the git commit and build date are baked in at build time. Four ways to see it:

- **In the app** — Settings → **About** (version, commit linked to GitHub, build date, check-for-updates link). Also shown on the login page.
- **HTTP** — `curl -s http://localhost:3000/version` → `{"name":"galene","version":"0.1","commit":"…","built_at":"…"}` (no authentication needed).
- **Image labels** — `docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}} {{index .Config.Labels "org.opencontainers.image.revision"}}' ghcr.io/<owner>/<repo>:app-latest`
- **Image tags** — `app-<ver>` / `mcp-<ver>` for releases, `app-latest` / `mcp-latest` for `main`, `app-test` / `mcp-test` for the `test` branch (for branch builds the baked-in version is the one in `package.json` at that commit).

---

## MCP server usage

The MCP server needs (1) a running Galene instance and (2) an API token (Settings → **API** → Create token — shown once, copy it now).

### Client on the same host as the container

Your MCP client (Claude Desktop, Grok, …) launches the container for each session:

```json
{
  "mcpServers": {
    "galene": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "GALENE_API_URL=http://localhost:3000",
        "-e", "GALENE_API_TOKEN=galene_…",
        "ghcr.io/<owner>/<repo>:mcp-latest"
      ]
    }
  }
}
```

`-i` is required (stdio transport); `--rm` cleans up after each session. If you published the image under a local name (e.g. `galene:mcp`), use that instead of the GHCR reference. If the app's port is remapped (e.g. `3103:3000`), point `GALENE_API_URL` at the mapped port.

### Client on another machine

Same, but `GALENE_API_URL` is the address of your Galene server, e.g. `http://galene.example.com:3000` (or the URL behind your proxy if the API is exposed there).

### Running it by hand

```bash
docker run -i --rm \
  -e GALENE_API_URL=http://localhost:3000 \
  -e GALENE_API_TOKEN=galene_… \
  galene:mcp
```

It speaks JSON-RPC over stdin/stdout (the MCP protocol) and exits when stdin closes.

---

## Podman

**Docker Hub is fine for Podman users.** The base images (`oven/bun:1.4.0`, `oven/bun:1.4.0-slim`) are pulled from Docker Hub, which Podman pulls from natively — no registry change needed. (If you ever want a different registry, you'd re-pin the base images in the `Dockerfile` and rebuild — not recommended; the Docker Hub images are the official Bun distribution.)

Everything else in this guide applies to Podman as-is, plus:

- **Rootless Podman is fine.** The app's port is 3000 (≥ 1024), so a rootless user can bind it without privileges. If you remap to a port **below 1024**, rootless needs `sysctl net.ipv4.ip_unprivileged_port_start=0` (or run privileged).
- **SELinux (Fedora/RHEL):** append `:z` (shared) or `:Z` (private) to **bind mounts** — e.g. `-v /path/on/host:/app/data:z`. Named volumes are relabeled by Podman automatically and need no suffix.
- **Compose:** use [`podman-compose`](https://github.com/containers/podman-compose) with the same `docker-compose.yml`, or convert to [Quadlet](https://docs.podman.io/en/latest_quadlet.html) container files.
- **Storage driver:** avoid `vfs` — it is very slow for the SQLite WAL workload. `overlay`/`overlay2` (default) is what you want.
- **Pulling from GHCR:** `podman login ghcr.io` with a **classic personal access token** that has `read:packages` (fine-grained tokens cannot access GHCR). Then `podman pull ghcr.io/<owner>/<repo>:app-latest`.

---

## Publishing to GitHub Container Registry (private beta)

The repo includes [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml), which publishes both images to **GHCR** — designed for your **private beta repo** (images "live in GitHub" before the repo goes public):

- **Triggers:** push to `main` or `test`, any `v*` tag, and manual runs (workflow_dispatch).
- **Tags produced:**
  - `ghcr.io/<owner>/<repo>:app-<ver>` and `:mcp-<ver>` — where `<ver>` is the tag without the `v` (e.g. `v1.2.3` → `1.2.3`), or the branch name for branch pushes
  - plus `:app-latest` / `:mcp-latest` on `main`
  - plus `:app-test-<sha>` / `:mcp-test-<sha>` (immutable, one per commit) on `test`
- **Releases:** the separate [`.github/workflows/release.yml`](.github/workflows/release.yml) (Actions → **Release**) is how you cut one: enter a version, it bumps `package.json`, commits, and tags `v<ver>` — the tag then lands here. The version is baked into the app (Settings → About, `GET /version`) and stamped as the `org.opencontainers.image.version` label, so the image tag, the app, and `package.json` always agree.
- **Auth:** the workflow uses the built-in `GITHUB_TOKEN` with `packages: write`, which can publish to the **workflow's own repository** — no secrets to configure for the beta repo.
- **Architecture:** multi-arch — **`linux/amd64` + `linux/arm64`**. The workflow builds both platforms (buildx + QEMU), so amd64 and Apple Silicon / arm64 hosts each pull a native image. The base `oven/bun` images are published for both architectures.
- The build step honors the Dockerfile's build-stage `ENV NODE_ENV=production`, so published images have the production defaults baked in (Secure cookie by default, etc.) — same as a local build.

### Testing a build before it reaches `main`

1. Push your work to the `test` branch — `git push origin HEAD:test`, or merge a PR into it.
2. The Docker workflow publishes `:app-test` / `:mcp-test` (always the latest `test` build) plus an immutable `:app-test-<sha>` / `:mcp-test-<sha>` for that exact commit.
3. On your server, point the compose file at `image: ghcr.io/<owner>/<repo>:app-test` (or the `-<sha>` tag to pin a specific build), then `docker compose pull && docker compose up -d`.
4. When it checks out, merge `test` into `main`. The `main` push refreshes `:app-latest` / `:mcp-latest`; switch the compose file back to `:app-latest` and pull again.

One wrinkle: a `test` build bakes in the `package.json` version at that commit — the last *released* version until the next release. The commit SHA (Settings → About, `GET /version`, the image's `org.opencontainers.image.revision` label) is what distinguishes one test build from another.

### Pulling the published images from your own machine

GHCR requires a token; use a **classic** personal access token (fine-grained tokens can't access GHCR) with the **`read:packages`** scope:

```bash
# Docker
echo "<PAT>" | docker login ghcr.io --username <github-user> --password-stdin
docker pull ghcr.io/<owner>/<repo>:app-latest
docker pull ghcr.io/<owner>/<repo>:mcp-latest

# Podman
podman login ghcr.io   # enter <github-user> and the PAT
podman pull ghcr.io/<owner>/<repo>:app-latest
```

Then in the compose file, comment out the `build:` block and set `image: ghcr.io/<owner>/<repo>:app-latest`.

---

## Upgrades

1. Check what you're running — Settings → **About**, `curl -s /version`, or the image's `org.opencontainers.image.version` label — and compare with the [releases](https://github.com/galene-finance/galene/releases).
2. Pull or build the new image (`docker compose pull` / rebuild, or `docker pull` the new tag).
3. Recreate the container: `docker compose up -d` (or `podman-compose up -d`).
4. The database **migrates automatically at startup** (versioned `PRAGMA user_version` migrations run in a transaction). Your data, sessions, and API tokens carry over — they live in the volume, not the image.
5. The `stop_grace_period: 40s` in the compose file gives the old container time to finish in-flight work before the new one starts.

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Container exits immediately: "Galene will not start: the data directory … is on the container's ephemeral filesystem" | You ran it without mounting a volume at `/app/data`. Add `-v galene_data:/app/data` (or the compose `volumes:` entry). `GALENE_ALLOW_EPHEMERAL_DATA=1` only for throwaway containers. |
| Login "succeeds" but you're bounced back to the login page on the next click | The session cookie is `Secure` but you're on plain HTTP. Set `GALENE_COOKIE_SECURE=0` (compose ships with this). Conversely, behind a TLS proxy set it to `1`. |
| Sign in does nothing / browser `file:///` security error / view-source still has `http://your.domain` under HTTPS | Missing adapter proxy env: set `PROTOCOL_HEADER=x-forwarded-proto` (and usually `HOST_HEADER=host`). Caddy may already send the headers — the app must opt in. Also ensure the proxy upstream is `http://…` to the app, not `https://`. |
| `docker ps` shows `unhealthy` | The app process isn't answering `GET /api/v1`. Check `docker logs` — usually a crash at startup (volume/permission issue) or a port conflict. |
| Permission errors on a **bind-mounted** data dir | The directory is owned by your host user, not uid 10001. `chown 10001:10001 /path/on/host`, or use a named volume instead. On SELinux hosts add `:z` to the mount. |
| Podman can't bind a port < 1024 as a normal user | `sysctl net.ipv4.ip_unprivileged_port_start=0`, or use a port ≥ 1024. |
| `podman pull ghcr.io/…` asks for credentials / fails with a fine-grained token | Use a **classic** PAT with `read:packages`; fine-grained tokens cannot access GHCR. |
| MCP client can't reach Galene | `GALENE_API_URL` must be reachable **from the MCP container**: `http://localhost:3000` only works when the client and the app share a host (use the mapped port, e.g. `http://localhost:3103`). From another machine, use the server's address. |
| MCP process exits instantly with "GALENE_API_TOKEN is required" | The client config is missing the `GALENE_API_TOKEN` env entry. Create a token in Settings → API. |
