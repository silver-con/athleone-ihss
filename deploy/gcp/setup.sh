#!/usr/bin/env bash
# One-time Google Cloud setup for Athleone: Cloud Run + Cloud SQL (Postgres)
# + Cloud Storage + Secret Manager + Document AI access, in ONE region.
#
# Run it from the hearth-intake-app folder, in Google Cloud Shell (it has
# gcloud already) or on a Mac with the gcloud CLI signed in:
#
#   PROJECT_ID=athleone-prod REGION=us-central1 bash deploy/gcp/setup.sh
#
# Safe to re-run: every step skips what already exists. It prints the app's
# address at the end. Full walkthrough: deploy/DEPLOY-GOOGLE-CLOUD.md
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID, e.g. PROJECT_ID=athleone-prod}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-athleone}"
DB_INSTANCE="${DB_INSTANCE:-athleone-db}"
DB_NAME="${DB_NAME:-athleone}"
DB_USER="${DB_USER:-athleone}"
DB_TIER="${DB_TIER:-db-g1-small}"        # small shared-core; raise for real load
BUCKET="${BUCKET:-${PROJECT_ID}-athleone-files}"
REPO="${REPO:-athleone}"
RUN_SA="${SERVICE}-run@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

say() { printf '\n==> %s\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

gcloud config set project "$PROJECT_ID" >/dev/null

say "Enabling services (a minute or two the first time)"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com documentai.googleapis.com \
  iam.googleapis.com >/dev/null

say "Service account the app runs as: $RUN_SA"
exists gcloud iam service-accounts describe "$RUN_SA" || \
  gcloud iam service-accounts create "${SERVICE}-run" --display-name "Athleone (Cloud Run)"
# Project-wide: Cloud SQL client and Document AI user only. Secret access is
# granted per secret below, bucket access on the bucket only.
for role in roles/cloudsql.client roles/documentai.apiUser; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUN_SA" --role "$role" --condition=None >/dev/null
done

say "Private bucket for fax files: gs://$BUCKET"
if ! exists gcloud storage buckets describe "gs://$BUCKET"; then
  gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
fi
# Create + read objects; the app never deletes or overwrites fax files.
for role in roles/storage.objectCreator roles/storage.objectViewer; do
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$RUN_SA" --role "$role" >/dev/null
done

say "Postgres (Cloud SQL): $DB_INSTANCE — creating takes ~10 minutes the first time"
if ! exists gcloud sql instances describe "$DB_INSTANCE"; then
  gcloud sql instances create "$DB_INSTANCE" --database-version POSTGRES_16 --edition ENTERPRISE --tier "$DB_TIER" --region "$REGION" \
    --storage-auto-increase --backup-start-time 08:00 --enable-point-in-time-recovery --availability-type zonal
fi
exists gcloud sql databases describe "$DB_NAME" --instance "$DB_INSTANCE" || gcloud sql databases create "$DB_NAME" --instance "$DB_INSTANCE"
CONN="$(gcloud sql instances describe "$DB_INSTANCE" --format 'value(connectionName)')"

secret() { # secret NAME VALUE — creates the secret once; never overwrites
  if ! exists gcloud secrets describe "$1"; then
    printf '%s' "$2" | gcloud secrets create "$1" --replication-policy automatic --data-file=- >/dev/null
    echo "   created secret $1"
  else
    echo "   secret $1 already exists (kept)"
  fi
}

say "Database user + secrets"
if ! exists gcloud secrets describe athleone-database-url; then
  DB_PASS="$(openssl rand -hex 24)"
  if exists gcloud sql users describe "$DB_USER" --instance "$DB_INSTANCE"; then
    gcloud sql users set-password "$DB_USER" --instance "$DB_INSTANCE" --password "$DB_PASS" >/dev/null
  else
    gcloud sql users create "$DB_USER" --instance "$DB_INSTANCE" --password "$DB_PASS" >/dev/null
  fi
  secret athleone-database-url "postgresql://${DB_USER}:${DB_PASS}@/${DB_NAME}?host=/cloudsql/${CONN}"
fi
secret athleone-session-secret "$(openssl rand -hex 32)"
secret athleone-evv-credentials-key "$(openssl rand -hex 32)"
for s in athleone-database-url athleone-session-secret athleone-evv-credentials-key; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$RUN_SA" --role roles/secretmanager.secretAccessor >/dev/null
done

say "Container registry"
exists gcloud artifacts repositories describe "$REPO" --location "$REGION" || \
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION"

say "Building the app image with Cloud Build (~5 minutes)"
gcloud builds submit --tag "$IMAGE:latest" .

# --update-* (not --set-*) everywhere below, so re-running this script keeps
# settings added later (email/SMS keys, DOCAI_PROVIDER=google, …). Settings
# are only included when given; the app's defaults cover the rest
# (DOCAI_PROVIDER defaults to demo).
ENVS="STORAGE_DRIVER=gcs,GCS_BUCKET=${BUCKET},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},DOCAI_LOCATION=${DOCAI_LOCATION:-us}"
[ -n "${DOCAI_PROVIDER:-}" ] && ENVS="${ENVS},DOCAI_PROVIDER=${DOCAI_PROVIDER}"
[ -n "${DOCAI_PROCESSOR_ID:-}" ] && ENVS="${ENVS},DOCAI_PROCESSOR_ID=${DOCAI_PROCESSOR_ID}"
# "Try a sample fax" buttons: on for a brand-new service (a demo server) unless
# ALLOW_SAMPLE_FAXES=false; switch off for real use (see the guide).
if [ -n "${ALLOW_SAMPLE_FAXES:-}" ]; then
  ENVS="${ENVS},ALLOW_SAMPLE_FAXES=${ALLOW_SAMPLE_FAXES}"
elif ! exists gcloud run services describe "$SERVICE" --region "$REGION"; then
  ENVS="${ENVS},ALLOW_SAMPLE_FAXES=true"
fi
SECRETS="DATABASE_URL=athleone-database-url:latest,SESSION_SECRET=athleone-session-secret:latest,EVV_CREDENTIALS_KEY=athleone-evv-credentials-key:latest"

say "Database migrations (Cloud Run job)"
gcloud run jobs deploy "${SERVICE}-migrate" --image "$IMAGE:latest" --region "$REGION" --service-account "$RUN_SA" \
  --set-cloudsql-instances "$CONN" --update-env-vars "$ENVS" --update-secrets "$SECRETS" \
  --command node --args=--disable-warning=MODULE_TYPELESS_PACKAGE_JSON,scripts/migrate.mjs --max-retries 0 --task-timeout 600 >/dev/null
gcloud run jobs execute "${SERVICE}-migrate" --region "$REGION" --wait

say "One-off task job (seed, create platform admin) — see deploy/gcp/run-script.sh"
gcloud run jobs deploy "${SERVICE}-task" --image "$IMAGE:latest" --region "$REGION" --service-account "$RUN_SA" \
  --set-cloudsql-instances "$CONN" --update-env-vars "$ENVS" --update-secrets "$SECRETS" \
  --command node --args=--disable-warning=MODULE_TYPELESS_PACKAGE_JSON,scripts/migrate.mjs,--status --max-retries 0 --task-timeout 600 >/dev/null

say "Deploying the app (Cloud Run service)"
gcloud run deploy "$SERVICE" --image "$IMAGE:latest" --region "$REGION" --service-account "$RUN_SA" \
  --add-cloudsql-instances "$CONN" --update-env-vars "$ENVS" --update-secrets "$SECRETS" \
  --allow-unauthenticated --no-cpu-throttling --min-instances "${MIN_INSTANCES:-0}" --max-instances 4 \
  --memory 1Gi --cpu 1 --timeout 300 --port 8080 >/dev/null

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
say "Pointing APP_BASE_URL at $URL"
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "APP_BASE_URL=${URL}" >/dev/null

cat <<EOF

Athleone is live: $URL

Next steps (deploy/DEPLOY-GOOGLE-CLOUD.md):
  1. Create your platform admin:  bash deploy/gcp/run-script.sh create-platform-admin.mjs --email=you@x.com --name="You" --password="…"
  2. Demo data (demo server only): bash deploy/gcp/run-script.sh seed.mjs --yes-reset-demo-data
  3. Real fax reading: set DOCAI_PROVIDER=google and DOCAI_PROCESSOR_ID, then bash deploy/gcp/deploy.sh
  4. Email/SMS keys: see the guide (Secret Manager + --update-secrets).
EOF
