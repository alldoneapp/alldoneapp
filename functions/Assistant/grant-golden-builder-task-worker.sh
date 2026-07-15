#!/usr/bin/env bash
# Grant the Firebase Admin SDK service account permission to enqueue and invoke
# the private runGoldenBuild Cloud Tasks worker (per-project golden E2B template
# builder). Run once per environment AFTER deploying the runGoldenBuild function.
#
# Cloud Tasks IAM is NOT configured by `firebase deploy`. The three grants below
# must land on the firebase-adminsdk SA (NOT the compute SA — firebase-admin
# authenticates as firebase-adminsdk because of the explicit cert credential in
# functions/firebaseConfig.js). IAM changes take up to ~7 min to propagate.
set -euo pipefail

PROJECT="${1:?Usage: grant-golden-builder-task-worker.sh <projectId> [serviceAccountEmail]}"
REGION="europe-west1"
RUN_SERVICE="rungoldenbuild" # gen2 lowercases the function name
SA="${2:-}"

if [ -z "$SA" ]; then
    SA="$(gcloud iam service-accounts list --project="$PROJECT" \
        --filter="email:firebase-adminsdk" --format='value(email)' | head -n1)"
fi
if [ -z "$SA" ]; then
    echo "Could not find a firebase-adminsdk service account in $PROJECT. Pass it explicitly." >&2
    exit 1
fi

gcloud services enable cloudtasks.googleapis.com run.googleapis.com --project="$PROJECT"
# 1) Project-level enqueue (queue-scoped is not honored for firebase-admin enqueue()).
gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/cloudtasks.enqueuer" \
    --condition=None
# 2) Self actAs, to mint the task's OIDC token.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/iam.serviceAccountUser"
# 3) Invoke the worker Cloud Run service (gen2 lowercases the function name).
gcloud run services add-iam-policy-binding "$RUN_SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/run.invoker"

echo "Granted golden-builder Cloud Tasks IAM roles to $SA in $PROJECT."
