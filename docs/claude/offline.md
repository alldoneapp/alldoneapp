# Offline support

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Offline support (OFFLINE_SUPPORT_PLAN.md — all 8 stages shipped 2026-08-17)

- **Connectivity signal**: the `connectionState` redux slice (`'' | 'offline' | 'online'`,
  `''` = never changed, `'online'` only ever set as a recovery from `'offline'`) is fed by
  `utils/connectionState.js`, installed once from `AppNavigator`'s `AppContainer` like the
  escape stack. For early-boot code that runs before the debounced slice settles, use the
  synchronous `isBrowserOffline()` from the same module (UserDataCache expiry tolerance,
  login retry short-circuits, the offline branch of `handleLoginFailure` all do).
  Gate online-only features on `state.connectionState === 'offline'`; treat
  `'offline'` as authoritative and `'online'` as a hint (captive portals lie). The
  `ConnectionStateModal` toast + notes read-only gating consume it in
  `NoteEditorContainer.js`. `@react-native-community/netinfo` was removed — it was never
  imported and needs the retired native toolchain; use this module instead.
- **Online-only surfaces fail fast, never hang**: `runHttpsCallableFunction` and
  `multiSearchTypesense` both throw a typed `code: 'offline'` error immediately while
  offline (a callable otherwise hangs into its 70s SDK timeout). New features must
  either work from the Firestore cache or gate on `connectionState`/`isBrowserOffline`
  and fail fast with that same error shape. Mentions degrade to redux project members
  (`MentionsModal.getLocalContactsFallback`); `getMentions` must never throw —
  `updateResults` has no catch and a rejection leaves the mentions spinner hanging.
- **Notes offline (y-indexeddb)**: the LIVE notes editor attaches an
  `IndexeddbPersistence` (`noteLocalPersistence.js`) alongside the `WebsocketProvider`;
  the headless/virtual Quill path in `notesHelper.js` deliberately does not (online-only
  operations, cleanup hazards). `prepareSyncedNoteDocument` opens from local state when
  Storage and/or the collab server are unreachable, and flags
  `storageNeedsLocalCatchUp` so offline edits get uploaded to Firebase Storage on the
  next online open (detection compares merged encodings, NOT bare state vectors — a
  state-vector diff over-reports on every open because it can't see delete-set equality,
  and a false positive fires edit side effects like `startEditNoteFeedsChain`). Offline
  no longer forces the notes editor read-only. Pinned by
  `noteCollaborationRecovery.test.js` and `noteLocalPersistence.test.js`.
  **Follow-ups (2026-08-17)**: (1) a note can be **created** offline end to end —
  `uploadNewNote` stops awaiting server acks while offline (the awaited `.set()`, the
  server-clock read in `updateEditionData`, and the side-effect `Promise.all` only
  resolve on reconnect otherwise) and its empty Storage put is best-effort; the editor
  then opens via `allowEmptyOpen`, passed when the note has no `preview` (previews are
  written on every content autosave, so no preview ⇒ never-saved ⇒ empty is correct —
  and CRDT merge makes even a false positive lossless). (2) `utils/NotesOfflinePrefetch.js`
  warms the y-indexeddb stores with the most recently edited notes while online (top 5
  per project, 30 per run, cooldown 10 min, marker-skips unchanged editions, never
  touches the open note, scheduled post-login + on reconnect from `AppContent`). (3) a
  note that still cannot load offline shows a translated explanation instead of an
  endless spinner (`contentUnavailableOffline` in `NotesEditorView`). **The Firebase
  Storage SDK retries failed network requests internally for up to 2 minutes per
  operation (10 for uploads)** — offline, any unguarded notes-storage call stalls the
  UI long before app-level offline handling can run. The notes storage client is
  bounded (`setMaxOperationRetryTime(15000)` / `setMaxUploadRetryTime(60000)` at init),
  the editor skips the download outright while `isBrowserOffline()`, and
  `loadNoteContentWithRetry` bounds each attempt (`attemptTimeoutMs`). When testing
  offline behavior, drive the REAL SDK offline — injecting a failed download result
  fails fast and masks exactly this class of stall.
