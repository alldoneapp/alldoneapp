#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:?Usage: ./deploy.sh <projectId> [firebase-admin-sdk-service-account]}"
REGION="${VM_CLOUD_RUN_JOB_REGION:-europe-west1}"
JOB_NAME="${VM_CLOUD_RUN_JOB_NAME:-vm-job-runner}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-jobs/${JOB_NAME}:latest"
SA="${2:-}"

if [ -z "$SA" ]; then
    SA="$(gcloud iam service-accounts list --project="$PROJECT" \
        --filter="email:firebase-adminsdk" --format='value(email)' | head -n1)"
fi
if [ -z "$SA" ]; then
    echo "Could not find the firebase-adminsdk service account in ${PROJECT}." >&2
    exit 1
fi

gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com run.googleapis.com \
    --project="$PROJECT"
gcloud artifacts repositories describe cloud-run-jobs --location="$REGION" --project="$PROJECT" >/dev/null 2>&1 || \
    gcloud artifacts repositories create cloud-run-jobs --repository-format=docker \
        --location="$REGION" --project="$PROJECT"

gcloud builds submit ../.. --project="$PROJECT" --config=cloudbuild.yaml \
    --substitutions="_IMAGE=${IMAGE}"

gcloud run jobs deploy "$JOB_NAME" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
    --service-account="$SA" --task-timeout=5h45m --max-retries=0 --tasks=1 --parallelism=1 \
    --memory=1Gi --cpu=1

gcloud run jobs add-iam-policy-binding "$JOB_NAME" --project="$PROJECT" --region="$REGION" \
    --member="serviceAccount:${SA}" --role=roles/run.developer

echo "Deployed ${JOB_NAME}. Configure E2B/API/proxy secrets as Cloud Run Job env/secrets before use."
