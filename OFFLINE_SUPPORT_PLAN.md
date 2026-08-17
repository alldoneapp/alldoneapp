# Offline Support Plan

Goal: the web app (including the installed iOS/Android PWA) keeps working while offline —
read your tasks/goals/notes, create and edit them, read chat history — and everything
syncs automatically when connectivity returns. Scope is **web only**: the RN-native
toolchain is retired, the shipped product is the web-bundler PWA.

## Where we are today (audit, 2026-08-17)

The app currently has **no** offline support, and several mechanisms actively prevent it:

| Area                | Current state                                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell           | `web/service-worker.js` (v1.9) is network-first and **deletes every cache on activate**; nothing is ever precached. Offline reload = blank page. No workbox anywhere.                                                                                                               |
| Firestore           | No persistence of any kind. Only settings call is `ignoreUndefinedProperties` (`utils/backends/firestore.js:483`). Everything is in-memory; lost on reload.                                                                                                                         |
| Cached snapshots    | List watchers **suppress** `fromCache` snapshots (`openTasks.js:349,1155,1295`, `doneTasks.js:38,181,251`, `workflowTasks.js:194`, `firestore.js:5056`, `firestore.js:2406`). Offline, `fromCache` is always true → lists would render empty even with persistence on.              |
| Connectivity signal | None. No `navigator.onLine`, no online/offline listeners. `@react-native-community/netinfo` is a dead dependency (never imported).                                                                                                                                                  |
| Offline UI          | Already built and shipped but **dead**: `ConnectionStateModal.js` + read-only gating in `NoteEditorContainer.js` + en/de/es strings. `setConnectionState` is only ever called with `''`.                                                                                            |
| Boot path           | Offline boot fails: `loadGlobalDataAndGetUserResult` throws, `handleLoginFailure` (`AppContent.js:183-216`) retries 3× then shows a blocking `confirm()` "reload" dialog. `bootIntegrityHealer` burns its two `disableNetwork/enableNetwork` cycles on phantom anomalies.           |
| Auth                | Already fine: `Persistence.LOCAL` (`firestore.js:783,816`) — the session survives offline restarts.                                                                                                                                                                                 |
| Writes              | Core CRUD (tasks, goals, notes metadata, chat comments) is **direct Firestore writes** — ideal for offline queuing. Callables are integrations/orchestration only, with one core-flow exception: goal postpone-with-undo (`goalsFirestore.js:1222`) and undo (`undoActions.js:96`). |
| Notes               | Yjs over `y-websocket` only; **no `y-indexeddb`**. Note content lives in Firebase **Storage** (`setNoteData` → `notesData/{objectId}/{noteId}`), so offline the load rejects and `NotesEditorView.js:788` destroys the provider and locks the editor forever.                       |
| Search              | Typesense via plain `fetch` — search-UX only (global search, @-mentions, parent-goal picker). Core flows don't need it.                                                                                                                                                             |
| Warm-start cache    | `utils/UserDataCache.js` already caches user+global data in localStorage (24h) — but is only used for fast boot, not consulted when the network read _fails_.                                                                                                                       |

The stages below are ordered so each ships independently and the earlier ones are
prerequisites for the later ones.

---

## Stage 1 — Connectivity signal + surface the existing offline UI (small, zero risk) — **SHIPPED 2026-08-17**

The cheapest visible win, and every later stage needs the signal.

- New `utils/connectionState.js`: one module that owns online/offline state from
  `navigator.onLine` + `window` `online`/`offline` events, debounced, pushed into a new
  redux slice (`connectionState: 'online' | 'offline'`). Install from `AppNavigator`'s
  `AppContainer` (the component that already owns app-wide document listeners, per the
  escape-stack precedent). Browser online events are optimistic (captive portals), so
  later stages treat "offline" as authoritative and "online" as a hint.
- Feed the already-built `ConnectionStateModal` toast from that slice instead of the dead
  local state in `NoteEditorContainer.js` (which today only ever sets `''`).
- Remove the unused `@react-native-community/netinfo` dependency (dead since forever;
  keeping it invites someone to "fix" connectivity with a package that needs the retired
  native toolchain).
- Tests: jest for the redux slice + listener install/teardown.

## Stage 2 — Precache the app shell (service worker) — **SHIPPED 2026-08-17**

Without this, nothing else matters: `DailyAppReload` reloads the page at the first
day-rollover, and offline that's a blank page.

