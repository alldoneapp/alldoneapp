# AT-2690: Long-note performance

All five approved optimizations are implemented without replacing Quill or virtualizing the document.
No production note content, production writes or deployments were used for verification.

## Implementation and regressions

1. **HTML/event path:** `NoteQuill` retains ReactQuill's uncontrolled editor, selection/focus lifecycle and API. Only the note's incremental text-change events bypass both full-document HTML conversions. The consumer receives `null` for the unused HTML argument and the real Delta, source, editor and previous Delta. Explicit HTML export and clipboard conversions remain available. Real-Quill tests cover formatted text, tables, image embeds, silent/API/user changes and Yjs binding-origin events. Other ReactQuill editors retain their existing behavior. This narrow adapter is tested against installed react-quill-new 3.8.3 / Quill 2.0.3; rerun its tests when upgrading.
2. **Cursor and rendering:** mention checks read a few positions around the cursor, preserve the one-position length of embeds, and track an open mention's range through Deltas. Bounds/layout are read only for an open popup. Ordinary typing no longer changes React state in the editor area. Image conversion is scheduled separately and applies an incremental replacement, preserving unaffected task roots and transforming selection correctly. The mounted real editor regression verifies no extra toolbar renders per keystroke; mention/image tests cover cursor positions, prefix changes and deletion.
3. **Autosave:** local saves debounce for 3 seconds and use idle time, with a separate 15-second cap during continuous typing. The cap bounds scheduling when online and ready to save; it cannot bound network acknowledgement, an in-flight upload or an unverified initial download. Remote-only content retains its 60-second safety interval and no local authorship metadata. Link/task-deletion work inspects only changed spans; size scans run only after text changes. Snapshots and uploads are serialized, with another captured snapshot for edits during a save. Revision-tagged pending-upload markers are registered before upload and cannot be erased by an older acknowledgement. Page hide, hidden visibility, beforeunload and React unmount capture final content/metadata where feasible; a cancelled navigation leaves the editor usable. IndexedDB still persists every Yjs update. Unverified cached bytes stay local until a download/reconnect can merge them; preview/edition writes still use Firestore's durable queue. The closed-note reconnect sweep serializes its read/merge/upload with editor uploads. Tests include bounded/idle scheduling, network failure, content-only attribution, stale acknowledgements, close/reopen, immediate page-hide metadata and concurrent edits during upload.
4. **Local-first opening:** IndexedDB restore and Storage download start together; cached content is shown without waiting for download/WebSocket sync. Cold existing notes remain locked until Storage or the room supplies a valid state. Background data is applied into the same Y.Doc, including deletion tombstones; it is never replaced or reinserted as fresh text. Cached/offline-unverified state is displayed separately from loading and retried on reconnection/network failure. Sessions cancel their continuations/sync waits and dispose providers/persistence on note switches. Editor keys and task listeners now follow project/note identity. Tests cover stale Storage, local and remote deletions, unavailable IndexedDB, empty-new versus uncached-existing notes, and switching during both local restore and download.
5. **Deferred embeds/listeners:** live notes have one IntersectionObserver with a 600px prefetch margin. Task, image and video React roots are deferred, retaining each original Quill blot and its serialized attributes. Reserved boxes keep their size after activation (task: 480 × 24px, media: existing image/video width and responsive target height, constrained to available width); media can contain whitespace while dimensions are unknown. Activation is one-way, so loaded roots are retained on subsequent scrolls. Placeholder task titles update through one note subscription; native find/print activates remaining roots. Comments/headless editors and browsers without IntersectionObserver retain eager rendering. Note task queries and repeated subtask listeners share a reader/project/object key, replay current data and unsubscribe after the last consumer; changing a task object no longer restarts the subtask listener. Concurrent missing-task reads are coalesced. Existing embed-root teardown remains active. Tests cover geometry, selection/Delta stability, native-find activation, removal, note cleanup, duplicate listeners and reader/project isolation. This is initial lazy mounting, not full-document virtualization; URL/mention/table blots retain their current rendering path.

