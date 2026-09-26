#!/usr/bin/env bash
# Deploy a new version to Google Cloud: build the image, run pending
# database migrations, roll the service onto the new image.
#   PROJECT_ID=athleone-prod bash deploy/gcp/deploy.sh
# Optional: DOCAI_PROVIDER=google DOCAI_PROCESSOR_ID=... to switch on real
# fax reading at the same time.
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-athleone}"
REPO="${REPO:-athleone}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"
TAG="$(date +%Y%m%d-%H%M%S)"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Building $IMAGE:$TAG"
gcloud builds submit --tag "$IMAGE:$TAG" .

EXTRA=()
[ -n "${DOCAI_PROVIDER:-}" ] && EXTRA+=("DOCAI_PROVIDER=${DOCAI_PROVIDER}")
[ -n "${DOCAI_PROCESSOR_ID:-}" ] && EXTRA+=("DOCAI_PROCESSOR_ID=${DOCAI_PROCESSOR_ID}")
ENV_FLAG=()
[ ${#EXTRA[@]} -gt 0 ] && ENV_FLAG=(--update-env-vars "$(IFS=,; echo "${EXTRA[*]}")")

echo "==> Migrating the database"
gcloud run jobs update "${SERVICE}-migrate" --image "$IMAGE:$TAG" --region "$REGION" ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} >/dev/null
gcloud run jobs execute "${SERVICE}-migrate" --region "$REGION" --wait
gcloud run jobs update "${SERVICE}-task" --image "$IMAGE:$TAG" --region "$REGION" ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} >/dev/null

echo "==> Rolling out"
gcloud run services update "$SERVICE" --image "$IMAGE:$TAG" --region "$REGION" ${ENV_FLAG[@]+"${ENV_FLAG[@]}"} >/dev/null
gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)'