- **Offline is quiet, not an error**: `initFirebase` sets
  `firebase.firestore.setLogLevel('error')` (the SDK's WARN chatter — the
  enablePersistence deprecation notice, per-reconnect `transport errored`, BloomFilter —
  is steady-state noise for an offline-capable app), and
  `utils/backends/firestoreNetworkGate.js` parks the SDK transport via
  `disableNetwork()` while `connectionState === 'offline'`, resuming on the recovery
  transition. That removes the browser-level `ERR_INTERNET_DISCONNECTED` spam AND the
  battery cost of doomed reconnect attempts in airplane mode; cache reads and queued
  writes are unaffected (`disableNetwork` only parks the transport). The gate is keyed
  on the debounced slice, so it cannot flap, and the boot-integrity healer already
  stands down offline so their disable/enable cycles cannot interleave.
- **Firestore persistence**: `initFirebase` enables IndexedDB persistence
  (`enableFirestorePersistence` in `utils/backends/firestorePersistence.js` —
  multi-tab `synchronizeTabs`, 100 MB LRU cache, deliberately **not awaited**: the compat
  SDK queues later calls behind the enable; every failure degrades to the in-memory
  cache). Emulator sessions use an in-memory Firestore cache and retain their separate Auth session. Consequences to
  respect: `watchForceReload` only honors a **server** snapshot (a cached `{reload: true}`
  would reload-loop offline — the guard is `doc.metadata.fromCache`), and
  `bootIntegrityHealer` stands down while `connectionState === 'offline'` (cached-only
  data is not an anomaly, and the bounded `disableNetwork`/`enableNetwork` cycles must
  not be burned offline). A doc "missing" in a cache-only snapshot is **unknown, not
  deleted** — the `firestoreDirectRead` verification paths already treat a failed direct
  read as retryable, keep it that way.
- **One tab holds the connection for all tabs, and it must not be a hidden one (AT-2907)**.
  With the multi-tab cache only the primary tab talks to Firestore; every other Alldone tab
  gets its listeners served through IndexedDB. The SDK prefers a visible tab when the lease
  is free but never takes a valid lease from a hidden one, so a tab left in the background
  kept serving the tab the user was looking at while Chrome throttled it. Measured on
  2026-10-29 with four tabs (~900 listeners): the visible tab had no server snapshot for its
  tasks after 109s and hit `page_timeout`; with `?perfDisablePersistence=1` the same page had
  it after 2.3s. `utils/backends/firestoreTabHandoff.js` (installed only when persistence is
  on) makes a tab hidden for 30s call `disableNetwork()` while another Alldone tab is visible,
  which makes the SDK give up the lease at once, and `enableNetwork()` again when it becomes
  visible or no visible tab is left. Tabs learn about each other over a BroadcastChannel, not
  from the SDK's IndexedDB bookkeeping; without a visible peer a hidden tab keeps its network,
  because a lone hidden tab with the network off would also stop sending its own writes.
  Every other owner of the network (the offline gate, connection health restarts, the boot
  integrity healer, `restartFirestoreNetwork`) checks `isFirestoreNetworkReleasedToVisibleTab()`
  (`firestoreNetworkRelease.js`, deliberately import-free) before `enableNetwork()`, and the
  handoff never releases or re-enables while the network is parked for offline or "Continue
  offline". To see which tab holds the lease: IndexedDB `firestore/[DEFAULT]/alldonealeph/main`,
  stores `owner` and `clientMetadata` (`inForeground`, `networkEnabled`). The handoff logs
  `firestore_tab_handoff` released/reacquired records, but only with localStorage
  `alldone.performance.debug=1`: `?perfDebug=1` is re-read from the URL on every record and the
  app drops the query after boot, so it covers boot records only. Pinned by
  `firestoreTabHandoff.test.js` and the AT-2907 cases in `firestoreNetworkGate.test.js`,
  `connectionHealth.test.js` and `ConnectionStateGuardrails.test.js`. Verified live with real
  Chrome tabs on 2026-10-29.