No dependency manifests, environment requirements or Firebase schema changes are needed.

## Run

Use Node 22 / npm 10. Seeded root dependencies were retained; web-bundler tooling was installed incrementally because it was absent. Apply the repository's documented `replacement_node_modules` overlay when using an unpatched seed.

Run the exact focused regression selection (331 tests / 32 suites passed):

```bash
npm test -- --runInBand --watch=false --testPathPatterns='(NotesEditorViewPerformance|NoteQuill.test|noteLocalFirst|noteCursorText|noteDeltaWork|noteImageConversion|noteSaveScheduler|noteEmbedVisibility|sharedNoteSubscriptions|noteUploadQueue|setNoteDataContentOnly|NotesOfflineCatchUp|pendingNoteUploads|TaskTag.test|TaskTagWrapper.test|embedReactRoot|yQuillBinding|noteContentLoader|noteLocalPersistence|mentionsHelper|remoteChangeAttribution|noteCollaborationRecovery|noteSecondaryListeners|notePaste.test|markdownTableEditing.test|markdownTableFormat.test|markdownHeadings.test|listNumbering.test|noteAttachmentDrop.test)'
```

Coverage was collected for the eleven new/changed helpers (`NoteQuill`, cursor/Delta/image/local-first/save/origin helpers, upload queue, shared subscriptions, pending registry and visibility controller): **96.61% lines, 93.49% statements, 83.07% branches**. This is scoped coverage, not a claim about global repository coverage. Global thresholds remain unchanged.

The browser harness uses the app's webpack/Babel pipeline, actual Quill/ReactQuill/Yjs, real IndexedDB and two real WebSocket clients against a loopback-only in-memory y-websocket server. Storage downloads are synthetic delayed promises, not Firebase requests. React task content is a small synthetic stand-in; the production TaskTag/subscription behavior is covered separately by Jest. External HTTP requests are blocked.

With Playwright/Chromium and the optional `ws` dependency available:

```bash
node browser-tests/at2690/run.js
# Reuse the previous bundle:
node browser-tests/at2690/run.js --skip-build
```

When browser tools live outside the repo, set `PLAYWRIGHT_MODULE` and `WS_MODULE` to their module paths and `PLAYWRIGHT_BROWSERS_PATH` to the browser directory. This VM used `/home/user/.cache/alldone-vm/at2690-browser/` for these tools, plus user-local extracted Chromium libraries/fonts; none changed repository dependencies.

```bash
export PLAYWRIGHT_MODULE=/home/user/.cache/alldone-vm/at2690-browser/node_modules/playwright
export WS_MODULE=/home/user/.cache/alldone-vm/at2690-browser/node_modules/ws
export PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/alldone-vm/at2690-browser/browsers
export LD_LIBRARY_PATH=/home/user/.cache/alldone-vm/at2690-browser/sysroot/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/home/user/.cache/alldone-vm/at2690-browser/fonts.conf
node browser-tests/at2690/run.js
```

Harness output goes to gitignored `.build/`. The committed `measurements.chromium.json` records the reported run; it is not a performance threshold test.

## Actual measurements

Headless Chromium 141, Linux VM with 2 GB RAM, loaded DejaVu/Liberation fonts, development harness, synthetic documents. The sizes are base text characters; line breaks and 20/100/200 task embeds add positions. Formatting alternates every ten characters. Each typing value is the median of seven synchronous `insertText` operations after two warm-up operations, with a real Yjs binding. It does **not** measure native input-to-paint, full-app rendering, mobile hardware or a real user's note. The stock wrapper runs before the optimized wrapper; warm-up, GC and browser variance remain limitations. Mention timings separately compare full text assembly against the cursor-local probe. Values displayed as 0.0 are below timer resolution, not proof of zero cost.

