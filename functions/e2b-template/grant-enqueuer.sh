#!/usr/bin/env bash
#
# Grant the Cloud Functions runtime service account permission to enqueue Cloud Tasks
# for the execute_task_in_vm tool's `runVmJob` worker.
#
# WHY THIS IS NEEDED: Firebase auto-creates the `runVmJob` Cloud Tasks queue when the
# onTaskDispatched function is deployed, but it does NOT grant the enqueuer role to the
# function's runtime service account. Without it, the very first enqueue fails with:
#   "lacks IAM permission cloudtasks.tasks.create for .../queues/runVmJob"
# and the tool refunds the user's Gold and reports it couldn't start.
#
# This binding lives outside the repo (it's project IAM), so run this script ONCE per
# environment, AFTER `runVmJob` has been deployed there. It is idempotent.
#
# Usage:
#   ./grant-enqueuer.sh <projectId> [serviceAccountEmail]
# Examples:
#   ./grant-enqueuer.sh alldonealeph      # prod  (auto-detects the runtime SA)
#   ./grant-enqueuer.sh alldonestaging    # staging
#
set -euo pipefail

PROJECT="${1:?Usage: grant-enqueuer.sh <projectId> [serviceAccountEmail]}"
REGION="europe-west1"
QUEUE="runVmJob"

# Auto-detect the asktobotsecondgen runtime service account (the function that enqueues)
# unless one was passed explicitly.
SA="${2:-}"
if [ -z "$SA" ]; then
    SA="$(gcloud run services describe asktobotsecondgen \
        --region="$REGION" --project="$PROJECT" \
        --format='value(spec.template.spec.serviceAccountName)')"
fi

echo "Project:         $PROJECT"
echo "Region:          $REGION"
echo "Queue:           $QUEUE"
echo "Service account: $SA"
echo

# The Cloud Tasks API must be enabled (it is implicitly enabled once runVmJob deploys,
# but enable it explicitly so this script is safe to run standalone).
gcloud services enable cloudtasks.googleapis.com --project="$PROJECT"

# Grant enqueuer scoped to just the runVmJob queue (least privilege).
gcloud tasks queues add-iam-policy-binding "$QUEUE" \
    --location="$REGION" --project="$PROJECT" \
    --member="serviceAccount:${SA}" \
    --role="roles/cloudtasks.enqueuer"

echo
echo "✅ Granted roles/cloudtasks.enqueuer on queue '$QUEUE' to $SA in $PROJECT"
