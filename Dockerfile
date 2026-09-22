# Galene — one build, two targets:
#   --target app : the web app (Bun.serve, port 3000, SQLite in /app/data, backups in /app/backups)
#   --target mcp : the MCP server (stdio; talks outbound to the app's REST API)
#
# Base images are pinned to the Bun version that generated bun.lock.
#
# Deliberately NO `VOLUME` instruction: a bare `docker run` without a volume
# mount would land the database on the container's writable layer, and the app
# refuses to start in that case (see assertDataDirOnVolume in src/lib/server/db.ts).
# `docker compose` declares the named volume explicitly.

# ---------- build ----------
FROM oven/bun:1.4.0 AS build
WORKDIR /app

# Build metadata baked into the app (src/lib/version.ts) and stamped as OCI
# labels below. The publishing workflow passes these; the defaults keep a
# bare `docker build` (no args) working.
ARG GIT_SHA=local
ARG BUILD_DATE=unknown
# package.json version (the single source of truth); the workflow passes the
# tag instead when publishing from a tag.
ARG APP_VERSION=dev

# Vite statically replaces process.env.NODE_ENV in the SSR bundle with the
# build-time value (the runtime value is never read), so the build must run
# with NODE_ENV=production for production defaults (e.g. Secure session
# cookie) to be baked in.
ENV NODE_ENV=production \
    VITE_GIT_COMMIT=$GIT_SHA \
    VITE_BUILD_DATE=$BUILD_DATE

# Install dependencies first so this layer is cached across source-only changes
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# SvelteKit build (custom Bun adapter → build/) and the MCP server as a
# single self-contained bundle (no node_modules needed at runtime)
RUN bun run build

# The MCP bundle bakes in the package.json version (bun build can't bundle
# JSON imports, so it's passed as a define).
RUN bun build mcp/index.ts --target=bun --define GALENE_VERSION="\"$APP_VERSION\"" --outfile=mcp-dist/mcp-bundle.js

# ---------- app ----------
FROM oven/bun:1.4.0-slim AS app

# Non-root runtime user (guarded in case a base image revision ships one)
RUN id galene >/dev/null 2>&1 || useradd -m -u 10001 galene
USER galene

# OCI image metadata (visible via `docker inspect`). APP_VERSION is the
# package.json version (or the tag, when the workflow publishes from a tag).
ARG GIT_SHA=local
ARG BUILD_DATE=unknown
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.revision="${GIT_SHA}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.source="https://github.com/galene-finance/galene"

WORKDIR /app

# NODE_ENV=production makes the session cookie Secure by default; compose
# sets GALENE_COOKIE_SECURE=0 for plain-HTTP self-hosting (see docker-compose.yml).
ENV GALENE_DATA_DIR=/app/data \
    GALENE_BACKUP_ROOT=/app/backups \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

COPY --from=build --chown=galene:galene /app/build ./build

# Created in the image so a named volume initialized from them is owned by the
# app user (a fresh named volume would otherwise be root-owned and unwritable).
RUN mkdir -p /app/data /app/backups && chown galene:galene /app/data /app/backups

# /api/v1 answers 401 without a token — a reachable, answering server
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD bun -e 'fetch("http://localhost:3000/api/v1").then(r => process.exit(r.status === 401 ? 0 : 1)).catch(() => process.exit(1))'

CMD ["bun", "build/index.js"]

# ---------- mcp ----------
FROM oven/bun:1.4.0-slim AS mcp

RUN id galene >/dev/null 2>&1 || useradd -m -u 10001 galene
USER galene

ARG GIT_SHA=local
ARG BUILD_DATE=unknown
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version="${APP_VERSION}" \
    org.opencontainers.image.revision="${GIT_SHA}" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.source="https://github.com/galene-finance/galene"

WORKDIR /app

# stdio unless GALENE_MCP_PORT is set. HTTP reads the API token from
# each request. Do not put the token in the environment for that mode.
ENV GALENE_API_URL=http://localhost:3000

COPY --from=build --chown=galene:galene /app/mcp-dist/mcp-bundle.js ./mcp-bundle.js

EXPOSE 3001
CMD ["bun", "mcp-bundle.js"]