| Base characters | Shape     | Edit before (ms) | Edit after (ms) | Mention before (ms) | Mention after (ms) | Yjs encode after (ms) |
| --------------: | --------- | ---------------: | --------------: | ------------------: | -----------------: | --------------------: |
|          10,000 | plain     |              1.0 |             0.5 |                 0.0 |                0.0 |                   0.2 |
|          10,000 | formatted |              7.0 |             2.3 |                 0.2 |                0.3 |                   3.7 |
|          10,000 | embeds    |              1.5 |             0.7 |                 0.0 |                0.0 |                   0.2 |
|          50,000 | plain     |              3.8 |             1.0 |                 0.0 |                0.0 |                   0.3 |
|          50,000 | formatted |             41.8 |            13.9 |                 1.9 |                0.9 |                  14.0 |
|          50,000 | embeds    |              5.5 |             1.8 |                 0.1 |                0.1 |                   0.6 |
|         100,000 | plain     |              6.0 |             1.6 |                 0.0 |                0.0 |                   0.3 |
|         100,000 | formatted |            128.4 |            93.8 |                 5.7 |                2.5 |                  31.5 |
|         100,000 | embeds    |              9.6 |             2.7 |                 0.2 |                0.1 |                   1.0 |

HTML serialization is absent from optimized text-change events (zero calls verified), rather than merely made cheaper. Full Yjs state encoding still costs about 31.5ms at 100k heavily formatted characters in this run; it has been moved away from the per-key path and reduced in frequency, not eliminated. The remaining 93.8ms synchronous edit at that size is still substantial and merits full-app/device profiling if it matches actual use.

The 50k embed fixture initially mounted **13 of 100** React contents and kept **87** deferred. Scrolling activated additional roots; reserved size stayed 480 × 24px, Quill selection and Delta stayed unchanged, find activated the rest, and close left **zero** active roots. A small cached session became ready in **16.8ms while Storage was still unresolved**; this measures the loader only, not warm-open time for a large complete app screen. Two clients merged simultaneous changes, disconnected and edited independently, reconnected to the same content, and reopened the real IndexedDB cache without Storage.

The earlier 46ms → 9.4ms investigation numbers were Node/jsdom semantic-HTML measurements. They are a different benchmark and are not used as this browser run's baseline.

## Build verification and remaining QA

- Node runtime check, focused Jest suites/coverage, browser assertions, changed-file repository formatting and `git diff --check`: passed.
- The final actual app **development webpack compilation passed** (Node 22, heap bounded to 1000MB). An intermediate revision compiled successfully with the actual app webpack production configuration and `--no-optimization-minimize`. To fit the VM, a temporary Node preload limited reported CPU count to one and heap to 1100MB; emitted app settings were otherwise unchanged. A repeat after the final save-lifecycle changes was killed by the VM; those changes passed the mounted-editor Jest regression, but the latest complete app compilation is not locally confirmed.
- `npm run build-web-webpack`: killed on the 2 GB VM, including a bounded-worker attempt. The fully minified build/OTA generation is **not locally verified**; use the branch CI build on a larger runner before merging.
- Manual staging/device QA remains: desktop and mobile typing/scrolling for 60 seconds with realistic notes; responsive task controls and wide images/video; table editing, mention popups, native selection/find and cross-app rich copy/cut/paste; cold versus warm opening, rapid note switches, permissions/read-only access; real authenticated Firebase Storage/Firestore upload failures/retries and two separate browser contexts/devices; close immediately after an offline edit and confirm preview/search indexing on reconnect. Browser page exit cannot guarantee a network acknowledgement; IndexedDB/Firestore durability is the fallback. Without IndexedDB, offline durability cannot be guaranteed after closing the tab.
- The two-client smoke test used one browser page (including y-websocket's broadcast channel) plus a real local WebSocket server. It does not replace separate-device collaboration QA, a Firebase emulator end-to-end run, production measurements or pipeline validation. No deployment or automatic merge is included.
