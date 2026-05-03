#!/usr/bin/env bash
# One-shot Cloud Run deploy for BioVault.
# Usage: PROJECT=dmjone REGION=asia-east1 ./scripts/deploy.sh

set -euo pipefail

PROJECT="${PROJECT:-${GOOGLE_CLOUD_PROJECT:-dmjone}}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-biovault}"
MEMORY="${MEMORY:-512Mi}"
CPU="${CPU:-1}"
MAX="${MAX:-3}"
MIN="${MIN:-0}"
CONCURRENCY="${CONCURRENCY:-40}"

cd "$(dirname "$0")/.."

echo ">> Project: $PROJECT  Region: $REGION  Service: $SERVICE"
gcloud config set project "$PROJECT" >/dev/null

echo ">> Ensuring required APIs are enabled…"
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    artifactregistry.googleapis.com \
    --project "$PROJECT" >/dev/null

echo ">> Deploying Cloud Run service '$SERVICE' from source…"
gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --project "$PROJECT" \
    --platform managed \
    --allow-unauthenticated \
    --min-instances "$MIN" \
    --max-instances "$MAX" \
    --cpu "$CPU" \
    --memory "$MEMORY" \
    --concurrency "$CONCURRENCY" \
    --port 8080 \
    --timeout 300 \
    --set-env-vars "LOG_LEVEL=INFO,CLOUD_RUN_REGION=$REGION" \
    --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format='value(status.url)')"

cat <<EOF

✓ Deployed
  service : $SERVICE
  region  : $REGION
  URL     : $URL

  app     : $URL/
  pitch   : $URL/pitch
  report  : $URL/report
  api docs: $URL/api/docs
  health  : $URL/health

EOF
