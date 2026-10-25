# Project wiki (knowledge base)

A Karpathy-style wiki per project: markdown pages an LLM compiles from the project's tasks,
goals, notes and contacts, kept current by ingest runs and read by the project's assistants.
The design notes live in the module headers; this file is the operational checklist.

The web client reads the wiki straight from Firestore (`utils/backends/KnowledgeBase/`) and
renders it in `components/WikiView/` (the `ROOT_WIKI` root tab, `/projects/{id}/wiki[/slug]`, and
`/projects/{id}/wiki/{slug}/changes/{revision}` for what one revision changed, as a diff);
its settings are the project details tab `PROJECT_WIKI` (`/project/{id}/wiki-settings`).

| Module                           | Role                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `knowledgeBaseModel.js`          | Paths, limits, slugs, `[[slug]]` / `[[task:ID]]` tokens, settings validation            |
| `knowledgeBaseSettings.js`       | `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh` callables                     |
| `collectKnowledgeSources.js`     | Delta of objects visible to the whole project, as source cards                          |
| `knowledgeSourceInvalidation.js` | Hides and empties pages citing a withdrawn object, redacts their revisions              |
| `knowledgePageStore.js`          | The one place a page is written: citation, revision and concurrency checks              |
| `knowledgeBaseIngest.js`         | One ingest run (rebuilds, then delta), billed as `knowledge_base_ingest`                |
| `knowledgeBaseDispatcher.js`     | Enqueues due runs onto the `runKnowledgeBaseIngest` Cloud Tasks queue                   |
| `knowledgeBaseAssistant.js`      | Wiki index in assistant prompts; read, correct and undo tools                           |
| `knowledgeBaseToolSchemas.js`    | Names and schemas of those tools (dependency-free, for `toolSchemas.js`)                |
| `knowledgeWikiFeedModel.js`      | How a revision appears in Updates: ids, change kinds (dependency-free, shared with web) |
| `knowledgeWikiFeed.js`           | The revision trigger's body: one Updates line per revision, no page text in it          |

## Deploying

1. `deploy:firestore:rules:<env>` — the `knowledgeBases/{projectId}/**` rule (members read, no
   client writes).
2. Functions: `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh`, `undoKnowledgeCorrection`,
   `runKnowledgeBaseIngest`, `dispatchKnowledgeBaseIngests`, `onCreateKnowledgePageRevisionSecondGen`
   (the Updates feed lines), plus the task/goal/note/contact update
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
