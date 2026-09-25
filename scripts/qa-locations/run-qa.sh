#!/usr/bin/env bash
# Automated QA for the locations/franchise feature, the three-tier role
# model, and manual referral entry.
#
# Runs the REAL lib/queries.js functions against a THROWAWAY Postgres
# database loaded from the REAL db/schema.sql. It never touches your dev
# database — it creates `hearth_qa_scratch`, uses it, and drops it.
#
# Usage, from anywhere:
#   ./run-qa.sh /path/to/hearth-intake-app
# or from inside the repo:
#   ./run-qa.sh
set -euo pipefail

REPO="$(cd "${1:-$(pwd)}" && pwd)"
if [[ ! -f "$REPO/db/schema.sql" ]]; then
  echo "error: no db/schema.sql under $REPO — pass the repo path as the first argument." >&2
  exit 1
fi

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_NAME="hearth_qa_scratch"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> repo:    $REPO"
echo "==> scratch: $WORK"

# 1. Fresh throwaway database from the real schema.
dropdb --if-exists "$DB_NAME"
createdb "$DB_NAME"
psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" -f "$REPO/db/schema.sql"
echo "==> schema loaded into $DB_NAME"

# 2. Copy the query layer and rewrite the '@/lib/db' alias, which plain
#    node can't resolve (Next's tsconfig paths only apply inside Next).
cp "$REPO/lib/queries.js" "$REPO/lib/db.js" "$REPO/lib/data.js" "$REPO/lib/state-compliance.js" "$REPO/lib/evv-mapping.js" "$REPO/lib/permissions.js" "$REPO/lib/client-identity.js" "$REPO/lib/passwords.js" "$REPO/lib/calendar.js" "$REPO/lib/geo.js" "$REPO/lib/evv-export.js" "$REPO/lib/pg-config.js" "$WORK/"
sed -i.bak   -e "s|from '@/lib/db'|from './db.js'|"   -e "s|from '@/lib/data'|from './data.js'|"   -e "s|from '@/lib/state-compliance'|from './state-compliance.js'|"   -e "s|from '@/lib/evv-mapping'|from './evv-mapping.js'|"   -e "s|from '@/lib/client-identity'|from './client-identity.js'|"   -e "s|from '@/lib/calendar'|from './calendar.js'|"   -e "s|from '@/lib/geo'|from './geo.js'|"   "$WORK/queries.js" "$WORK/evv-mapping.js" && rm -f "$WORK"/*.bak
cp "$QA_DIR/qa.mjs" "$QA_DIR/qa-regression.mjs" "$QA_DIR/qa-roles.mjs" "$QA_DIR/qa-scoping.mjs" "$QA_DIR/qa-referral-create.mjs" "$QA_DIR/qa-multi-state.mjs" "$QA_DIR/qa-platform-dashboard.mjs" "$QA_DIR/qa-admin-dashboard.mjs" "$QA_DIR/qa-audit-log.mjs" "$QA_DIR/qa-client-evv-identity.mjs" "$QA_DIR/qa-access-control.mjs" "$QA_DIR/qa-visit-maintenance.mjs" "$QA_DIR/qa-visit-locations.mjs" "$QA_DIR/qa-evv-export.mjs" "$QA_DIR/qa-bill-hours.mjs" "$QA_DIR/qa-overlap.mjs" "$QA_DIR/qa-evv-sender.mjs" "$WORK/"
# The EVV sender and its HHAeXchange adapter, plus the repo's mock
# aggregator, for qa-evv-sender.mjs (end-to-end queue -> send -> poll).
cp "$REPO/lib/evv-sync.js" "$REPO/lib/hhaexchange.js" "$REPO/lib/secrets.js" "$WORK/"
cp "$REPO/lib/evv-adapters/index.js" "$WORK/evv-adapters.js"
cp "$REPO/mocks/hhaexchange-mock.mjs" "$WORK/"
sed -i.bak -e "s|from '@/lib/queries'|from './queries.js'|" -e "s|from '@/lib/evv-adapters'|from './evv-adapters.js'|" -e "s|from '@/lib/evv-mapping'|from './evv-mapping.js'|" -e "s|from '@/lib/hhaexchange'|from './hhaexchange.js'|" -e "s|from '@/lib/secrets'|from './secrets.js'|" "$WORK/evv-sync.js" "$WORK/evv-adapters.js" "$WORK/hhaexchange.js" && rm -f "$WORK"/*.bak
printf '{\n  "type": "module"\n}\n' > "$WORK/package.json"

# 3. Reuse the repo's own installed pg driver rather than re-downloading.
if [[ -d "$REPO/node_modules/pg" ]]; then
  ln -s "$REPO/node_modules" "$WORK/node_modules"
else
  (cd "$WORK" && npm install pg --silent)
fi

# 4. Run every suite.
# Socket-form URL so this honours the same PGHOST/PGPORT/PGUSER that
# createdb/psql above already used — no assumptions about TCP or ports.
export DATABASE_URL="postgresql:///$DB_NAME"
STATUS=0
(cd "$WORK" && node qa.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-regression.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-roles.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-scoping.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-referral-create.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-multi-state.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-platform-dashboard.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-admin-dashboard.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-audit-log.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-client-evv-identity.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-access-control.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-visit-maintenance.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-visit-locations.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-evv-export.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-bill-hours.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-overlap.mjs) || STATUS=1
psql -q -d "$DB_NAME" -c "TRUNCATE organizations CASCADE;" 2>/dev/null
(cd "$WORK" && node qa-evv-sender.mjs) || STATUS=1

# 5. Clean up the scratch database.
dropdb --if-exists "$DB_NAME"
echo "==> dropped $DB_NAME"
exit $STATUS
