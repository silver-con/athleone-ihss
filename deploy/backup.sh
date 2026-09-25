#!/usr/bin/env bash
# Dump the bundled Postgres to /var/backups/hearth, keeping 14 days.
# Add to cron for a nightly backup (as root):
#   echo "15 3 * * * root bash $(pwd)/deploy/backup.sh" > /etc/cron.d/hearth-backup
# Restore: gunzip -c FILE.sql.gz | docker compose --env-file .env.production exec -T db psql -U hearth -d hearth
# Backups contain PHI — keep them on this server or encrypted storage only.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=/var/backups/hearth
mkdir -p "$DEST" && chmod 700 "$DEST"
FILE="$DEST/hearth-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose --env-file .env.production exec -T db pg_dump -U hearth -d hearth --no-owner | gzip > "$FILE"
chmod 600 "$FILE"
find "$DEST" -name 'hearth-*.sql.gz' -mtime +14 -delete
echo "backup: $FILE"
