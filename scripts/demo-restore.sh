#!/usr/bin/env bash
# Reset the public demo database. Intended for the app host (systemd oneshot).
# Wipes SQLite files under the demo data dir; the next start with GALENE_DEMO=1
# recreates demo@test.com / demopass1 and realistic seed data.
set -euo pipefail

DEMO_DATA_DIR="${GALENE_DEMO_DATA_DIR:-/opt/galene-demo}"
UNIT="${GALENE_DEMO_UNIT:-galene-demo}"
SEED_DB="${GALENE_DEMO_SEED_DB:-$DEMO_DATA_DIR/seed/galene.db}"

if [[ ! -d "$DEMO_DATA_DIR" ]]; then
  echo "demo data dir missing: $DEMO_DATA_DIR" >&2
  exit 1
fi

# Refuse to touch production if misconfigured.
case "$DEMO_DATA_DIR" in
  /opt/galene|/opt/galene/) echo "refusing to wipe production data path" >&2; exit 1 ;;
esac

systemctl --user stop "$UNIT" || true

# Optional golden snapshot (operator-maintained). Otherwise empty → bootstrap.
if [[ -f "$SEED_DB" ]]; then
  rm -f "$DEMO_DATA_DIR"/galene.db "$DEMO_DATA_DIR"/galene.db-wal "$DEMO_DATA_DIR"/galene.db-shm
  cp -f "$SEED_DB" "$DEMO_DATA_DIR/galene.db"
  echo "restored seed snapshot from $SEED_DB"
else
  rm -f "$DEMO_DATA_DIR"/galene.db "$DEMO_DATA_DIR"/galene.db-wal "$DEMO_DATA_DIR"/galene.db-shm
  echo "wiped demo db; bootstrap will recreate on start"
fi

systemctl --user start "$UNIT"
echo "started $UNIT"
