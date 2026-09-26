#!/usr/bin/env bash
# Run one of the app's scripts against the Cloud SQL database, as a one-off
# Cloud Run job execution. Examples:
#   PROJECT_ID=athleone-prod bash deploy/gcp/run-script.sh seed.mjs --yes-reset-demo-data
#   PROJECT_ID=athleone-prod bash deploy/gcp/run-script.sh create-platform-admin.mjs --email=you@x.com --name="Your Name" --password="long passphrase"
#   PROJECT_ID=athleone-prod bash deploy/gcp/run-script.sh migrate.mjs --status
# Output appears in the job's logs (the command prints the link).
# Arguments are stored in the job execution's history (visible to project
# members), so change a password given here after the first sign-in.
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-athleone}"
[ $# -ge 1 ] || { echo "usage: run-script.sh <script.mjs> [args...]"; exit 1; }
SCRIPT="$1"; shift
# '|' as the list separator, so arguments may contain commas and spaces.
ARGS="^|^--disable-warning=MODULE_TYPELESS_PACKAGE_JSON|scripts/${SCRIPT}"
for a in "$@"; do
  case "$a" in *"|"*) echo "An argument contains '|', which this script uses as a separator. Choose a value without it."; exit 1;; esac
  ARGS="${ARGS}|${a}"
done
gcloud config set project "$PROJECT_ID" >/dev/null
gcloud run jobs execute "${SERVICE}-task" --region "$REGION" --args="$ARGS" --wait
echo "Logs: https://console.cloud.google.com/run/jobs/details/${REGION}/${SERVICE}-task/executions?project=${PROJECT_ID}"
