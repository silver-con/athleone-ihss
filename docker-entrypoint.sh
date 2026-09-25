#!/bin/sh
# Container start: optionally bring the database up to date, then start.
# RUN_MIGRATIONS=true (the default in docker-compose.yml) runs
# scripts/migrate.mjs first — safe every time, it only applies what's
# pending. If it fails, the container stops rather than serving an app
# whose code doesn't match its database.
set -e
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] running database migrations…"
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/migrate.mjs
fi
exec "$@"
