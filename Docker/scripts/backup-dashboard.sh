#!/usr/bin/env bash
# Maakt een consistente kopie van de database van het banking-dashboard.
#
# Draait op de host (docker + python3 nodig). Zet hem in cron, bijvoorbeeld:
#   30 3 * * * /home/roan/docker/Roans-Banking-Dashboard/scripts/backup-dashboard.sh >> /home/roan/backups/banking-dashboard/backup.log 2>&1
#
# Waarom: de bank gaat maar een beperkt aantal jaar terug. Wat het dashboard
# eenmaal heeft opgehaald is niet opnieuw op te halen, dus dat moet veilig staan.
set -euo pipefail

CONTAINER="${DASHBOARD_CONTAINER:-roans-banking-dashboard}"
BACKUP_DIR="${DASHBOARD_BACKUP_DIR:-/home/roan/backups/banking-dashboard}"
DAGEN="${DASHBOARD_BACKUP_DAYS:-60}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DOEL="$BACKUP_DIR/dashboard-$STAMP.db"

mkdir -p "$BACKUP_DIR"

# 1. Kopie maken met de sqlite-backup-API: een halve schrijfactie kan zo geen
#    kapotte kopie opleveren (beter dan het bestand los kopiëren).
docker exec -i "$CONTAINER" python - <<'PY'
import sqlite3
bron = sqlite3.connect("/app/data/dashboard.db")
doel = sqlite3.connect("/app/data/__backup.db")
bron.backup(doel)
doel.close()
PY

docker cp "$CONTAINER:/app/data/__backup.db" "$DOEL"
docker exec -i "$CONTAINER" rm -f /app/data/__backup.db
chmod 600 "$DOEL"

# 2. Controle: leesbaar en met inhoud, anders gaat de kopie weg.
python3 - "$DOEL" <<'PY'
import sqlite3, sys
pad = sys.argv[1]
con = sqlite3.connect(pad)
try:
    transacties = con.execute("select count(*) from transactions").fetchone()[0]
    rekeningen = con.execute("select count(*) from accounts").fetchone()[0]
    oudste = con.execute("select min(booking_date) from transactions").fetchone()[0]
except sqlite3.Error as fout:
    raise SystemExit(f"backup is niet leesbaar: {fout}")
if transacties == 0:
    raise SystemExit("backup heeft geen transacties, bewaar hem niet")
print(f"controle: {transacties} transacties, {rekeningen} rekeningen, oudste {oudste}")
PY

# 3. Opruimen: dagelijkse kopieën een beperkte tijd, en één kopie per maand
#    die blijft staan.
find "$BACKUP_DIR" -name 'dashboard-2*.db' -type f -mtime +"$DAGEN" -delete
if [ "$(date +%d)" = "01" ]; then
  cp -n "$DOEL" "$BACKUP_DIR/dashboard-maand-$(date +%Y%m).db" || true
fi

echo "$(date '+%F %T') backup ok: $DOEL"