- **VM badges watch only tasks marked `hasVmSession` (AT-2907).** The task list's VM badge and
  the VM filter counts used to open a `vmSessions/{projectId}__{taskId}` listener for every open
  task and subtask, about 100 per tab, while production held 39 session documents. The server
  now sets `hasVmSession: true` on the task when its thread first admits a VM job
  (`functions/Assistant/vmTaskSessionMarker.js`, called from `startVmJob`; no edition data, never
  cleared), and `collectTaskVmSessionRefs` / `TaskVmStatusTag` skip unmarked tasks. Sessions from
  before the marker need `node migration/backfillTaskVmSessionMarker.js
--firebase-project-id=<project> --execute` once, or their badges stay hidden.
- **Cached-snapshot delivery (`utils/backends/cachedSnapshotGate.js`)**: the list
  watchers (open/done/workflow tasks, the notes watchers via
  `createNotesSnapshotHandler`) buffer `fromCache` snapshots online but must render them
  offline — offline every snapshot is `fromCache` forever. Never test
  `querySnapshot.metadata.fromCache` directly in a list watcher; use
  `createCachedSnapshotGate` (`shouldBuffer` + `wrapUnsubscribe`). The gate delivers
  cached data when `connectionState === 'offline'` **or** after a 4s only-cache grace
  period — the grace exists because Firestore snapshots are edge-triggered and
  `navigator.onLine` lies on captive portals; a level-check alone would leave lists
  permanently blank when the offline transition lands after the initial cache snapshot.
  Its flush re-invokes the watcher's handler with a synthetic snapshot whose
  `docChanges()` is empty (buffered changes must not double-count) — pinned by
  `cachedSnapshotGate.test.js`.
- **Service worker**: production builds emit a **workbox** SW via `InjectManifest` in
  `web-bundler/webpack.config.js` (source: `web-bundler/service-worker.js`; workbox deps
  live in web-bundler's own package). It precaches the app shell (hashed chunks,
  index.html, fonts) so an offline reload boots; navigations stay network-first;
  cross-origin SDK traffic is untouched (workbox only intercepts registered routes). Dev
  builds copy the no-op `service-worker.dev.js` to the same URL. The legacy
  `web/service-worker.js` (which deleted **every** cache on activate — do not resurrect
  it) is gone; `firebase-messaging-sw.js` stays separate and un-precached (sed-injected
  env placeholders). `utils/Observers.js` `deleteCache()` must never delete
  `workbox-precache*` caches — it clears runtime caches and triggers
  `registration.update()` instead. `__tests__/ServiceWorkerPrecache.test.js` pins all of
  this; `__tests__/utils/DailyAppReload.test.js` pins that the daily reload defers while
  offline and catches up on the `online` event.

**Logout takes the account's local copies and push token with it (security audit NV-41/NV-42).**
`logoutWeb` releases this browser's FCM token before `signOut()` (`arrayRemove` from
`users/{uid}.fcmToken`, then `messaging.deleteToken()`; never prompts for permission), and after it
terminates Firestore and calls `clearPersistence()`, deletes the `alldone-note-*` y-indexeddb
databases and `alldone-artifacts-cache`, and calls `UserDataCache.clearCache()`
(`utils/backends/logoutCleanup.js`). Every step is best effort with a 3s cap, because logout must
work offline (the token write is then lost with the cache, and `deleteToken()` plus the server's
failed-send cleanup take over) and with another tab open (`clearPersistence()` fails there; that
tab keeps its cache). The private-resource sign-out keeps the page running and passes
`{ clearLocalData: false }`, since a terminated Firestore would break the screen it opens. Pinned
by `utils/backends/logoutCleanup.test.js` and `__tests__/LogoutCleanupCallSite.test.js`.

**Never `await` a Firestore write when a server ack cannot arrive (AT-2340).** A write
promise resolves on the **server** ack, not on the local cache write, so offline
everything after `await ref.set(...)` is not slow — it is **unreachable**, while the
mutation itself is already durable (with IndexedDB persistence the pending-write queue
survives a tab close and flushes on the next boot). It is only the _continuation_ that is
lost, which is why the symptom is never "the data didn't save": completing a task wrote
the task but never awarded XP, never wrote the done feed and never added the follower
(they all sit after `await taskBatch.commit()` in `setTaskStatus`); `updateTask`,
`setTaskDueDate`, send-to-backlog and the three workflow movers armed a focus handoff
_before_ their commit and ran it _after_, so the handoff stayed open forever with the
optimistic focus already moved; and every comment-modal wrapper calls `closeModal()` after
`await createObjectMessage(...)`, so posting a comment offline left the modal up on a
comment that had in fact been stored. Use `awaitWriteAck(write, label)` from
`utils/backends/offlineWriteAck.js`: online it returns the write promise unchanged (the
online path's durability and ordering depend on that await — see the deliberate
fire-and-forget → await change in `updateTaskInDone`), offline it issues the write and
returns immediately, logging any rejection. Two things it deliberately does not do: cover
**reads** (an offline `get()` resolves from the cache, so it does not block) and rescue a
read that rejects because the document is not cached — `tryAddFollower` reads the followers
doc, and that rejection used to discard the whole staged done feed, so `setTaskStatus` now
commits `feedBatch` in a `finally`. Pinned by `utils/backends/offlineWriteAck.test.js` and
the call-site contract in `__tests__/OfflineWriteAckCallSites.test.js`.

