#!/usr/bin/env bash
# Zet een backup terug in het banking-dashboard.
#
#   ./restore-dashboard.sh /home/roan/backups/banking-dashboard/dashboard-20261006-030000.db
#
# Let op: dit vervangt de huidige database. De container staat stil tijdens het
# terugzetten, en de WAL-bestanden gaan weg zodat SQLite niet een oude
# tussentijdse stand terugdraait.
set -euo pipefail

BRON="${1:?gebruik: restore-dashboard.sh <pad-naar-backup.db>}"
CONTAINER="${DASHBOARD_CONTAINER:-roans-banking-dashboard}"
IMAGE="${DASHBOARD_IMAGE:-roans-banking-dashboard-app}"
VOLUME="${DASHBOARD_VOLUME:-roans-banking-dashboard_data}"
COMPOSE_DIR="${DASHBOARD_COMPOSE_DIR:-/home/roan/docker/Roans-Banking-Dashboard}"

[ -f "$BRON" ] || { echo "bestaat niet: $BRON"; exit 1; }

# Eerst laten zien wat er in de backup zit, zodat je weet wat je terugzet.
python3 - "$BRON" <<'PY'
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
n = con.execute("select count(*) from transactions").fetchone()[0]
van = con.execute("select min(booking_date) from transactions").fetchone()[0]
tot = con.execute("select max(booking_date) from transactions").fetchone()[0]
print(f"backup bevat {n} transacties ({van} t/m {tot})")
PY

cd "$COMPOSE_DIR"
docker compose stop

# Terugzetten via een tijdelijke container op hetzelfde volume (de app draait
# niet, dus niets kan er tussendoor schrijven).
docker run --rm \
  --entrypoint sh \
  -v "$VOLUME:/app/data" \
  -v "$(dirname "$(realpath "$BRON")"):/backup:ro" \
  "$IMAGE" \
  -c "rm -f /app/data/dashboard.db-wal /app/data/dashboard.db-shm && cp /backup/$(basename "$BRON") /app/data/dashboard.db && echo teruggezet"

docker compose start
echo "klaar; controleer met: curl -s http://127.0.0.1:8200/api/accounts/summary"