- Add workbox `InjectManifest` to `web-bundler/webpack.config.js` (the natural insertion
  point — output is already content-hashed `static/js/[name].[contenthash].js` with
  `splitChunks` + `runtimeChunk`, so the precache manifest is stable and immutable).
- Rewrite `web/service-worker.js` as the workbox source SW:
    - **Stop deleting all caches on activate** (lines 14-32 today) — replace with
      workbox's own precache cleanup, which only removes _outdated_ precache entries.
    - Precache: hashed JS/CSS chunks, `index.html` (as navigation fallback), fonts,
      manifest icons.
    - Runtime caching: cache-first for `/static/**` (already `immutable` per
      `firebase.json`), network-first-with-cache-fallback for `index.html` navigations.
    - Keep the existing exclusion list (Firestore/googleapis/`.mp4`/MCP OAuth paths) as
      workbox `denylist` routes — the SDKs must own their own transports.
- Keep `firebase-messaging-sw.js` untouched and separate (its config is sed-injected by
  `ci/replace-envs.sh`; merging it into the app SW would tangle the env pipeline).
- Coordinate the three cache-clearing paths so they don't fight the precache:
    - `utils/Observers.js` `deleteCache()`/`deleteCacheAndRefresh()` (version banner, error
      boundary, "start a new day") — must clear _runtime_ caches but leave the precache to
      the SW update flow, or explicitly trigger SW update instead of raw cache deletion.
    - `DailyAppReload` — safe once the shell is precached, but gate it on
      `connectionState === 'online'` anyway; reloading offline gains nothing.
    - `clearAllFirebaseIndexedDB()` (`firestore.js:403-448`) — verify it stays
      emulator-gated; it deletes exactly the DBs Stage 3 depends on.
- Env injection check: the current app SW is copied verbatim from `web/` by CopyPlugin;
  workbox build output must land in `web-build/` the same way so the deploy contract
  (`build_web_production` → hosting) is unchanged. Update
  `__tests__/WebShellScrollContainers.test.js`-style template guards if the index.html
  changes.
- Verification: `browser-tests/` scenario — load app, go offline (devtools/network
  interception), reload, assert the shell boots.

## Stage 3 — Firestore offline persistence — **SHIPPED 2026-08-17**

_Implementation notes: `utils/backends/firestorePersistence.js` (not awaited — the compat
SDK queues later calls behind the enable), 100 MB `cacheSizeBytes`, persistence skipped
under the emulator (its IndexedDB is wiped every boot anyway). The
`firestoreDirectRead` verification paths needed no gating: both callers already treat a
failed direct read as "failed read, retry" rather than absence, which is exactly the
right offline behavior._

- Enable IndexedDB persistence at the single init site (`firestore.js:477-487`):
  compat `db.enablePersistence({ synchronizeTabs: true })` **before any other Firestore
  call** (compat requires it first; the settings call at :483 must move after or be
  merged). Multi-tab sync matters — users keep several Alldone tabs open.
    - Handle the two documented failure modes gracefully: `failed-precondition`
      (another tab already owns it without synchronizeTabs — shouldn't happen with
      synchronizeTabs, but log to Sentry) and `unimplemented` (old browser) → continue
      without persistence, app behaves exactly as today.
- Set `cacheSizeBytes` explicitly (e.g. 100 MB, `CACHE_SIZE_UNLIMITED` is tempting but
  the feeds/chat collections are large); rely on LRU GC.
- Review the known interactions flagged in the audit:
    - `restartFirestoreNetwork()` / `bootIntegrityHealer` — `disableNetwork()` cycling now
      interacts with a persistent pending-write queue. Gate the healer's network-cycle path
      on `connectionState === 'online'` (offline, its "anomalies" are just the cache).
    - `watchForceReload` (`firestore.js:1423`) — a cached `{reload: true}` doc must not
      reload-loop offline: only honor it on a snapshot with `fromCache === false`.
    - `firestoreDirectRead.js` (REST authoritative reads) — online-only by design; gate
      callers on connectionState so they don't spin offline.
- Security note for the plan record: persistence stores user data unencrypted in
  IndexedDB on the device. Same trust level as the existing `UserDataCache` localStorage
  cache and Firebase Auth's own IndexedDB session — no new class of exposure, but worth a
  line in the privacy docs.

## Stage 4 — Let cached data render (the `fromCache` inversion) — **SHIPPED 2026-08-17**