**A collaborator's edits must not dirty YOUR editor (AT-2340).** `handleChange` in
`NotesEditorView` set `dirtyEditor` for every Quill change, and y-quill applies remote Yjs
updates through `quill.updateContents(delta, this)` — so two people typing meant both
clients ran the **full local save fan-out** for text the other one wrote:
`lastEditionDate`/`lastEditorId` stamped with the wrong user, the edited-today list, the
started-editing feed, the backlink write and `tryAddFollower` — and each save bumped
`lastEditionDate`, which makes every other open client re-download the note. The gate is
`isRemoteEditorChange(source, binding.current)`: the change source **is** the QuillBinding
instance for remote updates, while every local change carries a **string** source. Do not
"simplify" this to `source === 'user'` — `'api'` is what Quill reports for the editor's own
programmatic edits (the image-format rewrite, template application, mention insertion),
which are local and must still save normally. Durability is kept by a separate
`remoteDirtyEditor` latch that persists the merged document **content-only**
(`setNoteData(..., { contentOnly: true })` — no preview, no edition data, no edited-today
entry, no feed, no follower) on a much longer `REMOTE_SAVE_INTERVAL`, and at teardown. The
author's own client is the primary writer; ours is a safety net.

**One note save must produce one note-document write (AT-2340).** `setLinkedParentObjects`
used to `update()` unconditionally, and it runs on every autosave through
`scanLinkedObjects` — so a note whose links had not changed (i.e. typing prose) wrote the
document **twice** per save: two versions, two `onUpdateNote` invocations, two full note
downloads from Storage and two Typesense re-indexes. `utils/backends/linkedParentsWrite.js`
compares against the **local cache** (`source: 'cache'` — no network, no billed read, works
offline, and the object is under a live listener so the cached copy is current) and skips
the no-op; every uncertain case (not cached, read error, no document) falls through to
writing, because a redundant write is cheap and a skipped one silently loses backlinks. It
takes `force` for the `beforeunload`/teardown path, where the async cache read may never
run its continuation. Server-side, `functions/searchNoteUpdateGate.js` closes the same hole
from the other end: `updateRecord`'s own `hasContentChanged` is **structurally true on every
note update** (`objectBefore.content` is mapped from the document, which has no `content`
field, so it is always `''`, while `objectAfter.content` is the real downloaded body), so
every follower/sticky/backlink write paid for a Storage download plus a re-index. The gate
requires either a content signal (`lastEditionDate`/`preview` moved — content is only ever
written together with those) or a changed indexed field.

**`getFirebaseTimestampDirectly` no longer touches `/info/currentTime` (AT-2340).** It used
to write and then read that **global singleton** — contended by every user of the app, past
Firestore's ~1 write/second per-document soft limit — through an unbounded read recursion,
on the note-autosave critical path. `utils/serverClock.js` replaces it with a measured
client/server clock offset: `getServerNow()` is synchronous and does no I/O, and the offset
is measured in the background at most every 15 minutes against a **per-user**
`users/{uid}/private/clockSync` document (owner-writable under the existing
`users/{userId}/{document=**}` rule — no rules change), estimated NTP-style as
`serverTime - (t0 + t1)/2` and read back with `source: 'server'` because a cached snapshot
of a pending write resolves `serverTimestamp()` locally. Every failure path — offline, no
signed-in user, a slow or failed round trip — falls back to the client clock, which is what
`created` already uses everywhere. Seeded once per session from `AppContent`.

**Callables fail fast offline; `runHttpsCallableFunction` is the funnel.** 36 of the 41
direct `httpsCallable(` sites now route through it (AT-2340), including goal
postpone-undo, the VM/MCP/GitLab/GitHub/GCP settings wrappers, gold changes from the
embedded iframe surface and meeting transcription. Four are deliberate exceptions:
`connectToConverter` and `connectToGmail` use the two-argument streaming-style signature
and return the raw envelope; the emulator-bootstrap block only creates a reference; and the
funnel itself. `reverseUndoAction` repeats the funnel's typed `code: 'offline'` error
locally rather than importing it, because `utils/undo/undoActions.js` is a leaf module that
the write paths import. Wrappers whose callers read `result.data` keep the envelope
(`asCallableEnvelope`) instead of silently changing their contract, and any newly
fail-fast call site needs a `catch` — an offline rejection where there was previously a
70-second hang is an unhandled rejection otherwise.
