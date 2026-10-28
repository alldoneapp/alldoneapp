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
| `knowledgeContributions.js`       | "Save to wiki": knowledge from a chat (`contributions/{id}`), drafts, confirm, remove   |
| `knowledgeSearch.js`              | `search_knowledge` (fresh Firestore scan, passages) and the `dev_wiki` search index     |
| `knowledgeLint.js`                | Health check: rule-based report every run, weekly bounded model pass                    |
| `knowledgeWikiFeedModel.js`       | How a revision appears in Updates: ids, change kinds (dependency-free, shared with web) |
| `knowledgeWikiFeed.js`            | The revision trigger's body: one Updates line per revision, no page text in it          |

A document's text comes from `WhatsApp/whatsAppFileExtraction.js`, which reads PDF, Word, text
and — through `Utils/officeDocumentText.js` — PowerPoint (.pptx) and Excel (.xlsx). Adding one
needs no new function: the tools run inside the existing assistant entry points, and the immediate
run goes through the same `runKnowledgeBaseIngest` queue as "refresh now".

## Assistant research across projects (AT-2889)

For project-knowledge questions, assistants first select the project the question concerns using
known context or `get_user_projects` (names and descriptions), then read its wiki before searching
tasks, notes or chats. The chat's project only supplies the initial index; it does not fix the
research project. A question about JTL in a personal chat must read the JTL index and relevant
pages with the JTL `projectId` on both calls. Page summaries alone do not count as reading a page.
Original sources follow when the wiki is missing, incomplete, stale or contradicted, or when the
user explicitly asks for them. Routine greetings, direct changes, task IDs and date-based
listings do not require wiki research.

Member runs receive these instructions and `read_knowledge_page` even if the chat project has
no wiki or only rebuilding pages. Every read checks membership of its target project. Email
runs remain excluded; correction and document tool availability retain their separate rules.
Wiki reads count against the shared research budget, just like other workspace reads.

## Reading, freshness and search

`read_knowledge_page` returns the sources a page's body cites and only the count of the others
(`otherSourceCount`). The full `sourceKeys` list stays on the page document because the privacy
withdrawal relies on it (a sentence can outlive its citation), but returned whole it made a read
several times the size of the page. The wiki view shows the cited sources and folds the rest
behind "Show N more sources". Every read and the assistant context say when the wiki last caught
up (`lastSuccessfulRunAt`, written by completed and partial runs) and that later changes may be
missing.

`search_knowledge` scores the pages of the target project read fresh from Firestore and quotes
passages, so a page hidden for a rebuild a second ago is never found. `allProjects: true` asks the
`dev_wiki` Typesense collection which of the member's projects have candidate pages, then scans
only those (without Typesense: up to 12 wikis). Global search in the app has a Wiki tab on the
same collection, searched with the scoped key like every other tab; a record is
`isPublicFor: ['0']` because the scoped key's `projectId` filter is already the whole access rule,
and the page text is matched but never returned. `onWriteKnowledgePageSecondGen` keeps a record in
step with its page, and `invalidateKnowledgeSource` removes withdrawn pages from the index itself
before that trigger runs.

## Saving knowledge from a chat

`save_knowledge_contribution` is offered to the runs that may correct (and over MCP), and the
assistant is told to use it only on an explicit request. The member's own words with nothing
private in them are saved at once. An assistant summary, text that may hold private information,
or text for another project's wiki only creates a draft in the server-only
`knowledgeContributionDrafts` collection (never in the member-readable wiki tree); the assistant
shows the exact text and confirms with `{ draftId, confirmed: true }`. Where the channel has
message ids, confirming needs a later message than the draft's. Email addresses, phone numbers and
credentials are refused outright. A contribution is cited as `[[contribution:ID]]`, its card marks
it as a member's statement rather than a verified record, and the ingest keeps disagreements with
other sources as open questions. `remove_knowledge_contribution` withdraws it like a removed
document (pages hidden and rebuilt, revisions redacted).

## Health check (lint)

After the delta, every run that changed pages (or has no report yet) stores a rule-based
`lintReport` on the wiki document: oversized pages, broken links, orphans, duplicate titles and
uncited source entries (counted, never pruned). Once the run has caught up, at most every 7 days
and only when a page changed since, a model pass looks at up to three batches of pages for
contradictions, outdated dated claims, missing pages and links. It may change at most 10 pages,
never one a member corrected in the last 14 days, records every change as revision mode `lint`
with a reason starting `lint:`, and only spends while the month is below 80% of the wiki's Gold
cap. It never settles a contradiction by recency alone: unresolved ones go to an "Open questions"
section. State lives in `lint` on the wiki document.

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
   context and tools live in `Assistant/assistantHelper.js`), `onWriteKnowledgePageSecondGen`
   (the global-search record of a page) and `mcpServer` (the wiki search and save tools).
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

5. Index the existing pages for global search once per environment (new pages are indexed by
   `onWriteKnowledgePageSecondGen`; dry run without `--execute`):

    ```sh
    node migration/backfillTypesense.js --firebase-project-id=<projectId> --types=wiki --force --execute
    ```

No composite index is needed: every query is a single-field range or equality. No rules change
is needed either: `knowledgeContributionDrafts` falls under the default deny.

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

## When a run fails (AT-2870)

A model request that breaks off transiently is retried twice, a second or two apart, inside the
OpenRouter transport (`Assistant/openRouterChatClient.js`; what counts as transient is decided in
`Assistant/transientModelErrors.js`). The ingest asks the transport to hold back each answer until
it is complete (`bufferModelOutput`), so a broken stream can be retried wherever it broke off, and
a tool call is only ever executed from a stream that finished. If the run still fails on a transient
error, it schedules and enqueues the next run 7 minutes later (`transientFailureRetries` on the
wiki document, at most 3 in a row). Every other failure, and the fourth transient one in a row,
waits for the nightly slot as before. A failed run keeps what its finished blocks wrote; the block
it was working on is read again (and billed again) by the next run.
