#!/usr/bin/env bash
set -euo pipefail

# Builds and deploys the isolated Playwright browser worker as its own Cloud Run SERVICE
# (the VM runner next door is a Cloud Run JOB — different shape, different lifecycle).
#
# Deliberately NOT wired into .gitlab-ci.yml: this repo's documented automatic deploys cover
# functions, the web build and the VM runner image, and adding a fourth one is a production change
# that has to be decided rather than smuggled in with a feature branch. Run it by hand, once per
# environment, when the feature is actually being switched on.
#
# Usage: ./deploy.sh <projectId> [firebase-admin-sdk-service-account]

PROJECT="${1:?Usage: ./deploy.sh <projectId> [service-account]}"
REGION="${BROWSER_WORKER_REGION:-europe-west1}"
SERVICE_NAME="${BROWSER_WORKER_SERVICE_NAME:-browser-worker}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-jobs/${SERVICE_NAME}:latest"
SA="${2:-}"
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

# Same async-build + poll shape as the VM runner deploy: a service account without project Viewer
# cannot read the default Cloud Build logs bucket, so streaming exits non-zero on a successful build.
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

# --no-allow-unauthenticated AND ingress=internal: the signed token is the second lock, not the
# first. Chromium needs the memory; concurrency stays low because each session is a browser context.
gcloud run deploy "$SERVICE_NAME" --project="$PROJECT" --region="$REGION" --image="$IMAGE" \
    --service-account="$SA" --no-allow-unauthenticated --ingress=internal-and-cloud-load-balancing \
    --memory=2Gi --cpu=2 --concurrency=4 --min-instances=0 --max-instances=3 --timeout=120s \
    --set-env-vars="BROWSER_WORKER_MAX_SESSIONS=8"

echo
echo "Deployed ${SERVICE_NAME}."
echo "Still required before the tool can run:"
echo "  1. Set BROWSER_WORKER_SIGNING_SECRET on the service (same value as in GOOGLE_FUNCTIONS_ENV_*)."
echo "  2. Put BROWSER_WORKER_URL / BROWSER_WORKER_SIGNING_SECRET / BROWSER_ALLOWED_DOMAINS into"
echo "     GOOGLE_FUNCTIONS_ENV_DEV or _PROD, and confirm they are listed in envFunctionsHelper.js."
echo "  3. Grant the functions service account roles/run.invoker on ${SERVICE_NAME}:"
echo "     gcloud run services add-iam-policy-binding ${SERVICE_NAME} --project=${PROJECT} \\"
echo "       --region=${REGION} --member=serviceAccount:${SA} --role=roles/run.invoker"
echo "  4. Restrict egress if the deployment requires it (see browser/README.md, threat model)."
