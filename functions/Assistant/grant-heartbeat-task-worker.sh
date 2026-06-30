#!/usr/bin/env bash
# Grant the Firebase Admin SDK service account permission to enqueue and invoke
# the private runAssistantHeartbeat Cloud Tasks worker. Run after deploying the worker.
set -euo pipefail

PROJECT="${1:?Usage: grant-heartbeat-task-worker.sh <projectId> [serviceAccountEmail]}"
REGION="europe-west1"
RUN_SERVICE="runassistantheartbeat"
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
gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/cloudtasks.enqueuer" \
    --condition=None
gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/iam.serviceAccountUser"
gcloud run services add-iam-policy-binding "$RUN_SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/run.invoker"

echo "Granted heartbeat Cloud Tasks IAM roles to $SA in $PROJECT."
