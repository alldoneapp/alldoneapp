#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:?Usage: ./deploy.sh <projectId> [firebase-admin-sdk-service-account]}"
REGION="${VM_CLOUD_RUN_JOB_REGION:-europe-west1}"
JOB_NAME="${VM_CLOUD_RUN_JOB_NAME:-vm-job-runner}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-jobs/${JOB_NAME}:latest"
SA="${2:-}"
# CI_MODE=1 skips the one-time project setup (API enablement, Artifact Registry repo
# creation, job IAM binding) that a minimal CI deploy identity may lack permission for.
# Run those once by an admin via a normal (non-CI) invocation; CI only rebuilds + redeploys.
CI_MODE="${CI_MODE:-}"

if [ -z "$SA" ]; then
    SA="$(gcloud iam service-accounts list --project="$PROJECT" \
        --filter="email:firebase-adminsdk" --format='value(email)' | head -n1)"
fi
if [ -z "$SA" ]; then
    echo "Could not find the firebase-adminsdk service account in ${PROJECT}." >&2
    exit 1
fi

if [ -z "$CI_MODE" ]; then
    gcloud services enable artifactregistry.googleapis.com cloudbuild.googleapis.com run.googleapis.com \
        --project="$PROJECT"
    gcloud artifacts repositories describe cloud-run-jobs --location="$REGION" --project="$PROJECT" >/dev/null 2>&1 || \
        gcloud artifacts repositories create cloud-run-jobs --repository-format=docker \
            --location="$REGION" --project="$PROJECT"
fi

# Submit the build asynchronously and poll its status. A service account without
# project Viewer cannot read the default Cloud Build logs bucket, so a streaming
# `gcloud builds submit` exits non-zero even when the build itself succeeds. --async
# skips streaming; polling uses builds.get (covered by roles/cloudbuild.builds.editor).
BUILD_ID="$(gcloud builds submit ../.. --project="$PROJECT" --config=cloudbuild.yaml \
    --substitutions="_IMAGE=${IMAGE}" --async --format='value(id)')"
echo "Cloud Build submitted: ${BUILD_ID}"
while true; do
    BUILD_STATUS="$(gcloud builds describe "$BUILD_ID" --project="$PROJECT" \
        --format='value(status)' 2>/dev/null || echo PENDING)"
    case "$BUILD_STATUS" in
        SUCCESS) echo "Cloud Build ${BUILD_ID}: SUCCESS"; break ;;
        FAILURE | TIMEOUT | CANCELLED | EXPIRED | INTERNAL_ERROR)
            echo "Cloud Build ${BUILD_ID}: ${BUILD_STATUS}" >&2; exit 1 ;;
        *) sleep 10 ;;
    esac
done

gcloud run jobs deploy "$JOB_NAME" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
    --service-account="$SA" --task-timeout=5h45m --max-retries=0 --tasks=1 --parallelism=1 \
    --memory=1Gi --cpu=1 --update-env-vars=VM_INTERACTIVE_EXECUTION_ENABLED=true

if [ -z "$CI_MODE" ]; then
    gcloud run jobs add-iam-policy-binding "$JOB_NAME" --project="$PROJECT" --region="$REGION" \
        --member="serviceAccount:${SA}" --role=roles/run.developer
fi

echo "Deployed ${JOB_NAME}. Configure E2B/API/proxy secrets as Cloud Run Job env/secrets before use."