_Implementation notes: `utils/backends/cachedSnapshotGate.js` — each watcher keeps its
buffer-and-merge structure; `gate.shouldBuffer(snapshot)` replaces the raw `fromCache`
test. Cached snapshots deliver immediately when offline, or after a 4s only-cache grace
(the captive-portal / edge-triggered-snapshot tell); the grace flush re-invokes the
watcher's own handler with a synthetic empty-`docChanges()` snapshot so the buffered
changes flow through the existing merge path. `wrapUnsubscribe` ties pending flush
timers to the subscription. Two audited sites needed no change: `watchUserData` and
`objectLinkSnapshot` already deliver cached data and only suppress cache-misses._

The biggest correctness change. Today's pattern in list watchers is "buffer cached
changes, only emit when a server snapshot arrives" — correct online (prevents flashing
partial data), fatal offline (nothing ever renders).

- Change the guards in `openTasks.js`, `doneTasks.js`, `workflowTasks.js`,
  `firestore.js:5056` (notes), `firestore.js:2406` (user doc) to:
    - online: current behavior (wait for server snapshot);
    - offline (`connectionState === 'offline'` **or** a grace timeout with only cached
      snapshots arriving): emit the cached snapshot, marked so the UI can badge it.
      The grace-timeout branch matters because `navigator.onLine` lies on captive portals —
      "I've only seen cache for N seconds" is the reliable offline tell.
- Audit `isTransientMissingDocSnapshot` / `missingFromCache` helpers
  (`projectsInitialDataHelper.js:111`, `firestore.js:1282-1301`) — offline, a doc missing
  from cache is _unknown_, not deleted; deletion-reacting code paths must not fire on
  cache-only snapshots.
- UI: subtle "showing offline data" indicator (reuse the ConnectionStateModal slice), no
  per-row noise.

## Stage 5 — Offline-tolerant boot — **SHIPPED 2026-08-17**

_Implementation notes: much of this stage was already covered once Stage 3 landed —
offline, `.get()` reads resolve from the Firestore cache, so the normal login path
mostly succeeds without special-casing. What shipped: `loadGlobalData` failures no
longer fail the login (no-cache path contained them via `Promise.all`),
`UserDataCache.isCacheValid` skips the 24h age check while offline (version check
stays), `loadProjectsDataFromFirebase` stops retrying while offline, and
`handleLoginFailure`'s terminal branch swaps the useless offline `confirm()` reload
dialog for an automatic retry on the `online` event. `getRedirectResult` needed
nothing — it already had a `.catch` and its awaiter swallows rejections. New
synchronous helper: `isBrowserOffline()` in `utils/connectionState.js` for early-boot
code that runs before the debounced redux slice settles._

- `AppContent.js` login flow: when the initial reads fail **and** we're offline, fall
  back to `UserDataCache.getCachedGlobalData()`/cached user data (extend its expiry
  tolerance when offline — stale beats blank) and proceed to mount the app; Firestore
  persistence (Stage 3) then serves project data from cache. Keep the `confirm()` reload
  dialog only for the online-failure case.
- `getRedirectResult()` await (`firestore.js:539-559`): add a short timeout when offline
  so sign-in state resolution can't block boot (the persisted session is already local).
- Retry loops (`MAX_LOGIN_ATTEMPTS`, `loadProjectsDataFromFirebase` 5×5s): skip straight
  to the cache path when offline instead of burning 15-25s of retries.
- Verification: browser test — boot the app with network blocked from the start,
  assert task list renders from cache.

## Stage 6 — Notes offline (Yjs) — **SHIPPED 2026-08-17**

_Implementation notes: `y-indexeddb@9.0.12` (root dep + jest transform allowlist entry),
attached only to the LIVE editor via `noteLocalPersistence.js` — the headless/virtual
Quill path in `notesHelper.js` serves online-only operations and deliberately stays
WS-only. `prepareSyncedNoteDocument` now takes `{ createLocalPersistence, syncTimeout }`,
tolerates a null `storageData` (failed download), opens offline when the WS sync times
out but content exists, and computes `storageNeedsLocalCatchUp` by applying local state
onto a throwaway storage doc and comparing encodings (catches deletions; a bare
state-vector diff would over-report on every open and fire spurious edit side effects).
Catch-up uploads happen on next online open and on the `online` event while the editor
is open; `setNoteData`'s Storage put failure is caught (content is locally durable).
Offline read-only gating removed; toast copy updated in en/de/es (same key). Known
limit: the destructive-collaboration-sync recovery still only guards the load moment,
not a late reconnect sync — unchanged from before._

Notes are the special case: content lives in Firebase Storage, not Firestore, so Stage 3
does nothing for them.

