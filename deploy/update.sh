#!/usr/bin/env bash
# Deploy a new version: pull the latest code, rebuild, restart. Migrations
# run automatically when the app container starts (RUN_MIGRATIONS=true).
#   bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/backup.sh || echo "(backup failed — continuing)"
git pull --ff-only
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs --tail=40 app
