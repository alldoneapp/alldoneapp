# Project wiki (knowledge base)

A Karpathy-style wiki per project: markdown pages an LLM compiles from the project's tasks,
goals, notes, contacts, comment threads (topics and the chats of those objects) and artifacts, and
from documents members add to it through an assistant, kept current by ingest runs and read by the
project's assistants.
The design notes live in the module headers; this file is the operational checklist.

The web client reads the wiki straight from Firestore (`utils/backends/KnowledgeBase/`) and
renders it in `components/WikiView/` (the `ROOT_WIKI` root tab, `/projects/{id}/wiki[/slug]`, and
`/projects/{id}/wiki/{slug}/changes/{revision}` for what one revision changed, as a diff);
its settings are the project details tab `PROJECT_WIKI` (`/project/{id}/wiki-settings`).

| Module                            | Role                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `knowledgeBaseModel.js`           | Paths, limits, slugs, `[[slug]]` / `[[task:ID]]` tokens, settings validation            |
| `knowledgeBaseSettings.js`        | `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh` callables                     |
| `collectKnowledgeSources.js`      | Delta of objects visible to the whole project, as source cards                          |
| `knowledgeArtifactText.js`        | The text an artifact's current entry file contributes to its source card                |
| `knowledgeSourceInvalidation.js`  | Hides and empties pages citing a withdrawn object, redacts their revisions              |
| `knowledgePageStore.js`           | The one place a page is written: citation, revision and concurrency checks              |
| `knowledgeBaseIngest.js`          | One ingest run (rebuilds, current-state pass, delta), billed as `knowledge_base_ingest` |
| `knowledgeCurrentStateRewrite.js` | Requests the one-time pass that rewrites existing pages to the current state            |
| `knowledgeBaseDispatcher.js`      | Enqueues due runs onto the `runKnowledgeBaseIngest` Cloud Tasks queue                   |
| `knowledgeBaseSchedule.js`        | The payer's nightly slot, and whether the payer is active (30-day login window)         |
| `knowledgeBaseDefaults.js`        | Switches the wiki on by default for active users' projects; resumes and hands over      |
| `knowledgeBaseAssistant.js`       | Wiki index in assistant prompts; read, correct, undo and document tools                 |
| `knowledgeBaseToolSchemas.js`     | Names and schemas of those tools (dependency-free, for `toolSchemas.js`)                |
| `knowledgeDocuments.js`           | Add a chat upload to the wiki (`documents/{id}`), or take it out again                  |
| `knowledgeWikiFeedModel.js`       | How a revision appears in Updates: ids, change kinds (dependency-free, shared with web) |
| `knowledgeWikiFeed.js`            | The revision trigger's body: one Updates line per revision, no page text in it          |

A document's text comes from `WhatsApp/whatsAppFileExtraction.js`, which reads PDF, Word, text
and — through `Utils/officeDocumentText.js` — PowerPoint (.pptx) and Excel (.xlsx). Adding one
needs no new function: the tools run inside the existing assistant entry points, and the immediate
run goes through the same `runKnowledgeBaseIngest` queue as "refresh now".

## Deploying

1. `deploy:firestore:rules:<env>` — the `knowledgeBases/{projectId}/**` rule (members read, no
   client writes).
2. Functions: `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh`, `undoKnowledgeCorrection`,
   `runKnowledgeBaseIngest`, `dispatchKnowledgeBaseIngests`, `onCreateKnowledgePageRevisionSecondGen`
   (the Updates feed lines), `applyKnowledgeBaseDefaults` (the daily default switch-on, which also
   reaches the projects that existed before the default; no migration to run), `onCreateProjectSecondGen`
   and `onUpdateUserSecondGen` (the same default for a new project and a returning user), plus the
   task/goal/note/contact/artifact/chat update
   and delete triggers that invalidate pages and every function that runs an assistant (the wiki
   context and tools live in `Assistant/assistantHelper.js`).
3. Once per environment, after the first deploy of the worker, let the Firebase Admin SDK service
   account invoke it. Project-level `roles/cloudtasks.enqueuer` and self `actAs` are already in
   place from the heartbeat worker (`functions/Assistant/grant-heartbeat-task-worker.sh`); only the
   invoker binding on the new service is missing:

    ```sh
    SA="$(gcloud iam service-accounts list --project=<projectId> \
        --filter='email:firebase-adminsdk' --format='value(email)' | head -n1)"
    gcloud run services add-iam-policy-binding runknowledgebaseingest \
        --region=europe-west1 --project=<projectId> \
        --member="serviceAccount:${SA}" --role=roles/run.invoker
    ```

    Staging has two `firebase-adminsdk` accounts; grant both. IAM takes up to ~7 minutes.

4. Confirm the functions exist (`gcloud functions list --project=<projectId> | grep -i knowledge`)
   rather than trusting the deploy summary.

No composite index is needed: every query is a single-field range or equality.

## Rewriting existing pages to the current state (one-time)

Pages written before the current-state rules may still narrate meetings or list options that have
since been decided. After `runKnowledgeBaseIngest` is deployed, request the pass for every enabled
wiki (or one, with `--project-id=<id>`); without `--execute` it only lists what it would request:

```sh
node migration/rewriteKnowledgeBasesToCurrentState.js --firebase-project-id=<projectId>
node migration/rewriteKnowledgeBasesToCurrentState.js --firebase-project-id=<projectId> --execute
```

Each wiki becomes due at once, and its runs then rewrite up to ten pages each, continuing a minute
later until the list on the wiki document (`currentStateRewrite`) is empty. It is billed to the
wiki's owner and stops at the monthly cap like any other run; what is left continues next month.