- Add `y-indexeddb`: attach an `IndexeddbPersistence` provider alongside the
  `WebsocketProvider` at both construction sites (`NotesEditorView.js:737` and the
  headless path in `notesHelper.js:24` — consider extracting a shared
  `createNoteProviders()` so they can't drift). Yjs CRDTs make the merge-on-reconnect
  automatic and conflict-free — this is the whole reason the notes stack is the _easiest_
  feature to make offline-durable.
- Fix the load path: when `getNoteData` (Storage fetch) fails at `NotesEditorView.js:788`
  but y-indexeddb has local state for the room, open the editor from local state instead
  of destroy-and-retry-forever. Only lock the editor when there is neither network nor
  local state.
- Fix the save path: `setNoteData` (Storage `.put`) failure offline currently means the
  canonical copy is stale until the next successful save. With y-indexeddb the local copy
  is durable, so: mark the note dirty (redux), retry the Storage upload on
  reconnect (`connectionState` → online) and on next editor open.
- Wire the editor's existing `synced`/`peersSynced` state + connectionState into the
  already-built read-only gating in `NoteEditorContainer.js` — decision: offline notes
  editing stays **enabled** (y-indexeddb makes it safe); read-only mode is only for
  "no local state and no network".

## Stage 7 — Degrade the online-only surfaces honestly

Everything that cannot work offline should say so immediately instead of hanging or
silently failing:

- **Callables**: wrap `runHttpsCallableFunction` (`firestore.js:7824`) with an offline
  fast-fail (typed error) + a small allowlist of "queueable" ones if any prove necessary.
  Known core-flow victims: goal postpone-with-undo, undo (`reverseUndoActionSecondGen`),
  meeting transcription, Gold/Stripe modal. UI: disable or toast "needs connection".
- **Assistant/AI, VM tasks, Gold**: online-only by nature — the assistant input and VM
  task triggers should show the offline state rather than spinning.
- **Search & mentions**: `GlobalSearchModal` + `MentionsModal` get an offline empty-state
  message; optionally a cached recent-mentions list (project members are already in
  redux, so mentions can degrade to local member filtering rather than nothing).
- **Attachments/uploads**: comment image/video uploads go to Storage — fast-fail with a
  clear message (a full upload outbox is out of scope for v1).
- **New-feature guardrail**: a short section in CLAUDE.md — new features must either work
  from Firestore cache or gate on `connectionState`.

## Stage 8 — Verification & regression pinning

- `browser-tests/offline` suite (real Chromium, like `at2257`/`modalsheet`): boot online
  → go offline → create/edit/complete a task → reload → assert persistence → go online →
  assert the write reaches the server (emulator).
- Jest guards: connectionState slice; the `fromCache` emission policy per watcher; SW
  template guard (precache manifest present, no cache-nuke on activate); a
  `ModalSystemGuardrails`-style ratchet asserting no new un-gated
  `runHttpsCallableFunction` call sites in core flows.
- Manual QA checklist: iOS standalone PWA (the AT-2314 safe-area work means real devices
  matter), multi-tab, airplane-mode mid-edit, captive portal.

---

## Explicit non-goals (v1)

- **Conflict resolution UI** — Firestore's last-writer-wins field merging is accepted for
  tasks/goals/chat; Yjs handles notes. No three-way merge UI.
- **Offline upload outbox for attachments** — fast-fail instead.
- **Offline search index** — degrade, don't replicate Typesense locally.
- **Server-triggered behavior while offline** (workflow AI steps, reminders, Gmail):
  these run server-side against synced data; a task created offline simply triggers them
  on sync. That delay is inherent and fine.

## Risks / open questions

1. **Cache-only cold start breadth**: Firestore persistence only serves queries it has
   seen. First offline session covers whatever the user browsed while online. Acceptable
   for v1; a deliberate "warm the cache" pass (prefetch active project tasks on idle) is
   a possible v2.
2. **Multi-tab + `synchronizeTabs`** is the most bug-prone corner of Firestore
   persistence — needs real multi-tab browser testing, especially with
   `restartFirestoreNetwork` cycling.
3. **Redux memory model**: the app assumes watchers deliver fresh data into redux; with
   cached emission some derived state (badges, counts via functions) will be stale-but-
   consistent. Audit anything that treats snapshot arrival as "server confirmed".
4. **`clearAllFirebaseIndexedDB` / `deleteCacheAndRefresh`**: every cache-clearing path
   must be re-checked once caches are load-bearing.
