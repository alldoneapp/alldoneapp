# Algolia → Typesense Cloud Migration Plan

> **Phase 5 implemented (2026-08-12) — MIGRATION COMPLETE.** Algolia is out of the
> codebase: `algoliasearch` uninstalled (root + functions), dual-writes removed (the write
> primitives in `AlgoliaGlobalSearchHelper.js` are Typesense-only, renamed `*SearchRecord*`),
> `creatorFacetReindex` + its two `index.js` exports deleted, client/server engine flags
> removed (`utils/searchEngine.js` gone — Typesense IS the engine), `searchFilters.js`
> merged into `typesenseSearchFilters.js` (which now owns `CREATOR_ATTRIBUTE_BY_INDEX` +
> `getProjectAccessIds`), `getAlgoliaSearchOnlyKeys`/`ALGOLIA_*` env removed from
> firestore.js/BackendBridge/replace-envs.sh/envFunctionsHelper. The AT-2258 facet contract
> test now pins the Typesense COLLECTION_SCHEMAS. **User actions to finish decommissioning:**
> cancel the Algolia subscription, and optionally delete the GitLab `ALGOLIA_*` CI variables
> (`ALGOLIA_APP_ID_DEV/_PROD`, `ALGOLIA_SEARCH_ONLY_API_KEY_DEV/_PROD`, and the admin keys
> inside the `GOOGLE_FUNCTIONS_ENV_DEV/_PROD` blobs). `components/GlobalSearchAlgolia/` keeps
> its legacy directory name on purpose (a rename is pure churn; do it opportunistically).
>
> **Phase 4 implemented (2026-08-12):** the "Activate full search for 500 Gold" checkbox
> (`ActiveFullSearch.js`), its gold/indexing flow, the admin reindex sidebar item, the
> two i18n strings, and the `activeFullSearchDate` user mapping are deleted. Server side:
> the `indexProjectsRecordsInAlgoliaSecondGen` callable, all 7 `onStartIndexingAlgolia*`
> triggers, `onEndIndexingAlgoliaFullSearch`, and the 14-day expiry job
> (`checkAndRemoveInactiveObjectsFromAlgolia`) are gone; `createRecord`/`updateRecord`
> index EVERYTHING with no gates or recency windows (both stores — Algolia stays a
> faithful rollback target until Phase 5); the stale-project job now only flips
> `projects.active` (query shape kept for index safety). The Guide tab in the search
> project picker always shows. Vestigial `activeFullSearch*` writes remain in
> HelperScripts.js admin utilities (inert). Remaining: Phase 5 after 2–4 stable weeks.
>
> **Status (2026-08-12): Phases 0–2 COMPLETE.** Dual-write deployed to production
> (pipeline #8171) and confirmed live. Full backfill executed against `alldonealeph`:
> 4,824 projects + global assistants, **223,731 documents, 0 failures** (dev_tasks 185,975 ·
> dev_goals 17,772 · dev_notes 4,546 · dev_contacts 8,402 · dev_updates 7,036). Three defects
> found & fixed along the way: the bulk notes path called `mapNoteData` with 2 args (every
> bulk note reindex threw — pre-existing, also broke the legacy 500-gold flow), typesense-js
> throws `ImportError` instead of returning per-doc results, and legacy tasks carry garbage
> `dueDate` values (floats + one whole task object; normalizer now rounds/drops).
> Two corrupt task docs in Firestore itself:
> `items/-OdN3r3av39Be2Cbii8H/tasks/-OdN4DDMkRPF8byMNWrn` and
> `items/-Of0mXwuHe-fcjsFE5IU/tasks/-Of0rp0rgly-APXNG2LV` (whole task object under `dueDate`)
> — indexed without dueDate; consider repairing the docs (repair running in separate session).
>
> **Phase 3 implemented (2026-08-12):** reads cut over behind flags — client
> `utils/searchEngine.js` (`SEARCH_ENGINE = 'typesense'`, key-aware: missing env falls back
> to Algolia reads), server `SEARCH_READS_FROM_TYPESENSE` in `functions/typesenseHelper.js`.
> GlobalSearchModal searches all 5 tabs in ONE multi_search; scope toggles ship with it
> (archived / templates & guides off by default); MentionsModal, TaskParentGoalModal,
> SearchService (active-project default scope), TaskSearchService ported. Client search-only
> key generated (key id 1, `documents:search` on the 5 collections) and wired through
> `.env` / `replace-envs.sh` / `getTypesenseSearchKeys()`.
> **Phase 3 DEPLOYED (2026-08-12):** client + server reads live on Typesense in production;
> verified by grepping the deployed bundle for the cluster host. Gotcha for posterity: the
> GitLab variables `TYPESENSE_HOST` / `TYPESENSE_SEARCH_ONLY_API_KEY` were first created as
> "protected" in a project with **no protected branches**, so every pipeline saw empty
> strings and the key-aware flag silently kept Algolia reads — the working variables here
> are all unprotected; match that.
> **QA gate (run before Phase 4, two accounts A/B):**
>
> 1. B's private task/note never appears for A (isPublicFor).
> 2. A sees nothing from a project A is not a member of.
> 3. Workstream-scoped objects only for members of that workstream.
> 4. Anonymous/guide access only surfaces public records.
> 5. "Only objects I created" narrows on all 5 tabs.
> 6. Default all-projects search returns nothing from archived/template/guide projects;
>    each toggle widens correctly; per-user archived respected (archive for A only → hidden
>    for A, visible for B).
> 7. Mention autocomplete + parent-goal picker return sane results.
> 8. Old content (done tasks >30 days, old chats) IS now findable — the point of it all.

**Goal:** Replace Algolia with Typesense Cloud (Frankfurt), index _all_ content permanently (no more 30-day windows), and delete the "Activate full search for 500 Gold" mechanic plus every expiry/cleanup job that exists only to keep the Algolia record count down.

**Invariant:** "index everything" is about _temporal_ completeness only. Access control is
unchanged — a user can only ever search content they can normally access (their projects,
their privacy scope). See "Access control & search scope" below.

**Why:** Algolia bills ~~$0.40/1k records/month on peak monthly count — years of content for all users would cost hundreds to thousands of $/month. Typesense Cloud is flat-priced by cluster RAM (~~$20–50/month for our corpus), so per-record economics disappear.

---

## Current Algolia inventory (verified against code)

### Indices (5)

| Index          | Object types                  | searchableAttributes                             | typoTolerance | customRanking         |
| -------------- | ----------------------------- | ------------------------------------------------ | ------------- | --------------------- |
| `dev_tasks`    | tasks                         | humanReadableIdSearchable, humanReadableId, name | on            | desc(created)         |
| `dev_goals`    | goals                         | name                                             | off           | desc(created)         |
| `dev_notes`    | notes                         | title, content                                   | on (+plurals) | desc(lastEditionDate) |
| `dev_contacts` | contacts + users + assistants | displayName, cleanDescription, role, company     | off           | desc(lastEditionDate) |
| `dev_updates`  | chats/topics                  | cleanName, cleanLastComment, cleanComments       | off           | desc(lastEditionDate) |

`hitsPerPage: 100` (`AMOUNT_OF_SEARCH_BY_PROJECT`) everywhere.

### Client-side consumers (search-only key, filters built client-side)

1. `components/GlobalSearchAlgolia/GlobalSearchModal.js` — main search, 5 parallel index queries
2. `components/Feeds/CommentsTextInput/MentionsModal.js` — mention autocomplete
3. `components/UIComponents/FloatModals/TaskParentGoalModal/TaskParentGoalModal.js` — goal lookup

- Filter builder: `components/GlobalSearchAlgolia/searchFilters.js` (+ `searchFilters.test.js`)
- Keys: `getAlgoliaSearchOnlyKeys()` in `utils/backends/firestore.js:7080`, bridged via `utils/BackendBridge.js:876`

### Server-side (functions/)

- `searchHelper.js` — `getAlgoliaClient()` (admin key), `configAlgoliaIndex`, `getIndexName`,
  `uploadObjectsToAlgolia`, `removeProjectObjectsFromAlgolia`, bulk list builders
  (`addTasksToList`, `addGoalsToList`, `addNotesToList`, `addChatsToList`, `addContactsToList`,
  `addAssistantsToList`), `start*Indextion` entry points
- `AlgoliaGlobalSearchHelper.js` — incremental `createRecord` / `updateRecord` / `deleteRecord`
  (+ user record variants), `indexProjectsRecordsInAlgolia` (the 500-gold bulk path),
  `checkAndRemoveInactiveObjectsFromAlgolia`, `checkAndRemoveProjectsWithoutActivityFromAlgolia`
- Firestore triggers calling the above: `Tasks/`, `Notes/`, `Goals/`, `Chats/`, `Contacts/`,
  `Users/`, `Assistants/` `on{Create,Update,Delete}*Functions.js`, plus `Projects/on{Update,Delete}ProjectFunctions.js`
- `shared/SearchService.js` — assistant AI search (4 call sites in `Assistant/assistantHelper.js`)
- `shared/TaskSearchService.js` — task lookup with Firestore fallback
- `Algolia/creatorFacetReindex.js` — AT-2258 backfill (delete after migration)
- `index.js` exports: `indexProjectsRecordsInAlgoliaSecondGen`, `reindexAlgoliaCreatorFacetsSecondGen`,
  `backfillAlgoliaCreatorFacetsSecondGen`, `proccessAlgoliaRecordsWhenUnlockGoalSecondGen`,
  `checkAndRemoveInactiveObjectsFromAlgoliaSecondGen`, `checkAndRemoveProjectsWithoutActivityFromAlgoliaSecondGen`,
  7× `onStartIndexingAlgolia*SecondGen` (onDocumentCreated on `algoliaIndexation/{projectId}/objectTypes/*`)
- Env: `ALGOLIA_APP_ID` / `ALGOLIA_ADMIN_API_KEY` via `envFunctionsHelper.js`; client env exports
  `ALGOLIA_APP_ID` / `ALGOLIA_SEARCH_ONLY_API_KEY`
- `algoliasearch@4.10.5` in both `package.json` and `functions/package.json`

### Full-search / gold machinery (to be deleted at the end)

- `components/GlobalSearchAlgolia/Filter/ActiveFullSearch.js` (the checkbox)
- `activateFullSearch`, `fullSearchMap` watcher, `indexing` states in `GlobalSearchModal.js`
- `users.activeFullSearchDate`, `projects.activeFullSearch` fields (mapped in
  `utils/backends/firestore.js:3717`, `ContactsHelper.js`, `HelperScripts.js`)
- 14-day expiry inside `checkAndRemoveInactiveObjectsFromAlgolia`
- Translations: `"Activate full search for 14 days for 500 Gold"`, `"Active full search for x days"`
  in `i18n/translations/{en,es,de}.json`
- Admin sidebar item: `components/SidebarMenu/AlgoliaItemForIndexGlobalAssistantRecords.js`

---

## Access control & search scope

### Hard invariants (unchanged from today)

Every search query carries two conjuncts, built client-side and ported 1:1 to `filter_by`:

1. **Project membership:** `projectId` must be in the list of projects the user belongs to.
2. **Object privacy:** `isPublicFor` must contain one of the user's access ids
   (`FEED_PUBLIC_FOR_ALL`, own uid, `DEFAULT_WORKSTREAM_ID`, the user's workstream ids per
   project — `getProjectAccessIds` in `searchFilters.js`).

These are the entire access model; the privacy QA gate in Phase 3 verifies them on Typesense.

### Scope defaults (NEW — must be explicit, was implicit before)

Today, templates/guides/archived-for-everyone projects and stale content are absent from search
results **because their records don't exist in Algolia** (the `createRecord` gates + cleanup
jobs). The client already includes those project ids in its filters — index absence does the
hiding. Once Typesense indexes everything, that implicit hiding disappears, so scope becomes an
explicit client-side choice via the projectId list:

- **Default "All projects" scope: active projects only** (`ProjectHelper.getActiveProjects2`).
- **Templates and guides: excluded by default.** Reachable by explicitly selecting them in the
  project-picker tabs (`SelectProjectModalInSearch` already has Guide/Template tabs), and/or an
  opt-in "Include templates & guides" toggle.
- **Archived projects: excluded by default**, opt-in via an "Include archived projects" toggle
  (replaces today's implicit `areArchivedActive` behavior).
- **"Only objects I created"** stays as-is (`CreatedByMeOption` / `createdByMeOnly` →
  `userId`/`creatorId`/`recorderUserId` conjunct per index).

**Why client-side projectId lists, not record flags:** "archived" is a _per-user_
categorization (`loggedUser.realArchivedProjectIds`) — the same project can be archived for me
and active for a teammate. A record-level `isArchived` flag cannot express that; the per-user
project lists in Redux can. Template/guide status is global (`parentTemplateId`), but scoping it
the same way keeps one mechanism for everything.

Concretely in `GlobalSearchModal.js`: `updateTemporaryProjectsAndUsers` already builds the four
buckets (active / guides / templates / archived). Change the all-projects case of
`projectsToSearch` from "all buckets" to "active bucket + whatever toggles enable", and render
the toggle row where the gold checkbox used to be. Result grouping (`ResultLists`) keys off the
same list, so widening scope automatically renders the extra project groups.

---

## Phase 0 — Provision (no code changes)

1. Create Typesense Cloud cluster: **Frankfurt**, 1GB RAM / 2 vCPU, **non-HA** to start.
2. Generate two keys: admin key (functions only) and a **search-only key scoped to
   `documents:search` on the 5 collections** (client). Same trust model as today's
   Algolia search-only key.
3. Add env vars:
    - Functions: `TYPESENSE_HOST`, `TYPESENSE_ADMIN_API_KEY` (wire through `envFunctionsHelper.js`
      next to the Algolia entries)
    - Client: `TYPESENSE_HOST`, `TYPESENSE_SEARCH_ONLY_API_KEY` (next to the Algolia keys)
4. `npm i typesense` in both root and `functions/`.

## Phase 1 — Server-side dual-write

Create `functions/typesenseHelper.js`:

- Client factory (admin key).
- Collection schemas (5), mirroring today's records. Explicit fields for everything used in
  `filter_by`/`sort_by`, plus a `{"name": ".*", "type": "auto"}` catch-all so the many
  display-only fields from `map*Data` don't need enumeration:

| Collection | filter/facet fields                                                                                     | sort field      | query_by                                         |
| ---------- | ------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------ |
| `tasks`    | projectId, done(bool), isPrivate(bool), isPublicFor(string[]), userId, lockKey, lastEditionDate(int64)  | created(int64)  | humanReadableIdSearchable, humanReadableId, name |
| `goals`    | projectId, id, isPublicFor(string[]), ownerId, creatorId, lockKey, lastEditionDate, canBeInactive(bool) | created         | name                                             |
| `notes`    | projectId, isPrivate, isPublicFor(string[]), userId, lastEditionDate                                    | lastEditionDate | title, content                                   |
| `contacts` | projectId, isPrivate, isPublicFor(string[]), uid, recorderUserId, isAssistant(bool)                     | lastEditionDate | displayName, cleanDescription, role, company     |
| `updates`  | projectId, isPrivate, isPublicFor(string[]), creatorId, lastEditionDate                                 | lastEditionDate | cleanName, cleanLastComment, cleanComments       |

- `objectID` → Typesense `id` (same `objectId + projectId` composite).
- Set `token_separators: ["#", "-", "_"]` on tasks so `#123` / humanReadableId tokens match.
- `default_sorting_field` = the sort field above.

- `upsertDocument(collection, doc)`, `deleteDocument(collection, id)`,
  `importDocuments(collection, docs)` (batched `action: 'upsert'`, 500/batch),
  `deleteByFilter(collection, filterBy)`.

Wire dual-write into the four choke points (Algolia behavior stays **unchanged** so its record
count doesn't balloon during the transition):

- `addAlgoliaRecord(...)` → also `upsertDocument`
- `deleteAlgoliaRecord(...)` → also `deleteDocument`
- `uploadObjectsToAlgolia(...)` → also `importDocuments`
- `removeProjectObjectsFromAlgolia(...)` → also `deleteByFilter` **only for real deletions**
  (project deleted); NOT for the expiry cleanups — Typesense keeps everything.

Important: `createRecord`/`updateRecord` in `AlgoliaGlobalSearchHelper.js` early-return for
inactive projects / stale objects (`!project.activeFullSearch && (!project.active || parentTemplateId)`,
`objectIsInactive`). Refactor so those gates only guard the **Algolia** write; the Typesense
upsert always happens. From this moment Typesense receives 100% of new/edited content.

## Phase 2 — Backfill

**Implemented as `migration/backfillTypesense.js`** (local admin-SDK script following the
`backfillGoldStats.js` conventions — no cloud function, so no timeout ceiling):

- Iterates all projects paginated by document id, resumable via `typesenseBackfill/{projectId}`
  progress docs (completed projects are skipped on re-run; `--force` redoes them; partial
  failures record their object types and are retried by the next run).
- Per project, reuses the existing list builders **with the full-search path forced** and
  imports into Typesense only (`importTypesenseDocuments`, batched upserts) — Algolia's
  billable record count stays flat.
- Covers all 7 object types (users via the shared `buildProjectUsersSearchRecords`) plus
  `GLOBAL_PROJECT_ID` assistants; prints live per-collection counts at the end (`--stats` to
  check anytime).
- Dry-run by default; `--execute` refuses to run when `TYPESENSE_*` env is unset (the no-op
  write layer would otherwise mark everything complete while importing nothing).

```bash
TYPESENSE_HOST=xxx.a1.typesense.net \
TYPESENSE_ADMIN_API_KEY=... \
GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET=<from envs/env.master> \
GOOGLE_APPLICATION_CREDENTIALS=serv_account_key_master.json \
node migration/backfillTypesense.js --firebase-project-id=alldonealeph --execute --concurrency=3
```

Watch cluster RAM in the Typesense dashboard during backfill; upgrade config in place if needed
(RAM ≈ 2–3× raw JSON size). Note the dry run performs the same Firestore/Storage reads as a
real run (it builds the full record lists to count them).

## Phase 3 — Client + server read cutover (behind a flag)

1. `utils/typesense.js` — search client factory (search-only key). Add
   `getTypesenseSearchKeys()` beside `getAlgoliaSearchOnlyKeys()` in `utils/backends/firestore.js`
    - `BackendBridge.js`.
2. Port `searchFilters.js` → `buildTypesenseFilters` (keep the old file until decommission;
   port `searchFilters.test.js`):

    | Algolia                                | Typesense `filter_by`                                |
    | -------------------------------------- | ---------------------------------------------------- |
    | `(projectId:"a" OR projectId:"b")`     | `projectId:=[a,b]`                                   |
    | `(isPublicFor:"x" OR isPublicFor:1 …)` | `isPublicFor:=[x,1,…]` (array field: "contains any") |
    | `userId:"abc"`                         | `userId:=abc`                                        |
    | `isAssistant:false`                    | `isAssistant:=false`                                 |
    | `A AND B`                              | `A && B`                                             |

    Wrap values containing special chars in backticks (Typesense's quoting), covering
    `ws@default`-style workstream ids. Preserve the "empty filter means skip the search, never
    search unscoped" contract.

3. `GlobalSearchModal.onSearchInAlgolia` → Typesense. Use **one `multi_search` call** for all
   5 collections instead of 5 HTTP requests. Per-collection params:
   `q`, `query_by` (table above), `filter_by`, `per_page: 100`,
   `num_typos: 2` for tasks/notes, `0` for goals/contacts/updates,
   `sort_by: _text_match:desc,<sortField>:desc`.
   Write a tiny hit adapter (`hit.document` → old hit shape incl. `objectID`) so `ResultLists`
   and everything downstream stays untouched.
4. Same swap in `MentionsModal.js` and `TaskParentGoalModal.js`.
5. **Scope defaults & toggles** (see "Access control & search scope"): all-projects searches
   default to the active-projects bucket; add "Include archived projects" and "Include
   templates & guides" toggles (default off) next to `CreatedByMeOption`. Ship this in the same
   release as the read cutover — otherwise archived/template content would appear in default
   results the moment reads hit Typesense.
6. Server-side readers: `shared/SearchService.js` (`buildAlgoliaFilters` → filter port) and
   `shared/TaskSearchService.js` (keep its Firestore fallback). These must scope to active
   projects by default too (assistant search should not surface archived/template content
   unless the request asks for it).
7. Put reads behind a single constant/env flag (`SEARCH_ENGINE = 'typesense' | 'algolia'`) so
   rollback is a one-line flip while dual-write keeps both stores current.

**QA gate before Phase 4 (privacy-critical):** verify with two test accounts that private
objects, `isPublicFor` scoping, workstream scoping, anonymous access (`FEED_PUBLIC_FOR_ALL`),
and "Only objects I created" behave identically on Typesense. The access model lives entirely
in these filters. Additionally verify the scope defaults: a default all-projects search must
return nothing from archived/template/guide projects (even though their records now exist in
the index), a user must never see results from a project they're not a member of, and the
archived toggle must respect _per-user_ archived status.

## Phase 4 — Product changes (the actual payoff)

1. Delete `ActiveFullSearch.js`; remove from `GlobalSearchModal.js`: `activateFullSearch`,
   `indexing` state, `fullSearchMap` + `watchUserProjects` wiring,
   `indexingFullSearchInAllProjects`, the gold popover import. `showGuideTab` → `true`
   (the Guide tab in the project picker is explicit opt-in, so it no longer needs the
   full-search gate — default results still exclude guides per the scope rules).
2. Remove the two translation strings from `en.json`, `es.json`, `de.json`.
3. Indexing policy becomes "index everything, always" (**indexing ≠ visibility** — what users
   see is governed by the scope defaults from Phase 3):
    - Remove the 30-day windows in `addTasksToList` / `addChatsToList` / `addGoalsToList`
      (the `activeFullSearch` param disappears — always take the full path).
    - Remove the eligibility gates in `createRecord`/`updateRecord` so template/guide/dormant
      project content is _indexed_ — it only ever _appears_ when the user explicitly widens
      scope (picker tabs or toggles).
4. Delete jobs & triggers that only existed for record-count control:
    - `checkAndRemoveInactiveObjectsFromAlgoliaSecondGen` (14-day expiry + old-record deletion)
    - `indexProjectsRecordsInAlgoliaSecondGen` + the 7 `onStartIndexingAlgolia*SecondGen`
      triggers + the `algoliaIndexation/*` doc flow (superseded by the Phase 2 backfill callable,
      which stays as the manual reindex tool)
    - `checkAndRemoveProjectsWithoutActivityFromAlgoliaSecondGen`: **keep** the
      `projects.active = false` write (other app behavior may read the flag) but drop the
      search-record deletion. Rename accordingly.
5. Remove `users.activeFullSearchDate` / `projects.activeFullSearch` reads:
   `utils/backends/firestore.js:3717`, `ContactsHelper.js`, `HelperScripts.js`,
   `components/GlobalSearchAlgolia/searchHelper.js` (client), Redux `loggedUser` mapping.
   (Leave stale Firestore fields in place; they're inert.)

## Phase 5 — Decommission Algolia

After 2–4 weeks of stable Typesense reads:

1. Remove the Algolia side of the dual-writes; delete `getAlgoliaClient`, `configAlgoliaIndex`,
   `uploadObjectsToAlgolia`, `removeProjectObjectsFromAlgolia`, `Algolia/creatorFacetReindex.js`
   (+ its `index.js` exports and schedule), `AlgoliaItemForIndexGlobalAssistantRecords.js`.
2. `npm uninstall algoliasearch` (both packages). Remove `ALGOLIA_*` env vars.
3. Rename `components/GlobalSearchAlgolia/` → `components/GlobalSearch/` (mechanical, optional).
4. Downgrade/cancel the Algolia plan.

**Rollback:** any time before Phase 5, flip the read flag back to Algolia — dual-write kept it
current. After Phase 5, rollback = re-run the backfill in reverse (don't; just don't rush Phase 5).

---

## Gotchas / decisions

- **Privacy relies on filters** (today too — the Algolia search key doesn't enforce access).
  The Typesense search-only key matches that posture. Optional later hardening: server-generated
  **scoped search keys** with embedded `filter_by` per user; Typesense supports this natively.
- **`isPublicFor` mixes types** (numeric `FEED_PUBLIC_FOR_ALL` + string ids). Normalize to
  `string[]` in the Typesense mapper and stringify the constant in the filter builder.
- **Typo tolerance is per-query** in Typesense (`num_typos`), not per-collection config —
  set it in each search call. `ignorePlurals` has no direct equivalent; acceptable loss for notes.
- **Chats comment digest** (`cleanComments`, capped length) carries over unchanged — record
  shape is identical, only the store changes.
- **`proccessAlgoliaRecordsWhenUnlockGoalSecondGen`** (goal-unlock reindex) goes through
  `createRecord`, so dual-write covers it automatically; after Phase 5 it becomes Typesense-only.
- **Cost check after backfill:** if the corpus pushes past ~2–3GB RAM, bump the cluster config —
  still flat, still cheap. Enable HA later via toggle if search uptime ever matters (≈3× cost).
- Emulator/dev: Typesense runs locally via a single Docker container for development
  (`typesense/typesense`), pointed to by `TYPESENSE_HOST`.

## Effort estimate

| Phase             | Size                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| 0 Provision       | ~1h                                                                    |
| 1 Dual-write      | 1–2 days (schemas + 4 choke points + gate refactor)                    |
| 2 Backfill        | ~1 day (callable + progress doc + verification)                        |
| 3 Read cutover    | 2–3 days (filter port + 3 client modals + 2 server services + QA gate) |
| 4 Product changes | ~1 day (deletions, mostly)                                             |
| 5 Decommission    | ~0.5 day                                                               |
