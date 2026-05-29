#!/usr/bin/env bash
#
# Grant the IAM roles needed for the execute_task_in_vm tool's `runVmJob` Cloud Tasks worker.
#
# WHICH SERVICE ACCOUNT — the Firebase Admin SDK SA, NOT the Cloud Run/compute SA.
# The functions initialize firebase-admin with admin.credential.cert(serviceAccountKey.json)
# (see functions/firebaseConfig.js), so EVERY firebase-admin call — including
# getFunctions().taskQueue().enqueue() and the task's OIDC dispatch — authenticates as
# firebase-adminsdk-*@<project>.iam.gserviceaccount.com. Granting the compute SA does nothing.
#
# THREE grants are required (Firebase does not set them up on deploy):
#   1. roles/cloudtasks.enqueuer   (PROJECT level)        -> create the task (enqueue)
#   2. roles/iam.serviceAccountUser on the SA itself      -> actAs, to mint the task's OIDC token
#   3. roles/run.invoker on the `runvmjob` Cloud Run svc  -> Cloud Tasks invokes the worker
#
# NOTE: grant enqueuer at the PROJECT level, not the queue level — a queue-scoped binding
# was observed NOT to be honored for firebase-admin's enqueue() path.
#
# Run this ONCE per environment, AFTER `runVmJob` has been deployed there. Idempotent.
#
# Usage:
#   ./grant-enqueuer.sh <projectId> [serviceAccountEmail]
# Examples:
#   ./grant-enqueuer.sh alldonealeph
#   ./grant-enqueuer.sh alldonestaging
#
set -euo pipefail

PROJECT="${1:?Usage: grant-enqueuer.sh <projectId> [serviceAccountEmail]}"
REGION="europe-west1"
RUN_SERVICE="runvmjob" # gen2 Cloud Run service name (lowercased function name)

# Principal = the Firebase Admin SDK SA (the cert credential firebase-admin uses).
# Auto-detect it unless one was passed explicitly.
SA="${2:-}"
if [ -z "$SA" ]; then
    SA="$(gcloud iam service-accounts list --project="$PROJECT" \
        --filter="email:firebase-adminsdk" --format='value(email)' | head -n1)"
fi
if [ -z "$SA" ]; then
    echo "Could not find a firebase-adminsdk service account in $PROJECT. Pass it explicitly." >&2
    exit 1
fi

echo "Project:         $PROJECT"
echo "Run service:     $RUN_SERVICE ($REGION)"
echo "Service account: $SA"
echo

gcloud services enable cloudtasks.googleapis.com run.googleapis.com --project="$PROJECT"

# 1. Enqueue: permission to create Cloud Tasks (project-level — queue-level not honored).
gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/cloudtasks.enqueuer" \
    --condition=None

# 2. actAs: the enqueuer must be able to act as the SA used in the task's OIDC token.
#    Here that SA is itself, so grant serviceAccountUser on the SA to the SA.
gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/iam.serviceAccountUser"

# 3. Dispatch: let Cloud Tasks invoke the private worker function.
gcloud run services add-iam-policy-binding "$RUN_SERVICE" \
    --region="$REGION" --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/run.invoker"

echo
echo "✅ Granted cloudtasks.enqueuer (project) + serviceAccountUser (self) + run.invoker on $RUN_SERVICE to $SA in $PROJECT"
