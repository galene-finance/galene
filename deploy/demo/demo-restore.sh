#!/usr/bin/env bash
# Reset the public demo database. Intended for the app host (systemd oneshot).
# Wipes SQLite files under the demo data dir; the next start with GALENE_DEMO=1
# recreates demo@test.com / demopass1 and realistic seed data.
#
# SQLite files are owned by the container user, so plain rm cannot unlink them.
# An EXIT trap starts the demo unit even when the wipe fails (set -e must not
# leave the unit stopped).
set -euo pipefail

DEMO_DATA_DIR="${GALENE_DEMO_DATA_DIR:-/opt/galene-demo}"
UNIT="${GALENE_DEMO_UNIT:-galene-demo}"
SEED_DB="${GALENE_DEMO_SEED_DB:-$DEMO_DATA_DIR/seed/galene.db}"

start_demo_unit() {
  if systemctl --user start "$UNIT"; then
    echo "started $UNIT"
  else
    echo "failed to start $UNIT" >&2
    return 1
  fi
}

if [[ ! -d "$DEMO_DATA_DIR" ]]; then
  echo "demo data dir missing: $DEMO_DATA_DIR" >&2
  exit 1
fi

# Refuse to touch production if misconfigured.
case "$DEMO_DATA_DIR" in
  /opt/galene|/opt/galene/) echo "refusing to wipe production data path" >&2; exit 1 ;;
esac

# Arm before stop so a failed wipe still brings the unit back.
trap start_demo_unit EXIT

systemctl --user stop "$UNIT" || true

# Optional golden snapshot (operator-maintained). Otherwise empty → bootstrap.
# podman unshare maps the container UID so rm can delete those files.
wipe_demo_db() {
  podman unshare rm -f \
    "$DEMO_DATA_DIR/galene.db" \
    "$DEMO_DATA_DIR/galene.db-wal" \
    "$DEMO_DATA_DIR/galene.db-shm"
}

if [[ -f "$SEED_DB" ]]; then
  wipe_demo_db
  cp -f "$SEED_DB" "$DEMO_DATA_DIR/galene.db"
  echo "restored seed snapshot from $SEED_DB"
else
  wipe_demo_db
  echo "wiped demo db; bootstrap will recreate on start"
fi
