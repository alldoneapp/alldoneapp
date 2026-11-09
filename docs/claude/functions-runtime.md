# Cloud Functions runtime, timeouts and IAM

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Firebase Functions

Located in `functions/`. Deploys to the **Node 22** runtime, and that is pinned in **two**
places: `runtime` in `firebase.json` is what firebase-tools actually obeys, and
`engines.node` in `functions/package.json` is what everything else reads. Changing only
the latter deploys on the old runtime while reporting success - the log says
`updating Node.js <old> ...` for every function and nothing fails, so check that line
rather than the summary. Worse, once both pins agree, firebase-tools still skips every
function whose **source hash** is unchanged - the runtime is not part of that hash - and
logs `Skipping the deploy of unchanged functions` / `Skipped (No changes detected)`. A
runtime move therefore needs a source change under `functions/` to land at all, and
`firebase.json` must be in the deploy job's `changes` list or the job never runs. `ci/Dockerfile_functions` builds on the matching `node:22-alpine`
so `npm ci` runs on the same major it deploys to. Google decommissions a runtime about
eighteen months after deprecating it - Node 20 goes on 2026-10-31, Node 22 on 2027-10-31 -
and the pinned `firebase-tools@13.29.3` carries that table, so check it there before moving.
Changing `engines.node` rebuilds every function, not just the changed ones, which tends to
exhaust the per-minute Cloud Functions mutation quota; retry the job rather than treating
the 429s as a real failure.

Uses Firebase Functions v2 syntax:

- `onDocumentCreated`, `onDocumentUpdated`, `onDocumentDeleted` for Firestore triggers
- `onSchedule` for scheduled functions
- `onCall`, `onRequest` for HTTP functions

**Important**: Cloud Functions cannot import non-cloud function modules directly. Keep function code self-contained or use shared helpers within `functions/`.

**Function timeout ceilings differ by how the function is invoked**, and exceeding one is a deploy-time rejection, not a slow function:

| invocation                                                 | ceiling   | why                                                                                                  |
| ---------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `onCall` / `onRequest` / `onSchedule`                      | **3600s** | HTTP-invoked (a schedule is Cloud Scheduler calling the Cloud Run service)                           |
| `onTaskDispatched`                                         | **1800s** | Cloud Tasks' HTTP dispatch deadline — this is why `startVmJob` uses a detached Cloud Run Job instead |
| `onDocument*` / `onObjectFinalized` / `onMessagePublished` | **540s**  | delivered through Eventarc                                                                           |

**The failure is silent and partial.** `firebase deploy` reports overall success while the one offending function is rejected with `CreateFunction … "The timeout for functions with an event trigger cannot exceed 540 seconds."`, so its producer keeps queueing work that nothing consumes. This cost a full production outage of the AI workflow-step worker: `onUpdateTask` kept writing `workflowAiRuns` docs that piled up as `pending` for hours, because the worker had never been created. To find it: `gcloud logging read 'protoPayload.methodName:"CreateFunction" AND severity>=ERROR' --project=<projectId> --freshness=2d`. After any deploy that adds a function, confirm it exists (`gcloud functions list --project=<projectId> | grep <name>`) rather than trusting the deploy summary.

## IAM for firebase-admin GCP calls — use the Firebase Admin SDK SA, not the compute SA

This is a repo-wide gotcha, learned the hard way. Gen2 Functions are configured through `setGlobalOptions` to run as the environment's `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` service account, and `functions/firebaseConfig*.js` uses application-default credentials in that managed runtime. Therefore **every firebase-admin call that hits a Google Cloud API authenticates as the firebase-adminsdk service account — NOT the `<projectNumber>-compute@developer.gserviceaccount.com` default runtime SA**. So when a function needs a new GCP IAM permission (Cloud Tasks, Pub/Sub, etc.), grant the role to the **firebase-adminsdk SA**. Granting the compute SA looks right but does nothing. The old CI service-account JSON files may still be prepared for legacy tooling, but Functions no longer depend on baking that long-lived key into Cloud Run revisions. IAM changes also take up to ~7 min to propagate — wait before re-testing.
