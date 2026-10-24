# Project wiki (knowledge base)

A Karpathy-style wiki per project: markdown pages an LLM compiles from the project's tasks,
goals, notes and contacts, kept current by ingest runs and read by the project's assistants.
The design notes live in the module headers; this file is the operational checklist.

| Module                           | Role                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `knowledgeBaseModel.js`          | Paths, limits, slugs, `[[slug]]` / `[[task:ID]]` tokens, settings validation |
| `knowledgeBaseSettings.js`       | `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh` callables          |
| `collectKnowledgeSources.js`     | Delta of objects visible to the whole project, as source cards               |
| `knowledgeSourceInvalidation.js` | Hides pages citing an object that turned private or was deleted              |
| `knowledgePageStore.js`          | The one place a page is written: citation, revision and concurrency checks   |
| `knowledgeBaseIngest.js`         | One ingest run (rebuilds, then delta), billed as `knowledge_base_ingest`     |
| `knowledgeBaseDispatcher.js`     | Enqueues due runs onto the `runKnowledgeBaseIngest` Cloud Tasks queue        |

## Deploying

1. `deploy:firestore:rules:<env>` — the `knowledgeBases/{projectId}/**` rule (members read, no
   client writes).
2. Functions: `setKnowledgeBaseSettings`, `requestKnowledgeBaseRefresh`, `runKnowledgeBaseIngest`,
   `dispatchKnowledgeBaseIngests`, plus the task/goal/note/contact update and delete triggers that
   now invalidate pages.
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
