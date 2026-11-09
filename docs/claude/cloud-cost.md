# Cloud cost review

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Cloud cost (reviewed 2026-09-02, August invoice EUR 334.79, ~EUR 306 of it Alldone)

Roughly half of the Alldone spend was idle capacity, not usage, and the levers are all in this repo
or one gcloud command away. What was found, and what is now in place:

- **Warm instances are the biggest line (EUR 123/month for 14 of them).** Seven functions carry
  `minInstances` — the two assistant entry points, `onUpdateChat`, and the four telephony
  webhooks/workers — and each costs ~EUR 8/month at 512MiB or ~EUR 11 at 1GiB around the clock.
  `minInstances` has been removed from every function in `functions/index.js`; the first pass
  gated it on the deployment project so **staging never keeps one warm** (it paid EUR 54/month for an environment with
  no traffic). `onUpdateChat` lost its warm instance outright: a Firestore trigger has nobody
  waiting on its latency. The four telephony functions (`whatsAppIncomingCall`, `phoneIncomingCall`,
  `openAIRealtimeCallWebhook`, `runWhatsAppRealtimeCall`) lost theirs the same day by decision:
  their comments cited measured cold starts of 7.7s and 14.5s on a live call, but they cost
  ~EUR 36/month for three calls in August. The last two, `askToBot` and
  `generatePreConfigTaskResult`, followed later that day, so **no function keeps a warm instance**
  now; the only always-on service is the notes collab server, which holds rooms in memory. If phone calls become a real feature again, the cheap fix is one warm
  `onRequest` routing all three webhooks, not four warm services.
- **Staging's scheduled functions are paused** (all 40 Cloud Scheduler jobs, via
  `gcloud scheduler jobs pause`). They ran every production schedule against an idle database.
  Resume them with `gcloud scheduler jobs resume` if a scheduled feature needs staging QA; a
  staging functions deploy does NOT un-pause them.
- **The notes collab server moved from App Engine Flexible (EUR 40/month) to Cloud Run on
  2026-09-02.** It is stock y-websocket 1.3.17 from
  `gitlab.com/alldonegmbh/alldone-notes-collab-server` (a Dockerfile was added for the move),
  deployed as `alldone-notes-collab-server` in `europe-west1` with `--min-instances=1
--max-instances=1 --session-affinity --concurrency=1000 --timeout=3600` — one instance is
  required, rooms live in memory. Request-based billing is right for it (idle min-instance plus
  CPU while a note is open ≈ EUR 15-18/month); instance-based billing would cost as much as Flex.
  The URL reaches the web build through the GitLab CI variable `NOTES_COLLABORATION_SERVER`
  (shared by staging and production builds), not through the repo. The Flex version
  `20211118t131148` is stopped, not deleted; its image lives in
  `gs://us.artifacts.alldonealeph.appspot.com`, which is why that legacy bucket still exists —
  delete both together once the Cloud Run server has run for a while. The other three legacy
  Container Registry buckets (prod `eu.artifacts`, both staging ones, 246 GB) are gone.
- **A second trigger on the same document path bills every write twice.**
  `onUpdateCalendarGoalRoutingFeedbackSecondGen` sat next to `onUpdateTaskSecondGen` on
  `items/{projectId}/tasks/{taskId}`, so every task update paid two invocations (387k + 464k in
  August) and the second returned immediately almost every time. It now runs inside
  `onUpdateTaskSecondGen` (`captureCalendarGoalRoutingFeedbackIfChanged`). Before adding an
  `onDocument*` trigger, check whether one already exists on that path.
- **Request-based billing charges wall clock, so a poller that awaits reads one at a time pays for
  the waiting.** `checkTaskAlerts` and `checkRecurringAssistantTasks` run every five minutes and
  spent 24s and 40s per run on sequential Firestore queries (343k vCPU-seconds a month for the
  latter, to conclude nothing was due). Both now fetch through
  `functions/Utils/mapWithConcurrency.js`; the number of reads is unchanged.
- **`onUpdateUser` re-indexed the whole user once per project on every write** — including
  `lastLogin`, gold and xp — which was 56 GB/month of egress to the search index for records that
  had not changed. `searchIndexedFieldsChanged` in `onUpdateUserFunctions.js` gates it on the
  fields `mapUserData` actually indexes.
- **Artifact Registry had no cleanup on `cloud-run-jobs`** (220 `vm-job-runner` images, 65 GB —
  the runner is rebuilt on every `functions/**` change). Both projects now keep the 5 most recent
  versions and delete anything older than 7 days; `gcf-artifacts` already had Firebase's own
  1-day policy.
- **Firestore reads (EUR 36/month, +37% MoM) are the one line that is real usage and growing**:
  71M billed reads for ~10 users active in the last 30 days. The database is in `nam5`
  (multi-region, double the regional read price). Server pollers account for only a few million;
  the rest is client-side and unattributed. Billing export to BigQuery
  (`alldonealeph:billing_export`) is enabled so the next review has per-SKU, per-day data.
- **The nightly managed Firestore export was the single most expensive thing on the bill, and it
  hid from every metric.** `scheduledFirestoreBackupSecondGen` exported all 5.27M documents to
  `gs://alldonealeph-backups` every day. Google bills a managed export at **one read per document**
  and states those reads do not appear in the usage console, so nothing in Monitoring showed
  ~5.3M reads/day (~EUR 3/day, ~EUR 85/month). It had been failing silently under the compute
  service account and only started succeeding on 2026-08-29 when functions moved to the Admin SDK
  SA — which is what the September forecast jump was. Replaced on 2026-09-02 by a **native backup
  schedule** (`gcloud firestore backups schedules create --recurrence=daily --retention=7d`,
  storage-only billing, restore with `gcloud firestore databases restore`); the function and
  `functions/Utils/firestoreBackup.js` are gone. Do not reintroduce `exportDocuments` on a
  schedule; if an export is ever needed (e.g. BigQuery analysis), run it once by hand.
- Deleted for good: a `us-central1` forwarding rule + target pool in staging left by GitLab
  "managed apps" in 2020 (EUR 17/month pointing at a GKE node that no longer existed).
