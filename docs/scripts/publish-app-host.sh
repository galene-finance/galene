#!/usr/bin/env bash
# Build Starlight docs and rsync to the app host:/opt/galene-docs
# Must run on a local build host that can SSH to the app host.
# GitHub-hosted runners cannot reach a private LAN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
REMOTE="${GALENE_DOCS_SSH:?Set GALENE_DOCS_SSH to your docs/app host (SSH Host or user@host)}"
DEST="${GALENE_DOCS_DEST:-/opt/galene-docs}"

cd "$ROOT"
echo "Building docs in $ROOT …"
bun install --frozen-lockfile
bun run build

COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "commit=$COMMIT"
  echo "built_at=$BUILT_AT"
  echo "source=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)@$SHORT"
} > dist/.galene-docs-build

echo "Publishing to $REMOTE:$DEST …"
rsync -av --delete \
  --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  dist/ "$REMOTE:$DEST/"

ssh "$REMOTE" "test -f $DEST/index.html && cat $DEST/.galene-docs-build && du -sh $DEST"
echo "Done. Point your reverse proxy file_server (or reverse proxy) at $DEST on the app host."
