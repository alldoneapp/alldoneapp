# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alldone is a React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. Runs on iOS, Android, and web with shared codebase.

## Development Commands

```bash
# Git worktree setup (run once per new worktree, before anything else)
sh setup-worktree.sh         # Links node_modules, functions/, web-bundler/, .env

# Development
npm run dev                  # Full emulator suite, then HTTPS dev server on port 19006

# Optional separate terminals (instead of npm run dev)
npm run emulators            # Auth, Firestore, Functions, Storage, Database, Pub/Sub
npm run dev:web              # HTTPS web server connected to the already running suite

# Testing
npm test                     # Run Jest tests
npm test -- --testPathPatterns="TaskList"  # Run single test file (jest 30: plural flag)
npm run coverage             # Generate test coverage
npm run update-snapshots     # Update Jest snapshots

# Build & Deploy
npm run build-web-webpack    # Build for web production (webpack 5 — see web-bundler/)
npm run format-code          # Format with Prettier
```

**Required versions**: Node 22.23.4 or newer within Node 22 (repo-wide, `.nvmrc`), npm 10, firebase-tools 13.29.3.
The minimum includes the October 2026 security fixes, including CVE-2026-111497.
Keep local pins and CI/runner Docker images on a patched Node 22 release. Firebase's
`nodejs22` runtime is managed separately; verify the actual base-image version in
Cloud Run logs instead of treating the major-version setting as proof of patching.
`npm run dev` and `npm run emulators` run `ci/prepare-local-emulators.js` before
startup. It adds an SDK-version guard to the pinned CLI's local Functions runtime:
SDK 7 removed `functions.config()`, which CLI 13 otherwise calls before every
invocation and crashes. The guard skips that legacy config helper for SDK 7+;
it does not change the Functions SDK or deployment commands. It is reapplied after
`npm ci`, and fails explicitly if the pinned CLI/runtime changes so the backport
can be reviewed or removed.
Local Auth and callable Functions requests use same-origin HTTPS proxies on the
webpack dev server (`/emulator/auth` and `/emulator/functions`); the latter forwards
to port 5001 with the project and region path. Hosted/native Functions keep their
configured regional endpoint.

Since migration Stage 5 the whole repo — installs (lockfile v3, `.npmrc` with
legacy-peer-deps), Jest, the web-bundler build, and Cloud Functions work — runs on
Node 22; the Node 14 / npm 6 / Expo/Metro CLI era is over. The retired RN-era scripts,
root webpack/Metro configs, Expo 36 package, and native React Native package were removed
in the 2026-09-16 dependency-hygiene pass. Application imports still use the
`react-native` dialect, but webpack and Jest both resolve it explicitly to
`react-native-web`; do not restore native tooling to make those imports resolve.

**web-bundler (migration Stage 0)**: `web-bundler/` is the standalone webpack 5
replacement for `expo build:web` (own lockfile, its own babel config). Since Stage 5 it is
no longer a Node-version carve-out — the whole repo is Node 22 — and it builds the app
source against the root `node_modules` (now also installed under Node 22 / npm 10) while
reproducing the exact `web-build/` output contract. Env injection stays sed-based outside
the bundler; the `replacement_node_modules` swap still applies before building. **Since
2026-08-04 this IS the deployed pipeline**: `build_web_production` (master) and `build_web_staging` (develop)
build through web-bundler on the Node 22 tooling image; `build_web_webpack_check` gives
feature branches compile signal (no deploy: see "Staging deploys only from `develop`"). The expo
build jobs are deleted; `npm run build-web` (expo) remains only as a local legacy script.
See `web-bundler/README.md`. **Strict-mode gotcha**: the
RN-era sloppy idiom `export default Name = (...)` (assignment to an undeclared identifier)
crashes under real ES modules with a `ReferenceError` that aborts the whole main chunk with
zero console errors — write `const Name = (...); export default Name` instead. Four
components were fixed for this during Stage 0; grep before assuming a blank page is a
bundler problem.

**Cloudflare worker tooling**: `cloudflare/email-worker/` uses the same patched Node 22 release as the repository via its own `.nvmrc`. The former Node 20 exception is retired; the deployed Worker itself runs on Cloudflare's managed Workers runtime.

## Architecture Overview

### Directory Structure

- `components/` - Feature-based UI (TaskListView/, GoalsView/, NotesView/, ContactsView/, etc.)
- `utils/backends/` - Firebase abstraction layer (firestore.js, openTasks.js, doneTasks.js)
- `utils/BackendBridge.js` - Central Firebase operations facade
- `URLSystem/` - Custom routing with per-feature triggers and constants
- `redux/` - State management (actions.js, store.js)
- `functions/` - Firebase Cloud Functions (v2 syntax)
- `i18n/translations/` - Localization (en.json, de.json, es.json)

### Key Patterns

**Backend Bridge**: `utils/BackendBridge.js` abstracts all Firebase operations. Feature-specific backends in `utils/backends/` (Tasks/, Goals/, Notes/, etc.).

**Firebase client SDK is v12 used through `firebase/compat`** — `import firebase from 'firebase/compat/app'`, with services attached by lazy `require('firebase/compat/<service>')` in `utils/backends/firestore.js`. The v8-era deep import `import { firebase } from '@firebase/app'` no longer exists; do not reintroduce it. Compat is fully supported, so this is a deliberate end state, not debt: converting the ~3,200 chained call sites to the modular API was measured at only 56.5 KB gzip (2.5% of the bundle) and deferred — see `FRONTEND_MIGRATION_PLAN.md` Stage 3 before reopening it.

**Never call `getFirestore(app)` in this codebase.** It does _not_ return the client that `firebase.firestore()` uses — verified in both initialization orders, they are always two distinct `Firestore` instances on the same app and the same `(default)` database. Using it would give the app two clients: two local caches, two connection streams, and writes through one not visible to the other's `onSnapshot` listeners until a server round trip. If modular helpers are ever needed, pass the compat instance's `_delegate` (`getDb()._delegate`) — that is the same client, and it works with `doc()`, `collection()`, `query()`, `where()`.

Two v9+ API removals the app already worked around, worth knowing before touching messaging: `messaging.onTokenRefresh()` is gone (token freshness now relies on `getToken()` on every load), and `setBackgroundMessageHandler` is gone from the service worker in favour of `onBackgroundMessage`. Note compat keeps `messaging.isSupported()` **synchronous**, unlike the modular API where it returns a Promise — the app's `isSupported() && …` truthiness guards depend on that, and would silently pass everywhere if switched to modular.

**A `users/` read is either an assertion or a question, and they must not share a code path (AT-2428).** `fetchUserDataResult` carries the account-recovery machinery built for the logged user's OWN document (see the 2026-08-13 note in its header): an apparent absence is re-read through the authenticated REST endpoint and, if still absent, reported at `console.error` with a full stack. That is right for the one document whose absence triggers `processNewUser`, and wrong for everything else — because an id in this app is frequently **not** a user. `getUserOrContactBy` races `users/`, contacts and two assistant collections by construction; `processURLPeopleDetails` is reached with a user id or a contact id, since opening a person's note from search routes both through `/user/{id}/…`; a chat's `creatorId` is very often an assistant. Every one of those paid a REST 404 plus a production ERROR for the ordinary answer, which is how a working contact navigation came to look like a broken account in the console. Pass `{ absenceIsExpected: true }` for those — a **probe**: no verification read, no log, `verified: false`. Two rules make it safe. A probe may only answer "not a user" cheaply; it may never turn a failed read into a missing account, so `missing` stays `false` when `error` is set. And a caller that finds **nothing** to explain the absence must **escalate** to the verified read (the same call with no options) rather than acting on the cheap answer — that escalation is not cosmetic, it is what recovers a real user whose realtime read was wrong, and dropping it would silently degrade a wedged-listener recovery into "no such person". Pinned by `utils/backends/userLookupProbe.test.js`, `utils/backends/Users/fetchUserDataResult.test.js` and `__tests__/ContactsView/Utils/ContactsHelperUserProbe.test.js`.

**A `permission-denied` from Firestore is not necessarily a denial, and a missing object used to produce one (AT-2484).** Cloud Monitoring's `firestore.googleapis.com/rules/evaluation_count` for production shows next to zero `DENY` results but hundreds to thousands of `ERROR` results per active hour, in bursts that line up with client transport restarts; a rules-evaluation error reaches the client as the same "Missing or insufficient permissions", and the SDK classifies `PERMISSION_DENIED` as **permanent** — a one-shot `get()` is not retried and a live listener is torn down. Check that metric (grouped by `result`, optionally `request_method`) before hunting for a rules regression when a user is denied data they plainly own; the reported move failed twice on the undo pre-read while the same client kept writing successfully around it, and the exact read passed for the same identity minutes later. Two consequences are built in. The task-transition undo capture (`utils/backends/Tasks/taskUndoCapture.js`) is **best-effort by contract**: a client read that fails is retried once through the authenticated REST endpoint (`readDocumentDirectlyFromServer` — same rules, no listener state), and if that fails too the move proceeds without undo instead of aborting; `queueTaskTransitionUndo` returns `null` rather than throwing. And every object collection rule (tasks, notes, goals, chats, contacts, skills, OKRs) now carries `allow get: if canProbeMissingObject(projectId)` (`resource == null && isProjectMember`) plus the same clause on `delete`, because the ordinary read rule dereferences `resource.data`, which for a document that does not exist is an evaluation **error** — so a member's read of a deleted subtask came back as `permission-denied` instead of `exists: false`, and a batch delete carrying one stale `subtaskIds` entry failed as a whole. Existing private objects are untouched (`resource` is not null for them) and outsiders still learn nothing. Pinned by `taskUndoCapture.test.js` and the `missing object probes` block in `__tests__/Firestore/firestoreRules.emulator.test.js`. Remember the rules file is only live after `deploy:firestore:rules:production` publishes it.

**URL System**: `URLSystem/URLSystemTrigger.js` handles navigation. Each feature has its own trigger file (e.g., `URLSystem/Tasks/`).

**DetailedView Pattern**: Entity screens follow `[Entity]DetailedView` naming (TaskDetailedView, GoalDetailedView, ContactDetailedView).

**Real-time Collaboration**: Quill 2 editor + Yjs for notes (migration Stage 4, 2026-08-10: quill 2.0.3, react-quill-new 3.8.3, quill-cursors 5, y-quill 1.0.0 unpatched, yjs 13.6.32 root+functions in lockstep). The old Quill-1 dist patch is retired; every customization it carried now lives in app code at `components/Feeds/CommentsTextInput/quill2Setup.js`: the `editorMeta` module decodes the `placeholder#editorType#editorId#…` convention (see `createPlaceholder`/`getPlaceholderData` in `textInputHelper.js`) and adds the `ql-container-<id>`/`ql-editor-<id>` classes; a gated Clipboard stands down quill 2's copy/cut/paste captures where the app owns them (quill 1 never captured copy/cut — un-gating cut would double-delete selections); a History subclass restores the `beforeUndoRedo` hook (hashtag-color undo entries); a Snow theme subclass renders `data-html` payloads on toolbar buttons/picker options and drops quill's built-in cmd/ctrl+K binding. Every `<ReactQuill>` must list `editorMeta: true` in its modules. Quill 2 keyboard bindings are keyed by `event.key` strings (`'Enter'`, `'Tab'`) — the numeric `bindings[13]`/`bindings[9]` idiom silently no-ops.

**Focusing a Quill 2 editor scrolls the whole app unless you stop it (AT-2220).** `quill.focus()` and `quill.setSelection()` both end in `scrollSelectionIntoView()` → `scrollRectIntoView(root, caretRect)`, which walks **every** scrollable ancestor up to `document.body` — mutating each one's `scrollTop` and finishing with a `window.scrollBy` — so the caret lands inside all of them. Quill 1 did the opposite: it saved and restored its own `scrollingContainer.scrollTop` and scrolled nothing else. The app focuses editors constantly and mostly not because the user asked: `CustomTextInput3` focuses on mount (`autoFocus`), `processInitialText` calls `setSelection`, `TaskInput` focuses again from the parent, and `EditTask` re-focuses on every popup dismiss, mention insert and assignee pick. Under stock Quill 2 each of those drags the task list (or a detailed view, or the page) to the caret — measured at up to 423px in `browser-tests/at2220`. `quill2Setup.js` therefore wraps `Quill.prototype.scrollRectIntoView` (`confineScrollRectIntoView`): it records the scroll offsets of every container **above** `quill.scrollBoundaryElement`, lets Quill run unchanged, then restores them — the Quill-1 trick, and the same save/restore `TaskEditionMode.js` already did by hand. `CustomTextInput3` sets that boundary to its own `CustomScrollView`, so an input still scrolls itself to follow the caret but can never move the app. **An editor that sets no boundary keeps stock behaviour** — deliberate, because the notes document editor's page scroller _should_ follow the caret; do not make the confinement unconditional. Restore with plain `scrollTop =` assignment, never `scrollTo()`: `html { scroll-behavior: smooth }` would animate the restore and show the jump you are suppressing.

Suppressing that scroll is only half of AT-2220. A task line **quadruples in height** when it turns into an editor (a ~34px title becomes a ~59px `TaskInputArea` plus a 55px action bar, and for an existing task a raised card with 16px bottom margin), so a line opened near the bottom edge pushes its own input and buttons past the fold — and Quill's caret-level scroll never fixes that, because the caret is at the **top** of the new editor and is already visible. `EditTask` therefore calls `useRevealEditorOnOpen` (`hooks/useRevealEditorOnOpen.js` → `revealElementInScrollParent` in `utils/scrollUtils.js`), the one thing allowed to scroll the list when an editor opens: smallest movement that makes the whole editor fit, never when it already fits, never past it, top-aligned when the editor is taller than the viewport, and abandoned the moment the user scrolls. It repeats while the element resizes for 600ms because the editor's height is not final on the first frame.

**Never read editor metadata back off `quill.options.placeholder` (AT-2227).** The `editorMeta` module decodes the encoded placeholder in its constructor and then _overwrites_ `quill.options.placeholder` with the visible text only, so every later read returns a bare string with no `editorId`/`editorType`. Under the quill-1 dist patch the encoding survived, which is why the call sites read fine and broke silently at Stage 4. Use `getEditorMetaFromEditor(editor)` / `getEditorId(editor)` from `textInputHelper.js` (they prefer the decoded `quill.editorMeta` and fall back to the raw placeholder for headless editors built with plain `new Quill(node)`). The failure is invisible rather than loud: `insertAttachmentInsideEditor` stamped every embed with `editorId: undefined`, so `CustomImageContainer`/`CustomVideoContainer` could not resolve the editor's project in `quillTextInputProjectIdsByEditorId` and fell through to `<LoadingImageVideo />` — a full-width grey slab with a spinner that never went away, on a file that had uploaded perfectly. Both containers now fall back to `state.quillEditorProjectId` so an unresolvable id can never mean "spin forever" again, and the blots no longer `setAttribute` a literal `'undefined'` that would round-trip through `static value()`. Pinned by `components/Feeds/CommentsTextInput/attachmentEditorId.test.js` (drives a REAL quill 2 + the REAL `editorMeta` module — a mocked placeholder cannot reproduce the stripping) and `autoformat/tags/CustomImageContainer.test.js`.

**Quill 2 claims file drops on the editor itself, so an app drop zone must take them in the CAPTURE phase (AT-2441).** Quill's built-in `uploader` module is enabled by default and adds its own `drop` listener on `quill.root`, inserting png/jpeg as base64 `image` embeds (`node_modules/quill/modules/uploader.js`). `AttachmentDropZone` — the shared drop target of the rich comment modal, the chat composer and the task-description field — wraps that node, so in the bubble phase Quill's listener ran **first** and the zone's `stopPropagation` came far too late: every dropped screenshot landed twice, once as Quill's base64 image and once as the app's named attachment. Hence `onDropCapture`, not `onDrop`: capture runs outside-in, so an ancestor can still claim the event. (The notes editor fixes the same conflict with `uploader: false` because its own listener is on `quill.root` too — listeners on ONE node cannot `stopPropagation` each other.) Two reasons not to copy `uploader: false` here: `Clipboard.onCapturePaste` routes a **pasted** image file through `quill.uploader.upload(...)`, which would throw with the module off, and Quill's unconditional `preventDefault` on drop is what stops the browser navigating away to the file when a drop lands on an editor with no drop zone above it. The zone deliberately claims **only** drops carrying files, so dragging a text selection inside the editor still works. Pinned by `components/Feeds/CommentsTextInput/attachmentDropDuplicate.test.js`, which drives a REAL Quill inside the REAL zone through react-dom and dispatches a REAL `drop` — including through a `createPortal`, which is where the modal actually lives. A test that calls `props.onDrop` by hand cannot see this defect; the previous suite did exactly that and passed throughout.

**That same uploader is also how a PASTED image arrives, and its embed does not survive submit (AT-2441).** `Clipboard.onCapturePaste` hands `clipboardData.files` to `quill.uploader.upload(...)`, whose default handler inserts a base64 data-URL `image` embed — and `CustomTextInput3.updateText` serializes `attachment` / `customImageFormat` / `videoFormat` and **nothing else**, so a pasted screenshot showed in the composer, looked posted, and was silently gone from the comment. Quill 1 never intercepted: the browser's own paste dropped an `<img>` into the contenteditable and autoformat's ELEMENT_NODE matcher turned it into a real attachment, so this regressed at the Stage 4 migration and only for a clipboard carrying **files** (copying an image off a web page still ships `text/html` and takes the working path — which is why it looks like it works). `quill2Setup`'s `GatedUploader` therefore routes `upload()` to `quill.appManagedFileUpload` when the editor declares one, and `CustomTextInput3` declares it — via `createAppManagedFileUpload` in `textInputHelper.js` — for inputs whose `otherFormats` actually accept attachments, never for a title or search field. Two consequences worth knowing: it inserts at the range **Quill resolved** (the caret for a paste, the drop point for a drop) rather than at a remembered cursor, and the attachment-capable inputs that have **no** drop zone above them (EditChat, the description modal, both topic composers) are fixed for drops too, because their drop is exactly what still reaches the uploader. `insertFilesAsAttachments` is now the single home of the `+3` per-file cursor stepping, shared by both paths. Pinned by `components/Feeds/CommentsTextInput/attachmentPaste.test.js` (a REAL Quill and the REAL GatedUploader — including that an editor declaring no handler still gets Quill's untouched behaviour).
**Attachment support is a property of the COMPOSER, and the assistant line had none of it (AT-2444).** The My Day / project-board assistant line (`AssistantOptions`) renders the same `CustomTextInput3` as the chat composer, which makes it look attachment-capable and is exactly why it was not: it passed no `otherFormats`, so `supportsAttachments` was false, `quill.appManagedFileUpload` was never installed and **paste was dead too**; there was no `AttachmentDropZone` above it; and `handleSendMessage` went straight to `createBotQuickTopic` without `updateNewAttachmentsData`. Those three are one feature, not three — an embed that reaches the editor without the upload step is a `blob:` URL that renders broken for everyone else and, worse, carries no `mediaContext`, so the assistant it was dropped on cannot see the image at all. The upload therefore has to run **before** the topic is created, because `storeComment` derives `mediaContext` from the text of the comment `createBotQuickTopic` writes (`extractMediaContextFromText`). Calling `updateNewAttachmentsData` unconditionally is deliberate and matches `ChatInput`: with no attachment tokens it takes no `await` at all, so its loading-spinner refcount opens and closes in the same tick and a plain-text send is not made async by it. Two smaller decisions worth keeping: the drop zone wraps the **whole card**, not the field — the composer is a 40px line inside a ~128px card, and a drop on the avatar or the quick-action row means the same thing — and because `AttachmentDropZone` claims only drags carrying **files**, a `@hello-pangea/dnd` task drag (pointer events, no `dataTransfer`) passes through untouched. An image on its own is a complete message with no extra condition, since the serialized embed token IS the text `canSend` measures. The composer's 120px height cap is raised to 260px **only while it holds media** (`assistantComposerMedia.js`), because `CustomImage` renders at 200px on desktop and a 120px viewport turns the preview into a scroller. The **assistant-project input line** (`AssistantInputLine`, the assistant profile board) needed the same treatment and could not get it cheaply: it was a plain react-native `TextInput`, which cannot hold an embed at all, so it was swapped for the same `CustomTextInput3`. Two things come with that swap and are easy to miss — the rich editor is **uncontrolled**, so clearing `message` no longer empties it and `inputRef.current.clear()` is required after a send; and `onKeyPress` no longer exists, so Enter-to-send moves to the document-level keydown listener the My Day line already uses, **including its `mentionsModalActive` guard** (without it, pressing Enter to pick a mention sends the message instead). Dictation is pinned on there too, so the two composers do not differ. Pinned by `components/MyDayView/AssistantLine/AssistantOptions/AssistantOptionsAttachments.test.js` and `components/TaskListView/OpenTasksView/OpenTaskViewForAssistants/AssistantInputLineAttachments.test.js`, which dispatch a REAL `drop` at the REAL zone inside the REAL component through react-dom — landing it on the avatar, since "the whole card is the target" is not observable from a hand-called `props.onDrop`. Note a stub whose `isFocused()` always returns false makes every Enter assertion pass vacuously; the suite controls it per test for exactly that reason.

**A throw inside `history.undo()` hands the keystroke to the BROWSER (AT-2440).** Quill runs
`history.undo()` from inside its keydown binding and its `beforeinput` handler, and both reach
`event.preventDefault()` only _after_ that call returns — so an exception does not merely fail to
undo, it lets the event through to the browser's own contenteditable undo. That native stack holds
only edits the browser itself made, i.e. typing: every paste in this app is `preventDefault()`ed and
applied programmatically (quill's `Clipboard.onPaste`, and `NotesEditorView`'s markdown/HTML/plain
pipeline). So the visible symptom of a crash in undo is not "undo is broken" but "undo skipped my
paste and deleted what I typed before it", which reads as a paste bug and is not one. The same is
true of the browser/OS **Undo command** (menu item, mobile keyboard undo, macOS Edit menu): it
arrives as `beforeinput` with `inputType: 'historyUndo'` and takes the identical path.

What threw was `beforeUndoRedo` indexing a **quill 1** stack entry. Quill 1 stored
`{ undo: Delta, redo: Delta }`; quill 2 stores `{ delta, range }` and derives the other direction by
inverting `delta` against the live document — so `stack.undo[last].undo.type` was `undefined.type` on
every undo and redo, in every editor, from Stage 4 until AT-2440. Two entry shapes now coexist in
that stack and `quillHistoryEntries.js` is the one place that tells them apart: quill's own
delta-bearing entries, and the app's **delta-less marker entries** (hashtag colour changes, pushed
straight onto `history.stack.undo` by `HashtagWrapper`). Quill's own code assumes the first shape
everywhere, so a marker entry can throw from three places, and only one of them is undo: the merge
inside `record()` pops the previous entry and composes deltas with it, and `transformStack()` (run
for every non-`user` change, which with `userOnly: true` means every programmatic edit and every
remote Yjs update in a shared note) dereferences `.delta` on all of them — that one breaks **typing**,
not undo. `HookedHistory` overrides `record`/`transform` for exactly this, and never hands quill an
entry it cannot invert.

Related and deliberate: a **paste is its own undo step**. Quill coalesces everything inside
`history.delay` (1000ms) into one stack entry, which is right for typing and wrong for a paste —
type a word, paste, undo, and both would vanish. `isolatePasteInHistory` cuts the window on both
sides of the paste in both pipelines. The trailing cut is safe for the autoformat rewrites that ride
along with a paste (a pasted task URL collapsing to a chip): those run synchronously from the
`text-change` the paste emits, so they have already merged into the paste's entry. Pinned by
`components/Feeds/CommentsTextInput/pasteUndoHistory.test.js`, which drives a REAL quill 2 with the
REAL `quill2Setup` modules and asserts on `defaultPrevented` — a mocked history module cannot
reproduce any of this, because the defect lives in how the app's hook and quill's stack shape
compose.

**A task tag in a note is rendered with NO `taskId` half the time (AT-2428).** `TaskTagWrapper` has two entry points and they look nothing alike. `taskTagFormat.js` mounts it per embed with a real `taskId`; the note toolbar's add-task button mounts it with **none at all** — `NotesEditorView.renderTask` only calls `storeModal(MANAGE_TASK_MODAL_ID)`, and `DvContainer`/`NoteIntegration` render a bare `<TaskTagWrapper editorId={note.id} />` whose `useState(!taskId)` opens `ManageTaskModal` in create mode. So `taskId` is legitimately `undefined` and every guard in the component has to survive it. The trap is comparing against it: `recoveredTask?.taskId === taskId` is **true** when both sides are `undefined`, which is how a missing-task recovery guard came to dereference a null `recoveredTask` and crash the editor on every press of the button (`Cannot read properties of null (reading 'task')`). Guard on the record, not on a comparison two `undefined` operands satisfy. Tests must render it the way the toolbar does — passing a placeholder id instead of omitting the prop is exactly what hid this. Pinned by the `opened from the note toolbar` block in `components/Feeds/CommentsTextInput/autoformat/tags/TaskTagWrapper.test.js`.

**A note mention is a `url` embed, and its title comes from the LINK, not from the stored `type` (AT-2950).** An @-mentioned note is stored as `{ url: { url, type: 'note', ... } }`. `LinkTag` resolves its title from its own listener on the object. The iOS app serves the bundle from `capacitor://localhost`, so a mention written there was stored with that origin and typed `plain`. `LinkTag.getPathname` then prefixed `http://`, read the host as `capacitor`, treated the link as external and showed the path instead of the title, both in the app and on the web. Three rules now hold. Links are built with `getAppLinkOrigin()` (the hosting URL inside the shell), never `window.location.origin`. `capacitor://localhost` is an app origin (`isAppLinkOrigin`, `getAppLinkPathname`). The `url` blot re-derives a `plain` chip's type from the link's own project (`getInternalLinkType`), without writing back. Two failure paths also show the title now: a failed `getObjectFromUrl` read (`error`) keeps the chip typed instead of demoting it or rendering nothing, and `LinkTag` re-opens a failed listener a bounded number of times (`getObjectLinkRetryDelay`, AT-2484's transient `permission-denied`). Never build a stored link from `window.location.origin`. About 90 copy-link sites still do, so links copied in the iOS app carry the shell origin, and this read side is what keeps them working. Pinned by `utils/LinkingHelper.appShellLinks.test.js`, `components/Tags/LinkTagAppShellLinks.test.js`, `formats/urlNoteMention.test.js` (a REAL quill 2 and the REAL blot) and `mentionsHelperNoteMention.test.js`.

**A task tag that "disappears" from a note is still in the document — it drew itself away (AT-2454).** Reload brings it back, so the blot and the Yjs entry were never touched; only the rendered content was gone. Two independent mechanisms produced that, and both are about the row rendering _nothing_ rather than about data loss.

**1. `TaskTag` measured its own width and clamped itself to zero.** The row computes `maxWidth = windowWidth - getBoundingClientRect().left - gutter - 50` and used to size its icon+title with `Math.max(0, maxWidth - tagsWidth)` under `overflow: hidden`. That clamp was introduced in Sep 2025 to silence a negative-dimension warning, and it is what turned every bad measurement into an invisible task: a negative `max-width` is invalid CSS the browser ignores, `max-width: 0` is obeyed. Every input to it can go wrong. `left` grows as text typed _before_ the row pushes it right ("editing the note nearby the task"); the row's own `minWidth: 150` container then keeps a blank 150px hole where the task was. The window-resize branch subtracted `(previousWidth - width) + 50` from a **stale-closure** `maxWidth` and never gave the 50 back, so one drag-resize (dozens of resize events) drove it deeply negative. And `react-native-web`'s `useElementLayout` decides **once, on mount**, whether to observe the node — its observing effect depends only on `[ref, observer]` — so passing `onLayout={!isLoading ? onLayout : null}` meant a row that mounted while its task was still loading (the ordinary case: the `watchNoteInnerTasks` snapshot lands after the editor renders) was **never measured again** and kept whatever the single manual measurement produced. The rules now: `maxWidth === 0` means _unknown_, never _zero pixels_ — an unusable measurement leaves the row unconstrained; the label never goes below `MIN_TASK_TAG_LABEL_WIDTH`, so it truncates instead of vanishing; `onLayout` is always a function; `name`/`icon`/`photoUrl` are derived, not state written from an effect (the old effect left `name === ''` on the first commit after a task arrived, and `name` gated the whole row); a loading row always draws `LoadingTag` (the `editorId === activeNoteId` guard made it a zero-size hole in every other editor); and a task with an empty `extendedName` — which `mapTaskData` allows — is named rather than rendered as `null`.

**2. React's root inside a quill 2 embed did not own its container.** Every React-backed blot renders with `ReactDOM.render(<Provider …/>, node)` where `node` is the blot's own `domNode`, and quill's `blots/embed` constructor runs immediately after `create()` returns and **moves every child of `node` into a private `contentNode`**, then wraps it in the two cursor-guard text nodes. React is never told, so its container stays `node` while its root host child lives one level down. A container-level **insert** then lands after the right guard instead of inside `contentNode`; a container-level **delete** calls `node.removeChild(child)` on a node that is no longer its child and throws `NotFoundError` during commit — with no error boundary React 18 tears the whole root down and leaves an **empty embed span**; and an async **first** render into an already-constructed node (url.js renders from a `Backend.getObjectFromUrl` callback) makes React clear a container it does not recognise, taking quill's guards and `contentNode` with it. `AppPopover` makes exactly that container-level swap (`<Popover>` ⇄ fragment + `BottomSheet`) whenever the viewport crosses `MODAL_SHEET_BREAKPOINT`, i.e. on a rotation or a window resize. `formats/embedReactRoot.js` gives React its own `display: contents` mount element, placed inside `contentNode` when the blot already exists; quill relocates that element with React's subtree inside it and the container stays a real parent of its own children. **Never call `ReactDOM.render(element, blotDomNode)` in a blot — use `renderEmbedContent(node, element)`.** Pinned by `components/Tags/TaskTag.test.js` and `components/Feeds/CommentsTextInput/autoformat/formats/embedReactRoot.test.js`, which drives a REAL quill 2 and asserts the unfixed shape still reproduces each failure.

The contract both of them exist to protect is one line, and it has its own end-to-end suite (`formats/taskTagVisibility.test.js`, the REAL blot + REAL wrapper + REAL row inside a REAL quill): **a task embed in a note always renders something a user can see.** Before the fix that suite reports the embed's visible text as `""` on every case, which is exactly the reported symptom — a blank ~150px hole where the row was (the `container` style carries `minWidth: 150`, so an empty row is a gap rather than closed-up text). Note the row's visibility used to depend on a **passive effect flushing**: `name` was state written from `useEffect`, so the first commit after a task arrived rendered `null`. Anything that delayed or skipped that flush left the gap permanently, and only reopening the note rebuilt it.

**Those roots are now torn down, and it takes two mechanisms because quill answers two different questions (follow-up to AT-2454).** Nothing used to unmount them at all — `autoformat/formatsManager.js` was dead code with no callers — so every `editor.setContents(...)` (the image-format rewrite, the remove-tag path, `onCopy`'s throwaway editor, and above all the ordinary load of a note's content) orphaned one root per embed together with its redux subscription and, for a task tag, its `Backend.watchSubtasks` Firestore listener. Reopening the same note simply added another set, and the debug logs a couple of those wrappers still carried made it visible: three email tags logging four times each on every open.

**A blot that is deleted** is covered by `detach()`, the one teardown hook parchment offers (it calls it from `remove()`, from `ParentBlot.detach()`'s recursion and from the scroll's removed-node handling). Every React-backed format now extends `formats/reactEmbedBlot.js` instead of importing `blots/embed` itself, so no format can forget. **An editor that goes away** is covered by nothing at all — quill 2 has no `destroy()`, so leaving a note, unmounting a `CustomTextInput3`, discarding `onCopy`'s throwaway editor or finishing with one of `notesHelper`'s virtual editors drops the whole document without a single `detach()`; those four sweep with `unmountEmbedReactRoots(quill.root)`. Note the notes editor sweeps from its effect's cleanup and NOT from `cleanup()` itself, which also runs on `beforeunload` where the editor is not going away.

Three details are load-bearing. The unmount is **deferred to a microtask**: `detach()` runs inside quill's own mutation processing and React's unmount is synchronous, so doing it inline re-enters the scroll observer and, at a sweep call site, flushes inside another root's commit phase. It **re-checks that the node really left the editor** (`scroll.domNode.contains(node)`) — parchment's own removed-node guard skips a node that merely moved, but it tests containment in `document.body`, which is false for every headless editor, so the blot's own scroll is the check that holds there. And a torn-down root is **remembered** (`disposedRoots`), because `unmountComponentAtNode` leaves the container in the DOM: without it `url.js`'s `Backend.getObjectFromUrl` callback would happily mount a fresh tree into an embed that is already gone. Pinned by `formats/embedReactRootUnmount.test.js`, which drives a REAL quill 2 and pairs each case with the unfixed shape. Related dead weight removed at the same time: each format kept a static `X.refs` map that appended a `createRef()` per blot forever and was never read by anything.

**`replacement_node_modules/` full inventory** (the blanket `cp -R -f replacement_node_modules/* node_modules/` applies ALL of these after every install — when upgrading any of these packages, the patch must be re-derived or retired first, never blindly re-copied over the new version):

- Retired in migration Stage 4 (2026-08-10): `quill` (dist patch → `quill2Setup.js` app code, see above), `y-quill` (the yjs#474 workaround — fixed upstream in yjs 13.6, pinned by `components/NotesView/NotesDV/EditorView/yQuillBinding.test.js` and `__tests__/Yjs/yjs1347Compat.test.js`), and `y-webrtc` (the whole package was removed — notes collaboration has used `y-websocket` for years; the WebRTC path was dead code).
- `@hello-pangea/dnd` (v18.0.1) — adds `index` to the drag `combine` payload (pointer
  path); `DragHelper.onDragEnd` needs the combine target's index to sort a task dropped
  onto another task (consumed at `components/DragSystem/DragHelper.js:645`). Carried over
  from the retired react-beautiful-dnd patch; patches `dist/dnd.esm.js` + `dist/dnd.cjs.js`,
  which are still `module`/`main` in v18, so those two files cover both webpack and jest.
  **Re-derived against pristine v18 in Stage 6 and now a 4-line diff against upstream** —
  keep it that way. The previous v16 copy had been prettier-formatted, which made it diff
  at 14,089 lines and rendered the actual change invisible; `.prettierignore` excludes
  `replacement_node_modules` precisely so these files keep upstream's formatting. When
  bumping this package, diff the vendored file against the new pristine dist and re-apply
  the one `index:` line — do not let the blanket `cp` carry the old bundle over a new
  install (it produced a silent v18-metadata/v16-code hybrid exactly once already).
- `react-native-gesture-handler` — four-file compatibility patch for
  react-native-web ≥0.19: `GestureComponents.web.js` guards the removed
  `DrawerLayoutAndroid` (unguarded `.positions` crashed module eval);
  `web/GestureHandler.js` resolves the DOM node from the ref (`findNodeHandle`
  now throws) and reads event callbacks through the threaded wrapper instance
  (refs are DOM nodes without `.props`); `RNGestureHandlerModule.web.js` +
  `createHandler.js` thread that wrapper through `attachGestureHandler`
  (extra argument, ignored on native).
- `react-dismissible`, `react-tiny-popover` — modal dismiss-behavior **and positioning**
  patches (see the popover notes below, including "a popover that fits nowhere").
- `react-native` (`VirtualizedList`/`FlatList`) — native-era patches; inert on web
  (the web bundle aliases react-native → react-native-web).
- `expo-font` — obsolete since migration Stage 1 (app uses `utils/WebShims/Fonts.js`);
  inert.
- Retired in migration Stage 2: `react-native-web` (TouchableOpacity dismissible-touch
  hook → now a document-level capture listener in `AppNavigator.js`; ScrollViewBase
  `onScrollWhenDisabled` → had no users; TextInput `outline: none` → covered by the
  global `*:focus` rule) and `react-beautiful-dnd` (→ the @hello-pangea/dnd patch above).

**Yjs Text Formatting**: When inserting text with `ytext.insert()`, passing `undefined` for attributes causes attribute inheritance from adjacent text — still true in yjs 13.6 (it is documented `Y.Text` behavior, not the fixed bug below). Always explicitly set formatting attributes to `null` to clear them (e.g., `{ bold: segment.bold ? true : null }`). This applies to markdown-to-Yjs conversion in `functions/Assistant/markdownToYjs.js`.

**Yjs applyDelta() Format Removal — fixed upstream, patch retired (Stage 4)**: yjs 13.4's `applyDelta()` ignored `null` attributes for format removal ([yjs#474](https://github.com/yjs/yjs/issues/474)) and inherited neighbouring formats on plain inserts; a patched `y-quill` in `replacement_node_modules` worked around both. yjs 13.6 fixes both behaviors, so the app now runs stock `y-quill@1.0.0` with no patch. The old failure modes are pinned by regression tests — `components/NotesView/NotesDV/EditorView/yQuillBinding.test.js` (binding-level: null-attribute removal, background "None", bleed-after-persist, remote-insert negation) and `__tests__/Yjs/yjs1347Compat.test.js` (13.4.7-encoded fixture docs: decode fidelity, byte-stable reload, `TemplatesHelper`'s mutate-`toDelta()`-embeds-by-reference contract). If either suite fails after a yjs/y-quill bump, do not ship.

**Background Color "None" Handling**: The highlight color picker's "None" option must call `editor.format('background', false)` (not `editor.format('background', '#FFFFFF')`). Setting to white (`#FFFFFF`) leaves an explicit `background` attribute in Yjs that causes format inheritance when typing adjacent to previously-highlighted text. Using `false` generates `{background: null}` in the delta, which removes the attribute from Yjs (natively handled by `applyDelta` since yjs 13.6).

### State Management

Redux store in `redux/store.js` (~116k lines) with actions in `redux/actions.js` (~63k lines). Uses `@manaflair/redux-batch` for batched updates.

Since migration Stage 6: **redux 5 + react-redux 9**. The app is hooks-only — there are
no `connect()` call sites, just `useSelector`/`useDispatch`/`shallowEqual`/`useStore` —
so react-redux's class-era API surface is irrelevant here. `@manaflair/redux-batch` is
unmaintained and declares `peer: {redux: "*"}`; it was verified working against redux 5
(array and nested-array dispatch still coalesce to one subscriber notification), but it
is the thing to check first on any future redux bump, since nothing upstream will.
**The app stays on React 18.3.1 deliberately** — see `FRONTEND_MIGRATION_PLAN.md`
Stage 6 for why React 19 was measured and declined (13 live quill blots would have to
move from synchronous `ReactDOM.render` to asynchronous `createRoot`). Do not introduce
new `ReactDOM.render`, `unmountComponentAtNode`, or `findDOMNode` call sites regardless;
they are all React 19 removals and every one added now is future migration cost.

**Never subscribe an all-projects view to a whole `xByProject` map (AT-2336).** Nearly
every per-project slice in the store is a plain object that the reducer replaces
wholesale (`{ ...state.boardMilestonesByProject }`), so writing **one** project's slice
changes the identity of the map holding **all** of them. A component that selects the map
therefore re-renders on every per-project write, and the all-projects views fan out one
Firestore watcher **per project** — so the writes arrive in proportion to the project
count and the settle cost is O(projects²). This is not theoretical at dogfooding scale:
the reporting account has **78 active projects** (64 of them guides), and "All projects –
Goals" settled with a measured **12,168** renders of `MilestonesListByProject` versus 233
after the fix. Note the data was never the problem — those 78 `watchAllGoals` listeners
return only ~363 documents / ~1.4 MB in total; it is pure render amplification. The
pattern that fixes it, in `components/GoalsView/goalsBoardSelectors.js`: the parent
selects a **flat map of primitives** carrying only what it needs for ordering and
`canShowProject` (a `"<date>|<id>"` string, because objects allocate a fresh identity on
every selector run and defeat `shallowEqual`), compares it with `shallowEqual`, and the
per-project child reads its own slice with `useSelector(state => state.x[projectId])` and
is wrapped in `React.memo`. The memo only pays off if the callbacks the parent passes down
are `useCallback`-stable, which is why `GoalsView`'s dismissible handlers are.

Two related traps in the same view, both worth copying elsewhere. A per-project effect
whose **cleanup nulls the slices it is about to rewrite** turns every snapshot into a
redundant write pair and defeats any equality guard — clearing belongs in an
unmount/user-change effect, not in the recompute's cleanup. And an equality guard over
recomputed redux slices should compare **element references**, not deep values:
`mapGoalData`/`mapMilestoneData` rebuild every object per snapshot, so reference
comparison can never swallow real data while still catching the recomputes triggered by
mount, tab switches and unrelated store churn. Pinned by
`components/GoalsView/GoalsViewAllProjectsPerformance.test.js`,
`goalsBoardWrites.test.js` and `goalsBoardSelectors.test.js`.

**Known remaining cost in the Goals board, not yet fixed:** `MilestoneStatistics` opens a
live `items/{projectId}/tasks` listener per milestone header to render one
`N Tasks · N Story Points` line, and the "Someday"/backlog header passes a milestone
timestamp of **year 5000**, so its window is effectively unbounded. On the reporting
account's main project that single line streams **1,165 task documents / ~5.7 MB**. It is
always mounted in the single-project Goals view. Fixing it means either sharing one
per-project task listener across milestone buckets or making the stats lazy — not a
cosmetic change, so it was left out of AT-2336.

### Client performance telemetry

Boot, page readiness, Firestore first snapshots, offline note workers and bulk task operations emit
sampled, consent-gated `performance_trace` events through `utils/performance/performanceLogger.js`.
No entity ids are accepted. For the debug console, in-memory record buffer and controlled
Firestore-persistence/note-prefetch comparison switches, see `PERFORMANCE_DIAGNOSTICS.md`.

### Firebase Functions

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

**An AI workflow step finishes when its work finishes, not when the assistant stops talking.** `execute_task_in_vm` returns as soon as the job is enqueued, so a step whose assistant dispatched a VM job would otherwise hand the task to the next reviewer while the work it asked for runs on for up to five hours. `runWorkflowAiStep` therefore parks the run as `awaiting_vm` with the dispatched correlation ids instead of advancing. The VM runner calls `resolveWorkflowAfterVmJobSettlement` after result delivery, billing/refunds, queue handoff and the terminal status write, so the parked workflow re-checks immediately without adding an Eventarc invocation for every 30-second VM heartbeat. `onUpdateWorkflowAssistantRunSecondGen` closes the pre-VM ordering window where the chat assistant lock can be the last blocker to settle. The one-minute `runWorkflowAiStepsSecondGen` poller still calls `resolveAwaitingVmRuns` as a recovery and timeout backstop; it is no longer the normal completion signal. The task move and workflow-run settlement share one Firestore transaction so a runner retry, Eventarc redelivery or an overlapping poll tick cannot advance twice. A failed or cancelled VM job still settles its parked run instead of leaving it stuck, matching how a failed assistant run behaves — but note it does **not** move the task: `finalizeWorkflowAiRun` only builds a step transition when there is no `failureReason`, so a failed step stays where it is and is handed to the requesting user by the AT-2196 reviewer hold below. `AWAITING_VM_TIMEOUT_MS` is the backstop for a job that never settles and is derived from `vmJobConfig`'s runtime + finalization budget, so raising the VM budget cannot silently leave it behind. **A VM agent can stop and ask the user a question** (`status: 'awaiting_user'`, see `vmInteraction.js`), and that interaction stays open for `VM_INTERACTION_TTL_MS` — 24h, far beyond the run budget — so `resolveAwaitingDeadline` pushes the deadline out to the job's own `interactionExpiresAt` plus a further run budget rather than abandoning a step the user can still rescue by answering. It stays bounded because each extension needs a real, unexpired interaction: a job that simply hangs is still abandoned on the original schedule. Note an unattended step whose agent asks a question simply waits — nobody is watching the thread. Check the parked run by its recorded correlation ids, never by re-querying the task for recent jobs: the jobs were started _before_ the run parked, so any time-windowed lookup misses them and advances immediately.

**Whether a step's configured prompt is suppressed is decided in the task trigger, not in the dispatcher (AT-2222).** A step that lands on a task the assistant is already working on must not post its configured prompt on top of that work; the run parks as `awaiting_vm` with `awaitingSkipReason: 'task_ai_run_already_active'` and settles `skipped`, advancing the task once the live work finishes. The trap is _when_ liveness is measured. `runWorkflowAiStepsSecondGen` is a one-minute poller (a prompt run cannot live behind a 540s event trigger), so a check made there answers "is something running a minute later", not "was something running when the task arrived". A VM job lives for hours and is therefore always still visible; **a normal assistant answer is usually over inside that minute**, so the step posted its configured prompt straight after the answer the user had just read — the same logic, opposite outcome, purely because of duration. `enqueueWorkflowAiRunIfNeeded` therefore evaluates `findLiveTaskAiWork` itself — the `onUpdateTask`/`onCreateTask` fan-out is the only moment synchronous with the task landing on the step — and creates the run already parked. `runWorkflowAiStep` keeps its own checks for work that starts during the gap and is still running. Only genuinely live work blocks: a settled chat run or a terminal VM job never suppresses a step. Two things the check must **not** look at, both of which would stall every AI→AI workflow: the coarse `assistantTaskRunLocks` slot (an AI step advances the task from _inside_ its own run, so its lock is still held when the next step is enqueued — this is why detection uses the message-level `assistantRunLocks` instead, which workflow runs never write), and any time window rather than live state. Detection is task-scoped (`objectId == taskId`), so an assistant creating a task from another thread cannot park the new task behind its own run. Heartbeats and recurring assistant tasks write no lock at all and so never suppress a step — deliberate: only human-triggered work counts as "the thread is already being served".

**A background assistant run only gets full task context if you give it a trigger message.** `generatePreConfigTaskResult` takes its canonical path — `getOptimizedContextMessages`, which assembles project, task title, task description, prior chat history, mentioned notes and open-task counts — **only** when `options.triggerMessageId` names a comment that exists in the thread. With no trigger message it silently falls back to base instructions plus the bare prompt, so the assistant has no idea which task it is working on. This is why background runs seed the thread first: post the prompt as a real user-authored comment via `postUserRequestComment` (`assistantHelper.js`) and pass the returned id as `triggerMessageId`. Both the VM host task and workflow AI steps do this; it also means the user reads exactly what was asked, and the exchange stays in history for the next step. Passing the prompt alone is the trap — it looks like it works, and the answers are just quietly ungrounded.

**Anything hosting an assistant prompt run must derive its timeout from `functions/Assistant/assistantRunLimits.js`.** A prompt run gets a 55-minute wall clock (25 for heartbeats, sized to the Cloud Tasks ceiling), and the transport must outlive the run it carries — a transport that dies first kills the assistant mid-answer and is indistinguishable from a crash. The timeout is computed from the wall clock rather than hardcoded alongside it, and `assistantRunLimits.test.js` fails the build if any entry point in `ASSISTANT_RUN_HOSTS` drops below its run's budget, sits behind an event trigger, or if any event-triggered function anywhere in `index.js` exceeds 540s. **Add a function to `ASSISTANT_RUN_HOSTS` when it starts executing prompts.** A long assistant run cannot live behind a Firestore trigger at all: `runWorkflowAiStepsSecondGen` is therefore a one-minute `onSchedule` poller that claims `pending` runs out of `workflowAiRuns` under a Firestore lease, the same way `checkRecurringAssistantTasks` already runs assistant work on the full budget.

## Development Guidelines

### Localization

Always consider i18n. Translations in `i18n/translations/` (en.json, de.json, es.json). Use TranslationService for new strings.

### In-app assistant models (chat, heartbeat, labeling)

`functions/Assistant/selectableAssistantModels.js` is the **one** product menu of assistant models,
and adding an entry there surfaces it in every picker at once: assistant model, heartbeat model,
inbound email, per-task override, Gmail labeling and calendar routing. Each selectable entry also
carries its actual in-app `tokensPerGold`; `assistantHelper.getTokensPerGold` reads that shared value
for billing, while `components/UIComponents/AssistantModelGoldRate.js` renders the same translated
`1 Gold = N tokens` line in every picker. Do not reuse the separate VM-agent divisor: the two product
paths can intentionally pass through different amounts of an upstream saving. Everything else is a per-capability
allowlist keyed on the product key (`MODEL_GPT5_6_SOL`, `MODEL_DEEPSEEK_V4_FLASH`), never on the
upstream id. Adding a model means setting `tokensPerGold` in the shared entry, then touching
`assistantHelper.js`'s `getModel`, `getMaxTokensForModel` and each `modelSupports*` gate, plus the label chains in `ModelWrapper.js` /
`assistantUpdates.js` / `UpdateFromTemplate.js` and the `i18n` label. **A model missing from
`getTokensPerGold` is billed nothing at all** — it returns `undefined` and
`calculateGoldCostFromTokens` turns that into `0`, silently.

**This is a separate system from the VM agent catalog** (`vmAgentModelCatalog.js` /
`vmModelRouting.js`). The VM harness encodes its provider into the model string
(`openrouter:vendor/model`) because the user picks from a live catalog of hundreds. The in-app
assistant does the opposite — a short curated list whose keys are already persisted on assistant
docs, Gmail configs and calendar configs — so the key stays opaque and the upstream id lives in a
table (`assistantModelRouting.js`). That is what lets the pinned DeepSeek release be bumped on one
line without a data migration.

**DeepSeek V4 Flash via OpenRouter (AT-2238)** is the first non-OpenAI, non-Perplexity assistant
model, pinned to `deepseek/deepseek-v4-flash-0731` rather than the floating
`~deepseek/deepseek-v4-flash-latest` alias, which would swap the model under live assistants and
labeling configs with no review. The load-bearing constraint is the **wire protocol**: chat and
heartbeats run on OpenAI's **Responses** API (`openai.responses.create`), and OpenRouter serves only
the OpenAI-_compatible_ **Chat Completions** surface — the same split `vmJobRunner` already handles
for Codex with `wire_api = "chat"`. So OpenRouter chat takes a second transport,
`openRouterChatClient.js`, which terminates at the _same_ stream contract
(`{content, additional_kwargs}` plus a trailing `tool_calls` event) so the tool loop, Gold metering
and progress status are untouched. Three consequences worth knowing: hosted **tool-search is
Responses-only**, so OpenRouter runs always send full function schemas (Flash's 1M window absorbs
it); `prompt_cache_key` / `prompt_cache_options` / `prompt_cache_breakpoint` are **OpenAI
extensions** and are omitted rather than sent hopefully; and Flash is **text-only**
(`input_modalities: ['text']`), so image parts are replaced with a readable placeholder instead of
failing the whole request. Modality is answered per model by
`assistantModelSupportsImageInput` in `assistantModelRouting.js` — it sits next to the pinned
upstream id because it is a fact about that release, and an unlisted OpenRouter model is assumed
text-only (a stripped image degrades to a note the model can explain; an image sent to a text-only
model takes the whole request down). The transport counts the replacements and warns, because a
dropped image is otherwise invisible: the request succeeds and the only symptom is an answer that
ignores the attachment the user is looking at.

**A chat image is fetchable, and `get_chat_attachment` used to say otherwise.** The tool and its
fallback filtered `media.kind === 'file'`, while WhatsApp and web uploads store a photo as
`kind: 'image'` — and `list_recent_chat_media` advertises those images together with their
messageIds. So the discovery tool named an image the fetch tool then denied existed
(`No file attachment was found on the requested chat message`), which is exactly the loop a
text-only model falls into when it cannot see an attached photo: it asked three times and burned a
minute of wall clock before answering. The bytes come from the same `storageUrl` whatever the kind,
so `isFetchableChatAttachment` now accepts `file`/`image`/`video`. The one thing widening the kinds
must not break is a message carrying an image **next to** a document: that used to resolve to the
document, so `selectRequestedChatAttachments` keeps that preference rather than turning a working
call into an ambiguity error, and an explicit `expectedFileName` outranks it. Base64 never enters
the conversation either way — `buildConversationSafeToolResult` redacts it. Labeling was the cheap half — the Gmail and calendar classifiers already
call `chat.completions.create`, so only the client swaps (`classifierModelClient.js`). Both
classifiers resolve their **two passes independently**, because a DeepSeek first pass with the
default OpenAI auditor is the normal configuration. Chat Gold rate is **2000 tokens/Gold** (Sol 100,
Terra 200, Luna 500) — a deliberate fraction of the ~80x upstream cost advantage, matching how
Luna's 25x is priced at 5x. Requires `OPENROUTER_API_KEY`, which **had never been whitelisted in
`envFunctionsHelper.js`** — that file builds explicit key objects rather than spreading the env
blob, so the key was `undefined` at runtime even when present in `GOOGLE_FUNCTIONS_ENV_DEV/_PROD`;
adding a secret to the blob is not enough, it must be listed there too.

Calendar routing additionally gained the model picker and the server-side allowlist it never had.
It previously accepted **any** string and defaulted client-side to `MODEL_GPT5_4_NANO`, a key
outside the selectable set that the classifier's mapper did not know — so it fell through to
`gpt-5.2`, and calendar labeling ran on a model that was neither stored nor chosen.

### Hosted tool search hides tools, and an unattended run cannot ask again

`buildResponsesTools` (`functions/Assistant/assistantHelper.js`) uses OpenAI's hosted **tool
search**: once a request carries `TOOL_SEARCH_MIN_FUNCTIONS` (10) or more function schemas on a
tool-search-capable model, **every** function is marked `defer_loading: true` and packed into
namespaces, and the model is sent only `{type: 'tool_search'}` plus the namespace descriptors. A
typical assistant therefore starts a turn with **zero directly callable functions** — 48 deferred
behind 10 namespaces is the ordinary case for the dogfooding account — and has to search for each
tool by name before it can call it.

That is a token optimization whose failure mode is a **silently wrong answer, not an error**. A
daily recurring task ("update my global user description") did every step of its work — eight model
rounds, `get_tasks` twice, `get_goals`, `get_notes`, `get_updates`, `get_contacts`, `get_chats`,
three minutes, 23 Gold — produced a correct new description, and then wrote _"I couldn't persist the
update because the available tools in this thread do not expose `update_user_description`."_ The
tool was in the assistant's `allowedTools` and in the assembled schema list for that exact request;
it sat in the `people_and_projects` namespace, the same one the run had already pulled `get_contacts`
out of. The model simply never searched for it, and a model that concludes a tool is missing does
not retry. Nothing failed, nothing was logged as an error, the task was marked done and the Gold was
spent. The same task on the same model succeeded on each of the three preceding days.

Three rules come out of that, and they are independent:

**A tool the prompt names in writing is never deferred.** `addBaseInstructions` injects lines like
_"use `update_user_description`"_, and an assistant's own `instructions` name their tools too — so
the model is told by name that a tool exists while the schema for it is hidden. `interactWithChatStream`
runs `collectPromptReferencedToolNames` over the **system** messages and passes the hits to
`buildResponsesTools` as `alwaysDirectToolNames`; those go out as ordinary direct tools and the rest
still defer. Scanning is deliberately limited to system messages — they hold our base instructions
and the assistant's configured instructions, whereas a tool name in a user turn or a tool result is
conversational noise that would pin schemas for the whole thread. Matching is longest-name-first, so
`web_search` is never reported as a bare `search`.

**`execute_task_in_vm` is never deferred either, named or not (AT-2842).** No system message names
it, so the rule above never pinned it, and the namespace it landed in (`tasks_and_goals`) mentions
only "execution jobs". Asked in a task thread to check a deploy and run a migration, the Alldone CTO
(tool enabled, GitLab repo connected) answered in one round, without a tool search, that it had no
access to a VM, GitLab or a deployment console, and told the user to use "the VM-capable session of
this task", which did not exist. It never saw the tool's own description, which says to use it for any
coding or repository work. The thread made it worse: the status comments a coding agent had posted
through MCP sit in the context as **user** turns and talk about "the other session". So
`NEVER_DEFERRED_TOOL_NAMES` in `assistantHelper.js` is merged into `alwaysDirectToolNames` inside
`buildResponsesTools` for every caller. It changes nothing for an assistant without the tool, since
only schemas already in the request can be sent directly. Add a tool there only when its absence
makes the model explain instead of search; every entry costs a full schema in every request that
carries it. Pinned by the `execute_task_in_vm is never deferred` block in `assistantHelper.test.js`.

**An unattended run turns tool search off entirely.** Tool search trades a retry for a smaller
prompt, and an interactive user simply asks again — but nobody is watching a recurring task, a
heartbeat or a workflow AI step, so there the trade is all cost. `generatePreConfigTaskResult` takes
`options.disableToolSearch`, and all four unattended call sites set it: `assistantRecurringTasks`,
both `assistantHeartbeat` sites, and `workflowAiStep`. The workflow step is the worst of them to get
wrong — it **hands the task to the next reviewer when it finishes**, so a step that reported a tool
as unavailable would advance the task anyway and carry the non-answer down the chain. The two
interactive entry points (`generatePreConfigTaskResultSecondGen`) keep tool search.

**Prefixed tool families are namespaced BEFORE the keyword rules.** `getToolSearchNamespaceName`'s
keyword tests used to run first, and `talk_to_assistant_*` / `external_tool_*` / `mcp_*` names are
built out of user-authored project and assistant names — so `/assistant/` swallowed every delegation
tool into `assistant_settings` ("Manage assistant settings, memory, heartbeat behavior, skills, and
thread context"), a delegate in a project called _MediAgents_ matched `/media/` and landed in
`chats_and_media`, and the `integrations` namespace was unreachable dead code. Advertising a
delegation tool under "assistant settings" is exactly what makes tool search miss it, and the
overflow also pushed the real settings tools into an `assistant_settings_2` chunk. The prefix test
now runs first.

**MCP tools are grouped by app, and only what a run needs reaches the model (`Assistant/mcpAppGroups.js`).**
`getReachableMcpTools` used to keep the first 60 tools of all MCP servers together and drop the rest
silently. alldone.team/mcp serves Story Builder (66 tools), Judy (50) and Property Screener (17) over
one connection, ~40k tokens of schemas, so Judy and Property never reached the assistant. Each tool now
carries its app: a server may name it in `_meta['team.alldone/app'] = { id, name, summary }`, and a tool
without it belongs to its server. With hosted tool search every app is a namespace of its own
(`mcp_judy_job`, described by the app's summary) instead of all MCP tools sharing `integrations`. Without
tool search (OpenRouter models, unattended runs) a server with up to `MCP_DIRECT_TOOL_LIMIT` (30) tools is
still sent whole; above that the model only gets `open_mcp_app`, which lists the apps, and opening one
adds its tools from the next step of the same run on (`openedMcpAppKeys` on the run's tool runtime
context). `open_mcp_app` is allowed by the `mcp_servers` toggle. The dynamic tool cache stores the apps
next to the schemas (`mcpApps`); an entry without them is rebuilt. Pinned by
`Assistant/mcpAppGroups.test.js` and the `MCP tools grouped by app` block of `assistantHelper.test.js`.

**MCP Apps views appear under the assistant's answer (`MCP/mcpAppViews.js`, `McpAppViews.js`).**
A tool may declare a view (`_meta.ui.resourceUri = 'ui://…'`, MCP Apps / SEP-1865); alldone.team's
`judy_show` does. When a run calls such a tool, the executor records `mcpAppViews/{viewId}` (server-written,
readable only by `userId`, the person the run acted for) under `assistantCommentId`. A view is NEVER
shown inline in the chat: below that comment (`MessageItemBody`, `CommentsList`) there is only a
one-line card, and the view opens in Anna's right pane or, outside the assistant shell, in a window
that fills the screen apart from a slim header (`McpAppModal`, mounted with the global modals,
`mcpAppModalStore`). The frame gets the server's HTML in
`srcdoc` with `sandbox` WITHOUT `allow-same-origin`, so it runs on an opaque origin and can reach
neither the app's storage nor its session; its own CSP from `_meta.ui.csp` is put first in `<head>`
(`mcpAppHost.js`), and the app page's CSP applies on top. That is why no separate sandbox domain is
needed, unlike artifacts, whose bytes are served from a URL. The frame never holds a token: its
`tools/call` and the resource itself go through `mcpAppSecondGen` with the view id, which re-checks
the person, current project membership, that the server is still on the assistant, and that the tool
lets the app call it (`visibility` includes `app`); the call uses the same `resolveMcpSecret` as the
run, so a view can do no more than that person's own assistant. A tool whose `visibility` leaves out
`model` (e.g. `judy_view_get`) is never offered to or run for the model. The view always runs in
fullscreen display mode and fills its container. In Anna's assistant shell the view opens in the RIGHT PANE (`AnnaAppPaneContext`, surface `app:<viewId>` in `AnnaShell`, listed in the workspace picker),
and the chat keeps a one-line card that reopens it. A view recorded in the last two minutes opens by
itself once (on a phone without leaving the chat); an older one, met by scrolling back, only offers
to; the same rule opens the embed window outside the shell. Pane views stay mounted while hidden, up
to five, so switching panes keeps their state. Three rules came from one run on 2026-11-03 that left
Judy closed with two cards under the answer. **The cards are watched while the answer is still
being written** (`MessageItemBody` renders `McpAppViews` outside its loading branch, one element
in both states): the freshness clock starts at the tool call, and the run kept working for five
minutes, so cards that mounted only once the answer was done found every view stale. **One card and
one pane per app** (`mcpAppKey`: same server, same `ui://` resource): `judy_show` ran twice in that
run and each call records its own view; the newest supersedes the others. **An open app view is
protected like a VM view**: the reveal of a saved object waits, `show_workspace` becomes the
"would like to show you" notice, and the browser is not followed. In that run the assistant created
a task to track its own work and showed it, which would have replaced Judy two minutes after it
opened. A view's own "Show in chat" button sends `ui/request-display-mode` with `inline`; the host
answers `fullscreen` and closes the pane (Alldone shows again) or the embed window. Pinned by
`MCP/mcpAppViews.test.js`,
`mcpAppHost.test.js`, the view-only case in `assistantHelper.test.js` and the `MCP Apps views` block
of the rules emulator suite.

**Both embed windows hand their app to that pane (AT-2951).** The windows (`IframeModal` for
pre-configured iframe tasks such as the alldone.team tool pages, and `McpAppModal`) are mounted
with the global modals in `AppContent`, outside `AnnaShell`'s tree, so no context reaches them:
`AnnaShell` registers its `openAppView` and whether assistant mode is open in
`components/Anna/annaAppPaneBridge.js`. Each window's header starts with the top bar's
assistant-mode icon (`OpenInAssistantPaneButton`), which switches to split mode with the app in the
right pane; and a window opened while assistant mode is on never paints at all, it hands the app
over in a layout effect (so does an MCP card in a chat inside the Alldone workspace). An iframe app
is a pane view `{ kind: 'iframe', viewId: 'iframe:<url>', url, appName }` rendered by
`EmbeddedAppFrame`, the frame and postMessage protocol (user data, alldone.team token, Gold,
roadmap) extracted from `IframeModal` so both hosts speak it identically. Moving an app reloads its
frame: a live session inside it (screen share, unsaved state in the third-party page) does not move
with it. The way back goes through the same bridge: leaving assistant mode (the chat's X, the top
bar or sidebar toggle, browser Back) while an app is on screen in the pane reopens it in its window
(`registerEmbedWindow('iframe' | 'mcp')`, `openInEmbedWindow`) and closes the pane's copy, so it
never runs twice. Only the pane's selected app comes back, from chat-only mode too, where the pane
is merely hidden (product decision): not with Alldone selected, not an app only listed in the
picker, and not through the Home button (which means the task list) or choosing Alldone in the
phone's picker (which leaves assistant mode by design). The shell hands back from a layout effect
declared after its bridge registration, so the window already sees assistant mode as off and does
not send the app straight back. Pinned by `IframeModal/embedWindowAssistantPane.test.js` and the
two AT-2951 blocks of `AnnaShell.test.js`.

**Both embed windows share one layout and close on a backdrop click (AT-2953).**
`IframeModal/embedWindowLayout.js` makes `IframeModal` and `McpAppModal` the same card: the viewport
minus one uniform `MODAL_EDGE_GAP` (16px) on every edge, applied as the safe-area overlay minimum
(`max(gap, inset)`). There is no percentage and no max size, so no extra margin on big screens.
Below `MODAL_SHEET_BREAKPOINT` the gap is 0 and the window is full screen. A click on the backdrop
closes the window, by product decision, although a live session in the app (screen share) goes with
it. `useBackdropDismiss` counts only a press that both starts and ends on the backdrop. This
excludes a drag out of the card and the click that opened the window (its pointerdown predates the
backdrop). Clicks inside the cross-origin frame never reach the document. Phones have no backdrop
dismissal: the only uncovered strips there are the safe-area insets. Pinned by
`IframeModal/embedWindowLayout.test.js`.

**A view outlives the connection it opened with, and is reconnected only on a click (AT-2952).**
"This app is no longer connected to the assistant." meant exactly that: on 2026-11-03 the user had
removed alldone.team from Anna's MCP servers in the morning, and the Judy pane reopened that
afternoon pointed at a server id the assistant no longer had. It was not a session expiry. A view now
keeps its server's non-secret address (`serverUrl`, `serverTransport`, `serverAuthType`) and finds
its server by id, then by that address with the same sign-in on the SAME assistant (a server removed
and added again gets a new id), then, for views recorded before the address was kept, by the only
server with the same label (and stores the address it learnt). When the assistant no longer has it,
`mcpAppSecondGen` fails with `details.reason: 'server_disconnected'` and the pane shows
"Connect again", which calls `action: 'reconnect'`: an ordinary `connectAssistantMcpServer` under
the view's original id, by somebody allowed to edit the assistant, validated by listing tools as that
person, idempotent if the server is already back. It is offered only for servers that need no stored
secret (`none`, `alldone_app`); bearer/OAuth servers and views with no known address point to the MCP
settings. Never reconnect without the click: removing a server is a deliberate choice. Pinned by the
AT-2952 blocks of `MCP/mcpAppViews.test.js` and `McpAppViews.test.js`.

**`generatePreConfigTaskResult` reads run options from its 13th parameter, never from `taskMetadata`
(the 10th).** The two bags look interchangeable at a call site and one of them is silently ignored:
`assistantRecurringTasks` had been passing `maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS`
(25 min) in the metadata bag, so every scheduled run in production reported the 55-minute interactive
default while `checkRecurringAssistantTasks` is deployed with `SCHEDULED_FUNCTION_TIMEOUT_SECONDS`,
sized for 25. The run's own guardrail could therefore never fire first — and per the note in
`assistantRunLimits.js` a scheduled run past the Cloud Scheduler attempt deadline is not truncated,
it gets a **second concurrent invocation of the same function**. `warnAboutMisplacedRunOptions` now
names the mistake at runtime instead of swallowing it. Pinned by the tool-search blocks in
`functions/Assistant/assistantHelper.test.js` and
`functions/Assistant/assistantPreConfigTaskTopic.test.js`.

### A callable acts as `request.auth.uid`, never as an id from `request.data` (security audit 2026-11)

Functions run with the Admin SDK, so the Firestore rules do not protect anything a callable or
`onRequest` handler touches. Every callable must take its acting user from `request.auth.uid`,
check `assertProjectAccess` / `assertObjectAccess` before reading or writing project data, and
load trusted settings (webhook URLs and credentials, assistants, audiences) from stored documents
instead of the request. The 2026-11 audit (reports under `~/security-audit-skill/alldone_app/run-1/`,
not in the repo) found many callables that skip this. The first fixes:

- The guide welcome-message callables are bound to the signed-in member through
  `functions/Assistant/welcomeMessageAccess.js`, and run with no tools and no user context.
- `executeWebhookForMessage` needs a signed-in caller who can read the task. The webhook URL must be
  public (`webhookDestination.js`, redirects refused). Each webhook gets a per-request callback
  secret inside its `callbackUrl`, and `webhookCallbackForAssistantTasks` settles only
  `kind: 'webhook_task'` records with a matching secret (see `functions/Assistant/WEBHOOK_TASKS_README.md`).
- OAuth callback pages render only through `functions/Utils/oauthCallbackPage.js` (script-safe JSON,
  HTML escaping, nonce CSP), because hosting serves them on the app origin.
- `sanityCheckSecondGen`, `getLinkPreviewDataSecondGen` and `backfillLastLogin` were removed.
  `increaseVersionSecondGen` needs the administrator's Firebase ID token (`Authorization: Bearer …`, POST).
- The Mollie subscription callables act on `request.auth.uid`'s subscription only
  (`functions/Payment/subscriptionAccess.js`); a different `userPayingId` is refused. Seat lists are
  checked against the stored subscription, a seat holder may only remove their own seat, and
  `createCompanySubscriptionSecondGen` reuses the stored Mollie customer, never one from the request.
  The billing fields of `subscriptions/{uid}` and `users/{uid}.customerId` are server-owned in
  `firestore.rules` (the app may edit `companyData`, `selectedUserIds`, `showSuccessfullyPayment`).
  The generic `updateMollieSubscription` callable was removed.
- `linkStripeAccount` links the caller's verified login email (`getVerifiedAccountEmail`) directly and
  never returns the Stripe customer id. Any other address (or an unverified login email) needs a
  six-digit code mailed to it (AT-2978, `functions/Premium/stripeLinkCode.js`): the first call mails it
  and answers `codeRequired`, the second call carries `code`. Only a hash is stored, in
  `stripeLinkCodes/{uid}` (no client rule), bound to the user and the address, 15 minutes, five wrong
  entries, at most one request a minute and five an hour. The mail goes out only when Stripe has a
  customer with that address, and the answer is the same either way. `checkPremiumStatusById` still finds customers by `users/{uid}.email` (the token email,
  which may be unverified); moving it to the verified email is open.
- The guide welcome-message runs are platform-paid on purpose and therefore run once: the group
  welcome once per guide, the personal welcome once per guide and member
  (`assistantWelcomeMessageClaims`, server-only), only in a guide, with the guide name read from the
  stored template.

- `copyTemplateObjectsSecondGen` derives everything through `Templates/templateCopyAccess.js`: the
  template must be a template the caller can read (`isTemplate`, member or not private), the
  copied creator is its stored `templateCreatorId`, and the guide must name it as `parentTemplateId`
  and have the caller as a member (the join flow adds the user and links the guide before it calls).
  A copy carries only what the template creator can see. `onCopyProjectSecondGen` needs a member of
  the source project, the copy belongs to the caller (`CopyProject/copyProjectAccess.js`, the
  request's `user` is ignored), and an object's note is copied only when shared with the project.
- Feed state (`GlobalState/globalState.js`) is process-wide unless the code runs inside
  `runWithFeedsState`, which gives the invocation its own store across awaits. A gen2 function serves
  up to 80 requests per process, so concurrent guide copies read each other's feed creator and
  members and followed each other's guides. The template copy runs inside it. Any other callable that
  loads feed state and reads it again after an await has the same race and should be wrapped too.

Pinned by `welcomeMessageAccess.test.js`, `webhookSecurity.test.js`, `functions/Utils/oauthCallbackPage.test.js`,
`templateCopyAccess.test.js`, `templateObjectVisibility.test.js`, `copyProjectAccess.test.js`,
`copyObjectNotesVisibility.test.js` and `GlobalState/globalState.test.js`.

- Second pass: each callable resolves its request through a guard module that takes the user from
  `request.auth`, checks membership/object access and derives the rest. `generateBotDailyTopicCommentSecondGen`
  only runs the caller's own `BotChat<date><uid>` recap and formats the prompt dates itself
  (`dailyTopicAccess.js`). `onRemoveWorkstreamSecondGen` needs a member and an existing `ws@` stream
  (`workstreamRemovalAccess.js`). `createApiEmailTasksSecondGen` writes only the caller's own inbox task,
  for an address stored on their connection (`apis/emailTasksAccess.js`). `sendUserJoinsToGuideEmailSecondGen`
  reports the caller to the template creator and the administrator, read from Firestore, in escaped
  HTML (`Templates/guideJoinEmail.js`). `addContactToBrevoMarketingList` subscribes only the token's
  verified email. `sendPushNotificationSecondGen` now takes `{ projectId, objectType, objectId }`
  (projects, users or tasks). Its recipients must follow that object, and the names, link and type come
  from stored data. Only the caller's update line survives (`pushNotificationAccess.js`). A global
  catalog assistant may only be changed by the administrator: use `assertAssistantProjectAccess(..., { forWrite: true })`
  for any callable that writes one (`assistantProjectAccess.js`). `addCalendarEventsToTasksSecondGen`
  was removed (no caller).

Pinned by the test next to each guard module above and `functions/Utils/callableIdentityBindings.test.js`,
which checks the wiring in `index.js`. The payment callables are pinned by
`functions/Payment/subscriptionAccess.test.js` and `functions/Premium/linkStripeAccount.test.js`.

**Membership is `projects/{pid}.userIds`, on every Admin SDK path.** The arrays on `users/{uid}`
(`projectIds`, `guideProjectIds`, `templateProjectIds`, `archivedProjectIds`) only nominate
candidate projects: the owner writes them, and until this fix the `invitation-remove` branch of the
membership-mutation rule let any account add an arbitrary project id to its own `projectIds` (that
branch, and `invitation-add`, may now only touch `invitedProjectIds`). `ProjectService.getUserProjects`
(the MCP tool gate and most assistant tool resolvers), `SearchService`, `TaskSearchService`, the
create_task fallback, the delegation and settings resolvers in `assistantHelper.js`, the voice
vocabulary scan and `UndoActionService` all drop a project whose `userIds` omits the user. Use
`isProjectMemberData` / `filterMemberProjectIds` from `shared/privacyAccess.js`; never treat
`userData.projectIds.includes(id)` as access. Entries written before the rule fix are removed by
`node migration/removeUnbackedUserProjectIds.js --firebase-project-id=<project>` (dry run; add
`--execute` to apply, `--user-id=<uid>` to scope; decision in `shared/userProjectMembershipCleanup.js`),
run after the rules deploy. Three more rules from the same audit:

- Undo records (`users/{uid}/undoActions`) are client-written and replayed with the Admin SDK, so
  `reverseAction` treats one as a request: per operation it requires membership, an object visible
  to the caller before AND after the write, a non-empty expected state, the `projectId` binding, and
  no access-projection fields, mirroring the object write rules.
- A manual project move only takes what the actor can read. `collectTaskTreeForMove` follows a
  `subtaskIds` entry only to a real child (`parentId`) and refuses a tree holding an unreadable task;
  a goal move unlinks (does not move) goal tasks the actor cannot read; a goal's or task's linked
  note the actor cannot read is left behind and unlinked.
- Caller-supplied recipients (`followerIds`, `userIdsToNotify` on `askToBotSecondGen` and
  `generatePreConfigTaskResultSecondGen`) are narrowed by `Assistant/assistantNotificationAudience.js`
  to project members who can read the thread's parent, the same audience the comment rules allow.
  The menubar note push acts on a note id only when `menubarUserCanAccessNote` says the token user
  may read it.

Pinned by `ProjectService.test.js`, `SearchService.test.js`, `UndoActionService.test.js`,
`projectMoveAccess.test.js`, `menubarPushNoteAccess.test.js`, `assistantNotificationAudience.test.js`
and the invitation cases in the rules emulator suite.

**A Firestore trigger has no `request.auth`, so a field it acts on as a user must be bound to its
writer in `firestore.rules`.** The audit found triggers spending Gold, reading private goals and
routing rules, and running assistants with tools as whoever a member wrote into a document. The
rules now bind each such field when it is written (present on create, changed on update), and the
server reads only the bound value:

- Project routing acts as `creatorId`; a client may stamp a pending `projectRouting` only as itself.
- Goal routing acts only for a created task whose `creatorId === lastEditorId`; a client may create
  such a routable top-level task only as itself. A copy by somebody else is not goal-routed.
- An assistant workflow task (`workflowTask`) is paid for by `workflowPayerUserId`, which the mover
  must stamp with their own uid whenever they move it into a step (`buildWorkflowPayerStamp`); there
  is no `creatorId` fallback. A user's own workflow is paid for by its owner, and a transition
  comment (`workflowAiPromptOverride`) runs there only when the owner wrote it (`requestedByUserId`)
  in that same transition. The payer must be in `projects/{id}.userIds` at enqueue and at dispatch.
- Calendar routing feedback markers must carry the writer as `requestedByUserId`.
- Recurring assistant tasks: each user may add or change only their own activation entry, point it
  only at a project they belong to, and name only themselves as activator or creator. The global
  catalog (`assistantTasks/globalProject`) is created, deleted and re-prompted by the administrator.
  A co-member may still edit a project task's prompt after others activated it; pausing their
  activations until they re-confirm is an open product decision.
- Copies keep the original creator but are re-attributed by `bindCopiedTaskIdentityFieldsToWriter`
  (`utils/backends/Tasks/taskIdentityFields.js`) before they are written, or the rules refuse them.

Connection project keys (`apisConnected`, `calendarConnections`, `emailConnections`) are owner-written
too, so the calendar sync and email-line task creation check `projects/{id}.userIds` before writing,
and `googleOAuthInitiate` checks project access like its Microsoft sibling. A wiki whose payer left
the project stops with `owner_not_member` before any model call and waits for a member to take it
over in its settings. Pinned by the `task identity fields` and `recurring assistant task activation`
blocks of the rules emulator suite and the `security audit 2026-11` cases next to each trigger.

The assistant-side fixes of the same audit follow one rule: a value a member can write from the
client is never trusted by an Admin SDK path that acts for somebody else.

- A stored MCP credential is bound to the URL it was validated against (`boundUrl` on the
  `mcpSecrets` document, `mcpAssistantConnect.js`). The URL itself stays member-writable on the
  assistant document, so `resolveMcpSecret` needs the `serverUrl` it will call and returns nothing
  for any other address; an `alldone_app` token only ever goes to alldone.team. A secret without
  `boundUrl` is refused (reconnect), never bound on first use; the existing ones are bound once by
  `migration/bindMcpCredentialsToServerUrl.js` (dry run by default, review its list, then `--execute`).
- `update_assistant_settings` and `update_heartbeat_settings` write `assistants/globalProject/*`
  only for the administrator (`globalAssistantWriteAccess.js`), including when the caller is merely
  chatting with a global assistant.
- A skill file is mounted into a VM only from its own prefix, `assistantSkills/{owner}/{skillId}/`
  (`isOwnSkillStoragePath`), because `files[].storagePath` is client-written.
- The Gmail post-label run reads third-party email unattended, so it gets only
  `GMAIL_POST_LABEL_SAFE_TOOLS` (`functions/Gmail/gmailPostLabelTools.js`), intersected with the
  assistant's own list.
- A browser run belongs to the member who started it: another member's call in the same thread is
  refused (`run_owned_by_other_user`), and only the run's own member can answer or spend its approvals.
- `writeKnowledgePage` reads every source it cites for the first time again inside its transaction
  (`findWithdrawnKnowledgeSourceKeys`) and refuses the write if one is gone or no longer visible.
- Anna inbound email stores attachments under `anna-email-inbound/{userId}/{uuid}/` (create-only) and
  keys dedup and audit records by account plus a hash of the sender-chosen Message-ID
  (`inboundEmailRecordId.js`).

Pinned by `mcpSecretUrlBinding.test.js`, the `global assistant catalog` block of
`assistantHelper.test.js`, `assistantSkillsMountScope.test.js`, the safe-tools case in
`serverSideGmailLabelingSync.test.js`, the co-member case in `browserSession.test.js`, the
withdrawn-source block of `knowledgePageStore.test.js` and the same-Message-ID block of
`emailIncomingHandler.test.js`.

- VM coding jobs (`vmRepoTokenBinding.js`): a member's GitHub/GitLab token is used only for the host,
  API base and repository recorded in that member's own `users/{uid}/private/{provider}Auth_{projectId}`
  when the connect callable validated it. A project repo URL that differs gives the job no token
  (`repoTokenMismatch`), the API base is derived from the token's host, the git credential helper is
  scoped to that origin (`GIT_CRED_ORIGIN`), and the base branch must be a plain branch name. The repo
  fields and `vmGolden` on the project doc are server-owned in `firestore.rules`; the golden itself
  lives in `vmGoldens/{projectId}` (see the golden VM template section).
- `vmLlmProxy` (`vmProxyModelBinding.js`): a platform-billed request may only reach the agents'
  inference endpoints (`PROXY_ALLOWED_ENDPOINTS`) on the route its token was minted for, and is billed
  at the job's rate or the requested model's rate, whichever is dearer (`premiumTokens`, also settled by
  the runner). An unpriceable model is refused. A new endpoint an agent CLI starts using shows up as a
  `rejected request to a non-inference endpoint` warning and has to be added to the list.

The VM path is pinned by `vmProxyModelBinding.test.js`, the `security audit 2026-11` blocks of
`vmJobRunner.test.js` / `vmGolden.test.js` and the rules emulator suite. These VM changes reach the
`vm-job-runner` Cloud Run image only when it is rebuilt.

The client-side findings of the same audit:

- An iframe task's address is member-writable data (a pre-configured task's `link`), so it never
  decides trust. `EmbeddedAppFrame` gives user data, the alldone.team token, Gold and the roadmap
  source only to an origin in `TRUSTED_EMBED_ORIGINS` (today `https://alldone.team`); any other page
  still renders and may only report `EMBED_LOCATION` / `APP_CONTEXT`. Add an origin to that list,
  never derive one. The global assistant's pre-configured tasks (`assistantTasks/globalProject/…`)
  are administrator-only in `firestore.rules`, except the per-user activation fields that
  `toggleRecurringTaskActivation` writes.
- A url embed's `open` attribute is shared note content. On mount it only opens the edit field of an
  empty link the viewer owns (`shouldOpenLinkEditorOnMount`); a pre-configured task, an iframe or a
  link in content runs only on a press, and a prompt the viewer did not write is shown to them first
  (`utils/preConfigTaskRunConfirmation.js`, used by `UrlWrapper` and `LinkTag`).
- Every notes collaboration connection carries `?auth=<Firebase ID token>&projectId=<projectId>`
  (`noteCollaborationProvider.js`; the room stays the bare note id, every socket, reconnects
  included, is opened with the current token, and the token is refreshed every 10 minutes so a
  long-lived socket reconnects with a current one). The collaboration server
  (alldone-notes-collab-server) asks `notesCollabAccess` (`functions/Notes/notesCollabAccess.js`,
  server to server, guarded by `NOTES_COLLAB_ACCESS_SECRET`) whether the user may read and write
  the note. It decides exactly like `storage.notes.rules`: member with access → read and write,
  member and no note document yet → read and write, non-member of a public project and a public
  note → read only. That missing-document allowance is safe only because the server keys its rooms
  by `projectId/noteId` in `NOTES_AUTH_MODE=enforce`; keep both halves in step. Throwaway virtual
  editors (`notesHelper`) no longer connect at all.
- The MCP OAuth login page names the app that started the authorization and the host it redirects
  to, from the stored `oauthAuthSessions` / `oauthClients` documents (`MCP/auth/oauthClientConsent.js`;
  known hosts such as claude.ai are named by us, not by the registration). `completeAuthorizationCallback`
  completes a pending authorization only with `consentApproved: true`, which only the page's
  "Allow and sign in" button sends, and records `consentGrantedAt` / `consentClientId`.

Pinned by `IframeModalUntrustedOrigin.test.js`, `UrlWrapperOpenAttribute.test.js`,
`noteCollaborationProvider.test.js`, `Notes/notesCollabAccess.test.js`, `oauthClientConsent.test.js`, `mcpOAuthConsentPage.test.js`,
`MCP/auth/cloudOAuth.test.js` and the global catalog block of the rules emulator suite.

### A callable that hosts an assistant run must be idempotent, because the browser will replay it

A callable is not idempotent by itself, and an assistant prompt run — tens of seconds of wall clock —
is exactly the request whose response a client loses. The reproducer is a laptop lid: a
`generatePreConfigTaskResultSecondGen` POST went out at 11:33:06, `pmset` recorded
`Entering Sleep state due to 'Clamshell Sleep'` at 11:33:22, the server finished the run at 11:33:36
into a socket that was asleep, and at 11:37:41 — the same second as the wake — **Chrome
retransmitted the identical request**. One user action, two answers in the thread and two 22-Gold
charges. Nothing failed anywhere: both invocations logged success, and the only tells were the
byte-identical `requestSize`, the **missing CORS preflight** on the second POST (a resumed fetch does
not redo one, while every browser-initiated callable in the logs is preceded by an `OPTIONS`) and the
fact that only **one** user comment exists — every JS path to that callable writes the comment before
calling it, so the app demonstrably never ran that code twice.

`askToBotSecondGen` had been guarded against this since the run-lock work; the pre-configured prompt
path had not, although it receives the same client-generated `messageId` and already passes it down
as `triggerMessageId`. Both now take `acquireAssistantRunLock` on
`{projectId, objectType, objectId, messageId}` and settle it on **both** paths — a lock left
`running` holds the coarse `assistantTaskRunLocks` slot for its 65-minute lease, which blocks
workflow AI steps on that task and makes a legitimate retry look like a duplicate. **Add the lock
when a new entry point starts hosting a prompt run**; `assistantRunIdempotencyHosts.test.js`
ratchets it over the `index.js` source, the way `assistantRunLimits.test.js` does for timeouts.

Two details are load-bearing. The lock is completed **before** `completeOnDemandAssistantTaskAfterRun`,
so a crash between them leaves a settled lock rather than a running one — and the duplicate branch
then reconciles the task completion itself (it is idempotent, `alreadyCompleted`) instead of leaving
the task open. And a duplicate reports **no completion outcome of its own** while the original run is
still going, so the client must not fall back to `moveTasksFromOpen`: `generateTaskFromPreConfig`
treats `duplicate: true` as "another invocation owns this task", which is a third meaning alongside
the contract's existing "server succeeded" and "no outcome reported". A request carrying no
`messageId` (an empty prompt) acquires nothing and behaves exactly as before.

### A user message is answered only if the sender's page gets its request out, so the server checks (AT-2848)

The replay above is one way a callable goes wrong; the opposite is the request that never leaves.
`createObjectMessage` stores the comment and then calls `askToBotSecondGen` **without awaiting it**,
and nothing on the server reacted to a user comment. When the page went away in between, the comment
was saved and never answered, with no error anywhere. Reproducer (2026-10-25, Android app): a topic
from the assistant line, the `askToBot` CORS preflight logged at 19:29:55 UTC, 8.3s spent
cold-starting (no warm instances since the cost review), and the page freshly loaded around 19:30
(the boot batch of email-line, calendar-sync and Typesense calls repeats). The POST was never
received. A missing POST
after an `OPTIONS` 204 from the same `remoteIp` is the tell.

`functions/Assistant/assistantMissedRunCatchUp.js` closes it with **evidence, not guesswork**. The
client records the run it is about to start on the comment (`assistantRunRequest: {projectId,
objectType, objectId, assistantId}`, written in the comment's own batch, so it is exactly as durable
as the message). Anna's workspace sets it through `submission.requestsAssistantRun` because it starts
its run itself. `onCreateObjectCommentSecondGen` schedules a check `MISSED_RUN_GRACE_SECONDS` (90s)
later on the **existing** `runAssistantCommentReply` queue (`kind: 'missed_user_run'`, deterministic
task id), so no new function and no IAM grant was needed. The check reads the per-message run lock
first: the client's run takes it before anything else, so an existing lock in **any** state ends the
check after one read, which is the outcome for nearly every message. Only a missing lock goes on to
run `askToOpenAIBot` for the comment's author on the heartbeat 25-minute budget, with
`retryFailed: false`. A client request that arrives later meets that lock and returns `duplicate`.

What keeps it from answering twice or answering the wrong thing: the request must name the comment's
**current** location, so a comment copied with its thread into another project or object does not get
a second answer at its new address. A thread that has **any newer comment** is skipped, since that
message's run (or its own catch-up) carries this one in its history. The assistant switched off
(`isAssistantEnabled === false`), a webhook task, a deleted comment or thread, failing the callable's
own `assertObjectAccess`, or a comment older than 24h all skip without taking the lock. Server-written
user turns (WhatsApp daily topic, VM host requests, workflow step prompts) never carry the field, so
they are untouched by construction. Clients older than this change write no field and keep the old
behaviour. Pinned by `functions/Assistant/assistantMissedRunCatchUp.test.js` (including the
`index.js` wiring) and the `recording the assistant run a comment expects` block of
`utils/backends/Chats/chatsComments.outbox.test.js`. `generatePreConfigTaskResultSecondGen` has no
catch-up: its requests carry task-completion semantics a server rerun would have to reproduce.

### One assistant turn at a time per thread (AT-2922)

A message that asks the assistant for an answer is **held on this device** while the previous
answer in the same thread is still being produced, and is written into the thread only once that
answer is complete, so the history always reads question, answer, question, answer. Before this,
the comment outbox already stored messages in order, but every send started its own `askToBot` at
once: two runs worked in parallel, the second never saw the first answer, and the answers could
land in either order. "Complete" includes every tool round **and a VM job the answer started in
that thread** (product decision: the next message waits for the VM too). Other conversations are
never blocked, and a message that does not ask the assistant (assistant off, webhook task) is
never held.

`utils/backends/Chats/threadRunGate.js` decides "still processing" from three signals, because
each covers a gap the others cannot see: runs this tab started (`beginThreadRun`/`settleThreadRun`,
the cold-start seconds before the server creates its comment); a comment in the thread that is
still being written (a chat run's `assistantRun.status`, a VM status comment while queued,
running, `awaiting_user` or `cancel_requested`, found by two small listeners that exist only
while something waits), which is what makes other tabs, devices and members count; and a newest
user comment carrying `assistantRunRequest` with no answer after it yet (the cold start of a run
another device started). Every signal **expires** (local run 65 min, chat run 70 min, VM run 6 h,
VM question 25 h after its last change; a pending request after 150 s; a missing snapshot after
4 s), so a crashed run delays a message but cannot strand it, and the user can always **send a
queued message now or remove it** from the bubble. A failed or stopped answer releases the queue.

Where it is enforced: in the comment outbox, inside `sendObjectMessage`, after the parent read
decided that the message triggers a run and **before anything is written** (the outbox pauses its
30 s delivery timeout through `hold` while it waits, and a message that really waited is prepared
again from scratch). The released message is dated `max(now, newest comment + 1)`, because the
answer it waited for was timestamped by the server's clock. Anna starts its runs itself, so
`useAnnaMessageSends` waits on the same gate before persisting and passes `threadGateCleared`.
While waiting the outbox entry has `status: 'queued'`; `useGetMessages` sorts queued entries after
everything saved, and `MessageSendStatus` renders "Queued" plus Send now / Remove. In Anna that note
sits on its own line under the author row (`prominent`, AT-2927), outside the queued message's
fade: inline, a react-native-web `View` keeps `flex-shrink: 0`, so the status ran past the
bubble, squeezed "You" to 0px and hid both actions (`browser-tests/at2927` measures it). In the
task/topic chat (`MessageItem`) the fade goes on the header + content, never on the swipe row:
that row's opaque background is what hides the green "Quote" swipe layer underneath it, and a
translucent row let the layer show through over the avatar and name (AT-2963,
`MessageItemQueuedLayout.test.js`). A failed
delivery drops `threadGateCleared`/`forceSend`, so a retry waits for its turn again. Out of scope:
WhatsApp (its inbound queue is already serial per user), voice calls and pre-configured prompt
buttons (their runs still hold chat messages in the thread). Known limit: a VM job hosted in a
**different** thread (a contextless dispatch creates its own task) is not visible to the
conversation that started it. Pinned by `threadRunGate.test.js`, the `one assistant turn at a time
per thread` block of `chatsComments.outbox.test.js`, the AT-2922 cases in `commentOutbox.test.js`,
`AnnaConversation.test.js`, `MessageSendStatus.test.js` and `useGetMessages.pending.test.js`.

### A thread can pin its own assistant model (AT-2502)

**The model lives on the THREAD's own document, next to the assistant that answers there.**
`assistantId` and `isAssistantEnabled` already describe one thread and already live on its host
document — the task doc for a task thread, `chatObjects/{projectId}/chats/{id}` for a topic, the
note/goal/contact/skill/user doc for those — so `assistantModelOverride` joins them there rather
than in a new collection. Nothing new to authorize (whoever may change a thread's assistant may
change its model), no rules change, no index. Both sides address that document through the **same**
`getObjectDocPath` in `functions/shared/privacyAccess.js` — the client to write it, Cloud Functions
to read it — because a writer and a reader that each carry their own objectType→path map is how a
pin gets stored somewhere nothing looks. `functions/Assistant/threadAssistantModel.js` is the
dependency-light shared module (validation, picker options, precedence) and is imported by both.

**It is resolved on the SERVER, because the interactive chat path has no model to forge.**
`askToBotSecondGen` receives no model at all — it never did — so `assistantNormalTalk_optimized`
reads the pin alongside the user and the assistant in the existing `Promise.all` (no extra wall
clock) and resolves the effective model there. **Never assign it back onto the assistant object**:
`getAssistantForChat` returns a module-level cache entry keyed on (projectId, assistantId), shared
by every thread a warm instance serves, so `assistant.model = …` leaks one conversation's pin into
the next conversation — a wrong model and a wrong Gold rate, vanishing whenever the instance
recycles. `threadAssistantModelCallSites.test.js` ratchets both that and the read itself, because
neither failure reports anything.

**Precedence is: the model chosen for the WORK, then the thread, then the assistant.** A
pre-configured task carrying its own `aiModelOverride` was configured for that model deliberately,
and the thread it happens to run in must not re-point it. That ordering is applied twice, and the
split is deliberate: server-side in `getTaskOrAssistantSettings`, and client-side in
`resolvePreConfigAiSettings` — the prompt path sends complete `aiSettings` and by the time they
reach `generatePreConfigTaskResult` "configured for this model" and "the assistant's default was
filled in" are the same string, so the client is the last place that can still tell them apart.
Deliberately **not** applied to unattended runs (heartbeats, recurring tasks, workflow AI steps).

**A stored model key is validated on every read, never trusted.** The `featureModelPreferences`
lesson with teeth: an unknown key makes `getModel` answer `gpt-5.6-sol` while `getTokensPerGold`
answers `undefined`, which `calculateGoldCostFromTokens` turns into a charge of **zero** — so a
thread pinned to a model that is later retired would run free, forever, silently. An override that
is not currently in `SELECTABLE_ASSISTANT_MODELS` is treated as absent. Clearing deletes the field
rather than writing null, and the write carries no edition data (a settings choice is not content —
stamping `lastEditionDate` would re-download the note on every other open client, AT-2340).

**Assistant threads are excluded on purpose.** An assistant's own board is the one thread where "the
thread's model" and "the assistant's model" are the same question, and the two sides disagree about
which document an assistant even is (the app stores assistants as user docs, `getObjectDocPath` maps
them to the assistants collection), so a pin there would be written and never read back.

UI is one row in the existing assistant popup (`BotOptionsModal`, reached from all four buttons) plus
a dot on the assistant avatar. The badge costs one document read, so it is **opt-in**:
`DvBotButton` is both the detail-view header avatar and the task-list row button, and the list must
never badge — that would be one read per visible task. `threadAssistantModelState.js` holds the one
cache the row, the picker and the badge share; it is deliberately not redux, since a slice keyed by
object id re-renders every subscriber on every write (AT-2336) for state that concerns one thread.

### The project wiki is compiled only from what the whole project can see

`knowledgeBases/{projectId}` holds a Karpathy-style wiki per project: Markdown pages a model compiles
from the project's tasks, goals, notes, contacts, comment threads and artifacts (`functions/KnowledgeBase/`, read UI in
`components/WikiView/`). Members may read the whole tree straight from Firestore and nobody may
write it; every write is a callable or the `runKnowledgeBaseIngest` worker. The member who switches
it on pays (`knowledge_base_ingest` Gold, monthly cap, default model DeepSeek V4 Flash).

**It is on by default for every project of an active user, and a run spends nothing on a payer who
is away.** "Active" is the heartbeat rule (a login within `ACTIVE_USER_WINDOW_MS`, 30 days), imported
through `knowledgeBaseSchedule.js` rather than re-declared. `knowledgeBaseDefaults.js` writes the
default as a real document (`enabledBy: 'default'`, first run at the payer's next 03:00) for a
project that has **no** `knowledgeBases/{projectId}` document at all; an existing document is a
decision and is never switched back on. Three callers reach it: `onCreateProject`, the user trigger
when somebody logs in after 30 days away, and the daily `applyKnowledgeBaseDefaults` sweep, which is
also what reached the projects that existed before the default — there is no migration. The payer
is the project's creator when they are an active member, otherwise the member being processed.
Guides (`parentTemplateId`) and templates are excluded on purpose: a guide's `creatorId` is the
template's author, who would otherwise pay for the wiki of every guide anybody starts. **Archived
projects get the wiki too (AT-2893)**: archiving (`users/{uid}.archivedProjectIds`, per member) means
"done with this project", not "forget what we learned in it", and the wiki is what keeps a past
project's knowledge usable in search, `read_knowledge_page`/`search_knowledge` and global search
(which includes archived projects by default, AT-2524). An archived project is built and kept current
by the same nightly run, with the same payer rules and the same 500-Gold monthly cap; once caught up
it costs no Gold, because a run that finds no changed source makes no model call. The sweep orders a
member's archived projects after the active ones, so `MAX_PROJECTS_PER_USER` cuts past projects
first. (`project.active === false` is a different, project-wide flag — no member opened it in 30
days — and stays excluded.) Until AT-2893 a member who archived a project neither switched its wiki on
nor paid for it, and a run stopped with `project_archived` and cleared `nextRunAt`. No run writes that
reason any more; `isKnowledgeBasePausedForArchivedProject` only recognises the leftover state, which
the sweep and a save in the settings resume like `owner_inactive`. When the
payer has been away 30 days the run stops with `owner_inactive` and clears `nextRunAt` (paused, no
model call); the payer's return resumes it, and a wiki the default switched on moves to another
active member once its payer is gone. A wiki a member switched on themselves (`enabledBy: 'member'`,
or no field on wikis that predate the default) never changes hands that way — it waits. Note
`releaseIngestLease` must not `Math.min` a null `nextRunAt` (it is `0`, i.e. due forever). Pinned by
`knowledgeBaseDefaults.test.js` and the `owner_inactive` and archived-project cases in
`knowledgeBaseIngest.test.js`.

**A wiki that reaches its monthly Gold limit says so, and raising the limit resumes it.** The run
stops with `monthly_cap` and schedules itself for the first of next month (UTC); before this, that
was visible only on the wiki document, and two production wikis stood still unnoticed on their
first build. `knowledgeBaseCapNotice.js` now has the project's assistant open a topic of its own
(`WikiGoldCap_<projectId>_<month>`, private to the payer, unread badge, MyDay assistant line) with a
link to `/project/<id>/wiki-settings`. The message is fixed text in the payer's language, not a
model answer: a notice that the Gold ran out must not spend Gold. It is sent once per wiki, month
and limit (the comment id carries the limit), and it never throws into the run. Raising the limit
above this month's spending in the settings sets `nextRunAt` to now and enqueues a run
(`cap_raised`); otherwise the notice would send people to a setting that changed nothing until the
1st. The wiki view and the settings show the pause too (`isKnowledgeBasePausedAtMonthlyCap`). A cap raised WHILE a run is going is not a pause yet, so that save resumes nothing: the run therefore re-reads the stored cap before it stops for it, and `releaseIngestLease` re-checks the stop against the cap stored at release and reschedules at once instead of pausing (AT-2880, a run that had read 5000 paused a wiki already raised to 10000 until the 1st). A wiki left paused at a cap already above its spending can be resumed by saving that same cap; the settings offer it.
Pinned by `knowledgeBaseCapNotice.test.js`, the monthly-cap cases in `knowledgeBaseIngest.test.js`
and `knowledgeBaseSettings.test.js`.

The wiki view is one column on every screen: the index (each page with its own "last updated"),
then a page in its place with a back link. The line above the index is the wiki's last run, not a
page's. "Give feedback" at the top of a page opens the same assistant topic the old footer link
"Suggest a correction" did (`WikiCorrectionForm`); the assistant applies it with
`correct_knowledge_page`.

**The ingest runs through the Admin SDK, so the visibility filter is the ONLY protection.**
`isVisibleToWholeProject` in `collectKnowledgeSources.js` admits an object only when `isPublicFor`
names `0` and it is not `isPrivate` (goals without `isPublicFor` count as public, matching
`mapGoalData`); emails, generated day-rate tasks and user-memory notes are excluded outright, and
contact email addresses and phone numbers never reach a source card. `loadSourcesByKeys` re-applies
the same filter, because a key stored on a page is not proof the object is still public.

**A comment thread is exactly as visible as the object it belongs to, never as its chat object
says.** Threads are sources of their own (`[[chat:ID]]`, the chat object's id, which for a task,
note, goal, contact or artifact thread is that object's id). The delta finds them with one query on
`chatObjects/{projectId}/chats` by `lastEditionDate` (every new comment stamps it), then reads each
thread's object and filters it like a source: a private task's thread is never read, and the thread of
an email task or a time-log task is excluded with it. A chat object copies `isPublicFor` once at
creation and is not kept in step with its object, so trusting it would leak. A topic is its own
object. Threads of users, assistants and skills are not sources, nor are the wiki's own Gold notice
(`WikiGoldCap_…`) and comments still being written (`isLoading`/`isThinking`). A member's daily
WhatsApp (`BotChat…`), email (`BotChatEmail…`, and the "Daily emails …" topics of the Gmail
labeling, whose comments carry `gmailData`), heartbeat and menubar topics ARE sources by decision
(they are readable by the project anyway, and things worth knowing get discussed there); the ingest
prompt tells the model to keep only what concerns the project and nothing personal. Tasks created
from an email (`gmailData` naming a `messageId`/`messageIds`: Gmail labeling follow-ups, the email
line's "create task") and their threads ARE sources too since AT-2833, behind the same visibility
filter as every other task and nothing more; their card says "created from an email" and carries no
mailbox, address or link. Only the daily inbox counter (`isForEmail`, "Emails in inbox", an unread
count) stays out, as `email_inbox` (`isInboxSummaryEmailTask`). A delta card carries only the comments since the wiki last
looked (comments `created >=` the chats cursor), at most 40 and about 6,000 characters, newest kept;
a rebuild reads the latest ones. Two known limits: an edited comment does not stamp the chat object,
so an edit is only seen when the thread changes again, and an object made public again does not
bring its older comments back until somebody comments. **Artifacts** (`[[artifact:ID]]`) contribute
title, description and the text of the current entry file (`knowledgeArtifactText.js`: text kinds as
text, HTML as visible text, PDF/Word/PowerPoint/Excel through the upload extraction; images, audio
and video never, because transcription costs money on every edit). Withdrawal: an object's
update/delete trigger withdraws `type:ID` and `chat:ID` together, the artifact triggers do the same,
and `onUpdateChatSecondGen`/`onDeleteChatSecondGen` withdraw a topic made private and any deleted
thread. Pinned by the `comment threads and artifacts` blocks of `collectKnowledgeSources.test.js`
and `knowledgeSourceInvalidation.test.js`, `knowledgeArtifactText.test.js` and `components/WikiView/wikiLinks.test.js`.

**A withdrawn source must leave the stored data, not just the views.** When a cited object turns
private or is deleted, the object's existing update/delete trigger calls
`knowledgeSourceInvalidation.js`, which marks the citing pages `needsRebuild` (hidden from people
and assistants) AND deletes their title, summary, body and the source's label, and strips the text
from every revision that cited it (`redacted: true`) — found through `historicalSourceKeys`, since a
page can stop citing a source after an older revision repeated it. Hiding alone would leave the text
one Firestore read away. The rebuild then recompiles the page from its REMAINING sources without
ever showing the model the old text; `read_page` reads fresh and never returns a hidden page, not
even to the run rebuilding it. Only the page id (its slug) survives. Pinned by
`knowledgeSourceInvalidation.test.js` (the `removing what a withdrawn source contributed` block) and
the read_page cases in `knowledgeBaseIngest.test.js`.

**Assistants read it, and a member corrects it through them** (`knowledgeBaseAssistant.js`). The
index of visible pages goes into the system prompt right after the project description, and the
wiki tools have no Tools Access toggle, like `load_skill` — the wiki itself is the access control:
`read_knowledge_page` and `search_knowledge` for every member run, `correct_knowledge_page` and
`undo_knowledge_correction` for runs that may correct, plus the document and saved-knowledge tools
(`add/remove_knowledge_document`, `save/remove_knowledge_contribution`) once the wiki is on.
`resolveKnowledgeBaseAccess` decides per run, and the same answer drives the prompt, the offered
tools and the execution gate:

- **nothing** without an assistant and a requesting user who is a member of the project, nothing on
  the email channel (action-only, may reply outside the project) and nothing to Gmail labeling;
- **reading** everywhere else, and in writing mode;
- **correcting only when `allowKnowledgeCorrections` is set**, by the runs that answer a member
  whom the channel itself verified: the in-app chat (`assistantNormalTalk_optimized`), WhatsApp
  messages (`whatsAppAssistantBridge`) and in-app or WhatsApp voice calls (`assistantLiveBackend`,
  via `canCorrectKnowledgeBaseOnChannel`). A phone call over the public network is matched to an
  account by caller ID alone, which can be forged, so it only reads. A heartbeat, recurring task
  or delegated assistant is not a member saying "this is wrong". Neither is an **automatic comment reply**
  (`runAssistantCommentReply`, answering another assistant's comment such as a Gmail follow-up):
  `askToOpenAIBot` derives `allowKnowledgeCorrections` from `!runOptions.automaticCommentReply`, and
  `resolveKnowledgeBaseAccess` returns read-only for `automaticCommentReply` whatever the flag says
  (security audit NV-45).
- **MCP clients read and correct too** (Claude, Codex, any agent signed in to the Alldone MCP
  server through OAuth). They are the one caller with no assistant, so `resolveKnowledgeBaseAccess`
  answers them by `sourceChannel === 'mcp'`, which only the MCP server's own runtime context sets,
  and membership is still checked per call. Each wiki tool served there (read, search, correct,
  undo, save and remove saved knowledge) is a separate switch under Settings → MCP
  (`mcpDisabledTools`), so correcting can be switched off while reading stays on. Over MCP
  there is no page index in a prompt and no conversation project: `read_knowledge_page` without a
  slug lists the pages, `projectId` defaults to the user's default project, and
  `adaptToolSchemaForMcp` in `mcpServerSimple.js` rewrites exactly those parts of the shared
  descriptions. A correction made this way records `sourceChannel: 'mcp'` and `assistantId: null`.
  `__tests__/SettingsView/MCPSettingsToolParity.test.js` fails the build when the server serves a
  tool that Settings → MCP cannot switch off, or when Settings lists a tool the server does not
  serve; every MCP tool, the six `browser_*` tools included, is its own switch there.

A correction is stored in `knowledgeBases/{id}/corrections/{id}` in the SAME transaction as the
page revision it produced (`writeKnowledgePage`'s `onWrite`), is cited as `[[correction:ID]]`
(the model writes `[[correction:new]]`), and overrides older sources in every later ingest prompt.
Undo (tool, or the wiki history's button through the `undoKnowledgeCorrection` callable) restores
the revision before it via `restoreKnowledgePageRevision` — only while the page is still at the
correction's revision, never from a `redacted` revision — and marks it `reverted`, after which
neither the ingest prompts nor `loadKnowledgeSourcesByKeys` use it. The "Suggest a correction"
button on a page only opens a chat with the project's assistant (`createBotQuickTopic`); it never
writes the wiki itself. Pinned by `knowledgeBaseAssistant.test.js` and the `project wiki wiring`
block in `assistantHelper.test.js`.

**A page is the current state, never its history.** The revisions already keep every past version
of a page, so `WIKI_RULES` in `knowledgeBaseIngest.js` forbids narrating how the project got there
(meeting chronology, "first …, then …"), tells the model to replace a superseded statement and its
citation instead of adding the new one beside it, and allows alternatives only while a question is
still undecided: once decided, the decision and its reason stay and the rejected options go. Both
ingest modes list source cards oldest first, so a later card wins a disagreement; the rebuild path
sorts them itself because `loadKnowledgeSourcesByKeys` returns them in page order. The
`correct_knowledge_page` body follows the same rule. Pinned by the `current state` case in
`knowledgeBaseIngest.test.js`.

An ingest run only rewrites a page when one of its sources changes, so pages written before these
rules keep their history until a **one-time current-state pass** reaches them
(`knowledgeCurrentStateRewrite.js`, requested by `migration/rewriteKnowledgeBasesToCurrentState.js`
after `runKnowledgeBaseIngest` is deployed; dry run by default). The request is only a list of slugs
on the wiki document (`currentStateRewrite.pendingSlugs`) plus making the wiki due; the run works
through it after its rebuilds and before the delta, at most `MAX_CURRENT_STATE_REWRITES_PER_RUN`
conversations per run, each from the page's own text plus the cards of the sources it cites, billed
to the owner and stopped by the monthly cap like any other run. Three details: the store sees the
rewrite as an ordinary `ingest` edit (it read the page first and keeps its `sourceKeys`; only a
rebuild replaces them), so neither the store nor the Updates feed needs a new mode (the feed lists
it as an update, badged like any change the wiki makes itself); a page this run has
just rebuilt is skipped (`lastRunId`), and a page that is archived, hidden or has no readable source
leaves the list without a model call; and a run stopped mid-conversation leaves that slug
pending, so the page is rewritten by the next run rather than skipped. Pinned by
`knowledgeCurrentStateRewrite.test.js` and the `one-time current-state pass` block of
`knowledgeBaseIngest.test.js`.

**Every page revision is a line in the Updates feed, and the line carries no page text.**
`onCreateKnowledgePageRevisionSecondGen` (`KnowledgeBase/knowledgeWikiFeed.js`) turns each new
revision — ingest, rebuild, archive, correction, undo — into one feed entry under ONE feed object
per project and day (objectId and type `wiki`, never the project id: `projectsFeeds` is keyed by
object id alone and the project's own object lives there). The entry stores `wikiSlug`,
`wikiRevision` and `wikiChange` and nothing else of the page — no title, summary or reason —
because a withdrawn source is removed from the page and its revisions by
`knowledgeSourceInvalidation.js`, and nothing would remove a copy from `feedsStore`, the followed
stores, `feedsCount`, `projectsFeeds` and the activity summary. The client reads the title of that
revision for the line (`useWikiFeedPageTitle`, falling back to the slug) and the diff from the
revisions themselves. A change a member made (correction, undo) badges the other members with its
own line. The wiki's own changes (ingest, rebuild, archive, lint) badge every member ONCE per
project and UTC day, through one shared counter key, `wiki_automatic` (AT-2967). They used to badge
nobody, and that made them invisible: Updates opens on the unread lines alone whenever anything is
unread, and a 03:00 line sits below the whole day otherwise (All Projects shows 5 per project), so
nobody ever saw one. One counter line per revision would be the opposite trap: `feedsCount` is
copied verbatim into each member's single `activityUnreadSummary` document across all projects,
and archived projects keep their wiki running with counters nobody clears, so that document would
grow every night without bound. The trigger reads the slot first, and a slot already holding this
day's change makes later revisions write no counter at all. A failed read writes the slot anyway,
which is safe because the key is fixed. The card also says what the wiki cost on its day, with a
link to the wiki settings (`components/Feeds/FeedsObjects/wikiDayCost.js`): the `goldSpent` of the
runs that worked during that local day, read from `knowledgeBases/{id}/runs` (members may read the
tree) with one query per card and day. Per day and not per line, because one run rewrites many
pages and a cost on every line would add up to many times what was spent; a running run counts
as "still going" until it writes its total. Member corrections are not runs, since their model
calls are billed to the chat they came from. Ids are derived from slug + revision, so a redelivered
trigger rewrites the same documents. A line opens `/projects/{id}/wiki/{slug}/changes/{revision}`
(`WikiPageChange`, diff in `wikiDiff.js`: LCS over lines, word highlights inside an edited line,
folded context), which also works for archived and hidden pages because it reads revisions, not
the visible page list, and shows a redacted revision as removed and nothing more. Revisions record
`created` so a new page reads "created", not "updated". Pinned by
`knowledgeWikiFeed.test.js` (including that no page text reaches any feed document),
`components/WikiView/wikiDiff.test.js`, the `what a revision changed` block of `WikiView.test.js`
and `components/Feeds/FeedsObjects/WikiObject.test.js`.

**A wiki run that loses its model connection retries within minutes, not overnight (AT-2870).**
On 2026-10-26 one OpenRouter stream broke off with `Network connection lost.` and paused a wiki
that was catching up until the next night. OpenRouter reports a lost upstream connection as an
error event INSIDE an HTTP 200 stream, which the OpenAI SDK throws as an `APIError` with no
`status` and `code: 502`; the SDK's own create-time retries never see it. `streamOpenRouterChat`
therefore re-requests a transiently broken stream twice (`Assistant/transientModelErrors.js`
decides what is transient), but only while the consumer has received nothing of it: interactive
text that already reached the user is never replayed. The ingest passes `bufferModelOutput`, so
its answers are held back until complete and can be retried at any point; tool calls are emitted
only by a completed stream either way. A run that still fails transiently schedules itself 7
minutes later and enqueues that task itself (the dispatcher only ticks every 15 minutes), at most
`MAX_TRANSIENT_FAILURE_RETRIES` (3) times in a row; anything else keeps the nightly slot. Pinned by
the AT-2870 blocks in `knowledgeBaseIngest.test.js` and `openRouterChatClient.test.js`, and by
`transientModelErrors.test.js`, which builds the SDK's real error classes.

**The project description frames the wiki and is never one of its sources.** The two have
separate jobs. The description (`projects/{id}.description`) is a short, stable profile written by
people: what the project is, what belongs in it, standing rules. Task, calendar and Gmail routing,
the email channel, VM jobs and projects without a wiki depend on it. The wiki holds everything that
changes. Every ingest conversation therefore gets the description, capped at
`PROJECT_DESCRIPTION_MAX_CHARS`, to judge scope and framing. It may never
be cited or copied onto a page. It is free text written without a visibility filter and has no
source key, so `knowledgeSourceInvalidation.js` could never take a copied statement back out.
`update_project_description` and its base instruction steer assistants the same way: status
and recent activity stay out of the description unless the user explicitly asks for them.

**A member can hand the wiki a document: "put this deck into the wiki" (AT-2816).** The runs that
may correct also get `add_knowledge_document` and `remove_knowledge_document`
(`knowledgeDocuments.js`), offered as soon as the wiki is switched ON, not only once it has a page,
because a deck is often the first thing a new wiki gets. The model passes no content: the server
reads the uploaded file of THIS conversation (`readChatAttachmentFile`, the same resolution as
`get_chat_attachment`), extracts up to 120,000 characters and stores them at
`knowledgeBases/{id}/documents/{id}`, then pulls `nextRunAt` to now and enqueues a run. The ingest
reads documents as a source type of their own, cited `[[document:ID]]`, with a rule to work the document
into the pages it concerns rather than write a summary page next to them. Four things are
load-bearing. A long document is split into parts of at most `DOCUMENT_PART_MAX_TOKENS` (10,000)
because `chunkKnowledgeSources` CUTS an oversized card instead of splitting it — a deck would
otherwise lose everything after its first ~55,000 characters, silently. Only the LAST part carries
the cursor position, so a run that stops after part 2 of 4 reads the whole document again rather
than never seeing parts 3 and 4. A document is not a note on purpose: it lives inside the wiki tree,
shares its audience by construction (like a correction), and never shows up in notes lists or
follower notifications; only the page revisions it causes reach the Updates feed, like any other
wiki change. The current-state pass and rebuilds load all its parts through
`loadKnowledgeSourcesByKeys`. And removal runs the same `invalidateKnowledgeSource` as an object that
turned private — pages emptied, hidden and rebuilt, revisions redacted — after deleting the stored
text, because members can read the whole tree. The same text hash already active answers
`alreadyAdded` instead of feeding the document twice.

**A page read is the text plus what it cites; the full source list is provenance, not payload
(AT-2614).** `sourceKeys` only grows outside a rebuild, because the withdrawal needs every source a
page ever leaned on, and on the reporting wiki 57% of listed sources were no longer cited, so a read
was mostly source list. `read_knowledge_page` returns the cited ones (`splitKnowledgePageSources`)
plus `otherSourceCount`, and the wiki view folds the rest away. Never prune `sourceKeys` to fix this.
The assistant context and every read say when the wiki last caught up (`lastSuccessfulRunAt`,
written only by completed or partial runs) and that later changes may be missing.

**Wiki search answers from Firestore, the index only narrows where to look.** `search_knowledge`
(`knowledgeSearch.js`) scans the target project's visible pages fresh and quotes passages, so a page
hidden for a rebuild is never quoted however stale `dev_wiki` is. Global search has a Wiki tab on
`dev_wiki` (records `isPublicFor: ['0']`; the scoped key's `projectId` filter is the access rule,
page text is matched but excluded from responses). `onWriteKnowledgePageSecondGen` mirrors each
page, and `invalidateKnowledgeSource` deletes withdrawn pages from the index itself. "Only what I
created" skips the Wiki tab: the wiki writes every page.

**A search collection the browser key's PARENT does not list answers 401, and global search shows
that as "no results" (AT-2905).** Every browser search key is a scoped key derived from a parent
search key, and a scoped key can only reach the parent's collections. The parent was created by
hand in Typesense Cloud for the original five collections (`TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY`),
so when the Artifacts and Wiki tabs were added, every request to `dev_artifacts` and `dev_wiki` came
back 401. The client re-fetched a key from the same parent, got 401 again, and printed only a
`console.log`. Both tabs looked as if they were not searching at all. In the logs this shows up as two
`getTypesenseScopedSearchCredentialsSecondGen` POSTs in the same second, one forced refresh per
failing tab. `functions/Typesense/scopedSearchParentKey.js` now provisions the parent with the
admin key, from `ALL_COLLECTIONS`, under a value derived from the admin key and the collection list
(an HMAC). Every instance therefore computes the same key, a 409 "already exists" counts as success,
and adding a collection creates a new parent on the next cold start. Superseded parents are kept
because an older instance may still issue keys from them. The parent may only `documents:search`,
which Typesense requires for scoped keys. The configured key is now only a fallback when provisioning
fails, and that failure is logged as an error. Add a new search collection to `ALL_COLLECTIONS`,
never to a hand-made key. Global search shows its tabs in `GLOBAL_SEARCH_TAB_ORDER` (`Header.js`):
Artifacts before Chats, like the main navigation. The tab numbers stay as they are because the
@-mention picker shares 0-4. Tab-key cycling and the fallback to the first tab with results follow
the shown order. Pinned by `functions/Typesense/scopedSearchParentKey.test.js`, the AT-2905 cases in
`scopedSearchCredentials.test.js` and `components/GlobalSearchAlgolia/Header/Header.test.js`.

**Global search ranks the user's own objects first, filter or not (AT-2945).** With "only what I
created" off, every tab except the wiki sends `boostCreator: { attribute, userId }`
(`getCreatedByMeBoost` in `typesenseSearchFilters.js`, same creator attribute as the filter), and
`buildRecencySortBy` folds it into the first sort field as a weighted `_eval`: own exact identity
match, other exact match, own match, the rest. Then the AT-2663 relevance buckets and recency apply
inside each group. It shares the exact-match `_eval` because Typesense rejects a fourth sort field
("Only upto 3 sort fields are allowed"). It is a sort, never a filter: access stays in `filter_by`
alone, and the AT-2527 identity-first merge still puts title matches ahead of body-only ones. With
the filter on, for anonymous viewers, on the wiki, in pickers and in server-side search, no boost is
sent. Pinned by `searchRanking.test.js`, the AT-2945 case in `searchRanking.integration.test.cjs`
(real Typesense 29), `typesenseSearchFilters.test.js` and `GlobalSearchModal.createdByMe.test.js`.

**The browser search key admits what Firestore's `readerIds` admits, no more (security audit
NV-40).** `buildEmbeddedAccessFilter` (`functions/Typesense/scopedSearchCredentials.js`) used to add
`ws@default` and every workstream whose `userIds` named the caller to the key's `isPublicFor`
filter. Workstream membership is member-writable, and the Firestore projection
(`buildObjectAccessProjection`) keeps only `0` and explicit member uids from `isPublicFor`, so search
returned private objects Firestore denied. The filter is now `projectId` in the caller's projects
and `isPublicFor` in `[0, uid]`. Index records carry only `isPublicFor` (no `readerIds`), and no
reindex is needed. Product effect: a private object shared with a workstream is searchable by the
members listed by uid when it was shared, exactly as it is readable, not by later members. The
privacy picker's `getAllOwnerIds` had the bug that made this matter: `secondaryOwnersIds - [...]`
discarded the workstream's members, so a workstream-owned private object listed no member uids at
all. Pinned by `scopedSearchCredentials.test.js` and `PrivacyModal/getAllOwnerIds.test.js`.

**"Save to wiki" never shares an ambiguous text unseen.** `save_knowledge_contribution`
(`knowledgeContributions.js`, `[[contribution:ID]]`) saves the member's own words directly; an
assistant summary, possibly private text or a different target project first becomes a draft in the
server-only `knowledgeContributionDrafts` collection, NOT in the wiki tree (members read that tree
straight from Firestore). Confirming needs `confirmed: true` and, where the channel has message
ids, a later message than the draft's. The card says it is a member's statement, not a verified
record, and the ingest keeps conflicts with other sources as open questions.

Confirmation resolves an owned draft's destination before checking current project membership,
so a cross-project confirmation without `projectId` never falls back to the chat project. An
explicit conflicting target is refused. Pending drafts are scoped to the requesting user and
exact conversation, included in the next reply's context, and reused for unchanged text. Choosing
a new destination for the same text preserves its earlier message boundary; changed text needs
a new confirmation. Draft creation (`saved: false`, `needsConfirmation: true`) and structured
tool failures do not reset the tool loop's three-round no-progress guard (AT-2904).

**The weekly health check may only spend the first 80% of the cap (`knowledgeLint.js`).** A
rule-based `lintReport` is written on runs that changed pages; the model pass runs once the run
has caught up, at most every 7 days, only if a page changed, changes at most 10 pages, never one
corrected in the last 14 days, and records revision mode `lint` with a `lint:` reason. It must not
settle a contradiction by recency alone; it adds an "Open questions" section instead.

**PowerPoint and Excel are read as text everywhere a file reaches an assistant.**
`functions/Utils/officeDocumentText.js` turns .pptx (slides in the deck's own order from
`presentation.xml`, speaker notes, no field text) and .xlsx (rows with " | ", dates formatted from
the cell's number format, cached formula results) into text; `extractTextFromWhatsAppFile` uses it
for WhatsApp, inbound email and chat uploads alike, and takes a `maxChars` budget (8,000 inline,
120,000 for the wiki). A chat upload the model sees only the beginning of is now labelled
`[FILE: name, type=…, only the first N characters]` (`extractionTruncated`), so it cannot answer
about the whole deck from its first slides. The archive is untrusted: each part's declared size is
checked before it is inflated (60 MB per part, 150 MB in all). Legacy .ppt/.xls and Keynote stay
unsupported. `jszip` is pinned to 3.10.1, the version mammoth already brought in. Pinned by
`officeDocumentText.test.js` (real files written by python-pptx/openpyxl and re-saved by
LibreOffice, whose markup differs), `knowledgeDocuments.test.js` (a real deck end to end into the
ingest's source card) and the `documents added to the wiki` block of
`collectKnowledgeSources.test.js`.

Keep the parser `components/WikiView/wikiMarkdownParser.js` and the renderer `WikiMarkdown.js`
under different names: a `wikiMarkdown.js` next to `WikiMarkdown.js` collides on macOS's
case-insensitive filesystem. The renderer is deliberately self-written (no Markdown dependency, no
HTML): page links, source chips and http(s) links are the only interactive output.

### Project artifacts are code, and are never served from the app's origin

The **Artefakte** tab (`components/ArtifactsView/`, `functions/Artifacts/`, plan and decisions in
`ARTIFACTS_PLAN.md`) took the Chats slot in the five root tabs; Chats stays in the sidebar and behind
the top bar's button. An artifact is what a project produced — an HTML dashboard, a report, a PDF,
an image — at `artifactItems/{projectId}/artifacts/{id}`, with immutable versions in a `versions`
subcollection and bytes at `artifacts/{projectId}/{id}/{versionId}/…` in Storage. It is read and its
metadata edited exactly like a note (`isPublicFor` + the server-owned `readerIds` projection; the
collection is in `OBJECT_COLLECTIONS`), and it opens in place at `/projects/{projectId}/artifacts/{id}`.

**`serveArtifact` must never be reachable on the app's own origin.** An HTML or SVG artifact is
code a model wrote or somebody uploaded; on `my.alldone.app` it would run with the viewer's Firebase
session (IndexedDB on that origin) and could do anything the viewer can — and assistants read
email, so a crafted message can steer one into building such a page. The function is addressed by
its own `cloudfunctions.net` URL (`getArtifactServeBaseUrl`) and, for public links, by
`artifacts.alldone.app`: a separate Hosting site (`hosting/artifacts/`) whose only rewrite goes to
`serveArtifact`. That is a sibling origin, so it shares no storage with the app; never add the
rewrite to the root `firebase.json` and never connect an app domain to that site. Active types
(`ACTIVE_MIME_TYPES`) get `Content-Security-Policy: sandbox …` **without** `allow-same-origin`, and
`ArtifactPreview` frames them with the same flags. Never add `allow-same-origin` or
`allow-top-navigation` to either: without the sandbox, every artifact on the shared origin would
get real storage and could read every other artifact's. A PDF is framed without the sandbox only
because Chrome refuses to render one inside it. The type is derived from the file extension on the
server, never taken from the client, because it decides whether a response is sandboxed.
`browser-tests/artifacts` proves all of this in Chromium and is mutation-checked. The one risk the
alldone.app subdomain adds is reputation: a phishing page uploaded as an artifact and shared
publicly carries our domain, and Safe Browsing can flag a whole domain. Moving public links to a
separate domain is a change to `ARTIFACT_PUBLIC_HOSTS` plus DNS.

**An artifact has two addresses, and only one is meant to be shared.** Both are capabilities, like
a note attachment's download-token URL; artifact bytes get **no** download token and are read only
through the function, which caches an artifact document and a public-link lookup for 60s per
instance, so any change lands within a minute.

- **Internal** `/a/{projectId}/{artifactId}/{serveSecret}/{path}` (`~{versionId}/` pins a version):
  what the app frames the preview and full screen with. `serveSecret` rotates whenever anybody loses
  read access (`rotateServeSecretOnLostReaders` in the update trigger compares `readerIds` before
  and after, which covers turning private, a narrower audience and a member leaving, because the
  membership sync rewrites `readerIds`). No button touches it any more; the old "Reset link"
  callable (`resetArtifactLink`) stays only for clients that still show it.
- **Public link** `artifacts.alldone.app/{token}/` (on staging and in the emulator: serveArtifact's
  own URL, `ARTIFACT_PUBLIC_HOSTS`): the server-owned `publicLink` field
  (`{ token, createdAt, createdBy }` or `null`) plus a server-only lookup
  `artifactPublicLinks/{token}` → `{ projectId, artifactId }`, so the address carries no ids.
  `serveArtifact` serves only a token the artifact itself still carries, redirects the bare token to
  `/{token}/` (relative links) and an entry file in a folder to that folder, and never answers the
  live data bridge there. It is **on by default** for a project-visible artifact
  (`commitArtifactVersion`), absent for a private one, and any member who can read the artifact may
  switch it off, on or change it (`setArtifactPublicLink`; on again always means a new token).
  Making an artifact private ends it (`withdrawPublicLinkWhenMadePrivate`); making it visible again
  does not bring it back. A member leaving does **not** change it: it is public by intent. Artifacts
  from before public links have no `publicLink` field at all;
  `migration/enableArtifactPublicLinks.js` (dry run by default) gives them one, and `null` (switched
  off) is never overwritten. The detail page copies it from the header (with it off, the in-app
  address instead); everything else about it lives under Details. Pinned by the `public link`
  blocks of `artifactStore.test.js`, `serveArtifact.test.js`, `artifactModel.test.js` and
  `ArtifactDetail.test.js`.

**Making a project private rotates every artifact's serve secret (security audit NV-16).** While a
project is shared by link (`isShared` 0 or 1) non-members may read its project-visible artifact
documents, `serveSecret` included, and the internal address is authorized by that secret alone.
`onUpdateProjectSecondGen` therefore calls `rotateServeSecretsForProject` (`artifactStore.js`) when
`isShared` moves INTO 2, with a `link_rotated` history entry per artifact. `publicLink` is not
touched: it is public by intent, and whether a project's privacy should end it is an open product
decision. Pinned by the NV-16 cases in `artifactStore.test.js`.

**An HTML artifact is framed at its natural height, which only the page can report (AT-2881).**
The frame is cross-origin and sandboxed, so the app cannot measure it. `serveArtifact` appends a
small reporter (`Artifacts/artifactFrameHeight.js`) to an HTML response **only** when the browser
loads it into a frame (`Sec-Fetch-Dest: iframe`, with `Vary` and a separate `-frame` ETag), so full
screen, downloads and fetches still get the stored bytes. The script posts its height to its parent.
`useArtifactFrameHeight` accepts the height only from that frame's own window and only from
origin `'null'`, then clamps it. Only the detail view opts in (`autoHeight`). Note cards and PDFs
keep a fixed frame. A page whose height follows its viewport, or flips between two heights, is
settled by the script and keeps an inner scrollbar. The same applies to a page that never reports,
such as a cached response or a page whose own CSP blocks inline script. Rendering is throttled in
off-screen cross-origin frames, so measuring must not rely on `requestAnimationFrame` alone. Pinned
by `artifactFrameHeight.test.js`, the AT-2881 blocks of `serveArtifact.test.js` /
`ArtifactPreview.test.js`, and `node browser-tests/artifacts/frameHeight.js` (real Chromium).

**Only Cloud Functions create artifacts and write versions and bytes** (`commitArtifactVersion`,
`restoreArtifactVersion`, `setArtifactPublicLink`); `firestore.rules` refuses a client create and any
client update touching a server-owned field (`artifactServerFieldsUnchanged`, mirrored by
`ARTIFACT_SERVER_FIELDS` in `artifactModel.js`). Files reach the server base64-encoded inside the
callable request, so an upload is capped at 20 MB (`MAX_ARTIFACT_UPLOAD_BYTES`) — deliberately, since
Storage rules are console-managed and not in this repo, and a client-side staging upload would depend
on them. The list queries carry one `array-contains` on `readerIds`/`followedReaderIds` and sort on
the client, so no composite index is needed. Pinned by `functions/Artifacts/*.test.js`, the
`project artifacts` block of the rules emulator suite and `components/ArtifactsView/*.test.js`.

**Assistants write artifacts through the same commit as an upload.** One Tools Access key,
`artifacts`, fans out to `get_artifacts`, `read_artifact`, `create_artifact` and `update_artifact`
(`Artifacts/artifactToolSchemas.js`, executed by `artifactAssistant.js`; MCP lists the four names
individually because an MCP caller has no assistant document). A tool acts for the **requesting
user**, who must be a project member and becomes the owner; the assistant is recorded as the
server-owned `creatorAssistantId` (and starts out as the artifact's thread `assistantId`, which stays
client-editable like on every other object, because the chat assigns it). An artifact made in a private thread is private, and a thread that cannot
be read counts as private, so an unknown thread never widens the audience. `update_artifact` sends
only the change — exact `edits` (each `find` must occur once), whole `files`, `removePaths` — and
`commitArtifactVersion({ keepUnchangedFiles })` copies every other file inside the bucket; the version
the edits were made against (`baseVersionId`) is checked again in the commit transaction, so a
concurrent version fails as `aborted` instead of being silently dropped. Results carry the **in-app**
URL, never the serve URL: that one is the capability, and a chat can be readable by more people than
the artifact. Existing assistants store their own `allowedTools` and get the key only through
`migration/enableArtifactToolForAssistants.js` (dry run by default) or the checkbox.

**Linked uploads (AT-2828) supersede the original explicit-copy UI decision.** The All artifacts
list additionally shows uploads from their readable source documents, comments and saved Yjs
notes; since AT-2860 the server finds them (see the next paragraph). Existing uploads need no migration. One stored
path yields one row, which never gets a new serving/public URL: pressing it opens
`ArtifactFileViewer` with the download URL the source itself embeds (an image's stored 300px copy is
the row thumbnail), and its context line opens the source. Only img/video/audio render inline; a PDF or
other file goes to a new tab, because Chrome frames a PDF only unsandboxed and a stored file's content
type is whatever the uploader's browser declared. Lists show 3 per project in All projects and 10 in
one project, the rest behind `ShowMoreButton`, like Notes. Membership, the source's `readerIds`
projection and its current `isPublicFor` gate every row. `uploadsRevision` on notes announces completed local
Storage writes, including offline catch-up, without changing edition metadata. The chip's action is
now "Show in artifacts" and opens All, without invoking the old copying callable. Full historical
copies and VM artifacts remain independent (see `ARTIFACTS_PLAN.md` linked-upload limitations).

**Linked uploads are found on the server, never by browser listeners (AT-2860).** The first
version assembled them in the browser: a listener on every source collection of each project (all
22,798 tasks of the main project) plus one per conversation with a chat object, and every note body
downloaded from Storage. One visit to the tab left a device with ~28,000 Firestore targets and
~100 MB of cached documents, the client's Firestore queue stopped answering, and the app replaced
itself every seven minutes (`firestore-restart_timeout` in `runtimeErrors`, which had not occurred
once in the three weeks before). `getProjectLinkedUploads` (`functions/Artifacts/linkedUploadsIndex.js`)
now keeps a server-only candidate index at `artifactUploadIndex/{projectId}` (no client rule; it holds
download URLs). A project is read in full once, in resumable steps of `SCAN_BUDGET_MS` (the callable
answers `complete: false` and the client asks again after `retryAfterMs`), then only what changed:
`lastEditionDate` on every source, a note's `uploadsRevision` (a push id, compared by its time
prefix), and a chat object's `lastEditionDate` for new comments, which re-reads that one thread.
More than `INCREMENTAL_LIMIT` changes, or a week since the last full read, starts a full read again;
that is also what catches a comment edited in place, which stamps nothing. The index only lists
CANDIDATES: every call re-reads each candidate and its parent, so an edit, a deletion or a privacy
change shows at once, and access is the old query's (`readerIds` names the caller AND `isPublicFor`
does), member and assistant threads open to every member as their rules say. A source gone or empty
is dropped from the index; one the caller may not read stays for the members who may. One scan runs
per project at a time (a lease on the state document). The tab still opens from what this device
showed last time (`artifactsLocalCache.js`) and keeps it until the answer is complete; offline it
keeps it without an error. Do not reintroduce a client listener per source collection or per thread
here: the cost is paid by every other Firestore query on that device. Pinned by
`functions/Artifacts/linkedUploadsIndex.test.js` (an in-memory Firestore that counts what each query
read) and the polling block of `utils/backends/Artifacts/artifactsFirestore.test.js`.

**A device whose Firestore cache is bloated resets it once (`utils/backends/firestoreCacheReset.js`).**
Removing the listeners stops new bloat; the existing one stays until the cache is deleted, and a
local query reads every cached document of its collection. A while after boot the app reads the
SDK's own bookkeeping straight from IndexedDB (never creating the database); above
`BLOATED_TARGET_COUNT` targets or `BLOATED_DOCUMENT_BYTES` it waits until the page is hidden, waits
for `waitForPendingWrites`, and requires an empty `mutations` store, no task write or comment draft
in flight and no other live client (another tab would have the database deleted under it). Only then
it records a request and reloads; the next boot calls `clearPersistence()` before persistence is
configured, which the SDK runs first on its own queue. A request older than a few minutes is ignored,
a clear interrupted by the page going away is never retried, and a clear that stays blocked for
`CLEAR_TIMEOUT_MS` replaces the page without retrying. The outcome is journaled as `cache-reset` in
`runtimeErrors`. One reset per device and key version (`alldone.firestoreCacheReset.v1`).

**Every artifact row leads to where the artifact was made** (`ArtifactContextLink`,
`artifactContext.js`): a linked upload to its first source ("In Meeting notes +1"), and a full
artifact with a `parentObject` to that object's thread ("Created in …"), also in the detail view.
The parent's title is read once per session with the viewer's own access; a parent the viewer
cannot read (or that is gone) gets no link at all.

**The legacy `saveAttachmentAsArtifact` callable copies an attachment the server already stores, and the URL is the only
input** (`Artifacts/attachmentPromotion.js`, callable `saveAttachmentAsArtifact`). It is checked
before a byte is read: `firebasestorage.googleapis.com`, this project's default bucket (no fetching
of arbitrary URLs), a path under `attachments/`, `feedAttachments/` or `notesAttachments/`, and a
`token` that is one of the file's own `firebaseStorageDownloadTokens` — the token is what makes an
attachment URL a capability, so a wrong token answers exactly like a missing file. The copy is
**private** to the person saving it, because the conversation may be readable by fewer people than
the project. The chip action (`components/Tags/SaveAttachmentAsArtifactButton.js`) appears where
`CommentElementsParser` renders with `inChat`, and inside the attachment blot only for a file
uploaded into a note (`isNoteAttachmentUri`, i.e. `notesAttachments/`): a comment composer's chip
is a draft. A blot is created without a project, so the chip resolves it from
`quillTextInputProjectIdsByEditorId[editorId]`, which `NotesEditorView` registers; pinned by
`formats/attachmentSaveAsArtifact.test.js` (a real quill 2 and the real blot).

**An artifact is a full chat object (`artifacts`), so every object-type switch needs a case for
it.** Comments live at `chatComments/{p}/artifacts/{id}`, followers at `followers/{p}/artifacts/{id}`;
`chatsComments.js`, `getObject`, `setObjectAssistantEnabled`, the comment popup header and
`LastObjectEditionHelper` each carry an `artifacts` branch. A missing one does not throw — the
comment is stored and the artifact's preview, unread state or assistant reply silently stops. The
artifact delete trigger also deletes its chat and clears `linkedParentArtifactsIds` backlinks.

**Its history is a server record, and a version event is written in the version's own
transaction** (`Artifacts/artifactHistory.js`, `…/artifacts/{id}/history`, no client write). Metadata
edits a member makes straight in Firestore are derived by the update trigger under ids keyed on the
trigger event, so a redelivery overwrites instead of duplicating; an update that moved the current
version records nothing there, because the commit already wrote its entry.

**Every history event a person decided is also an Updates entry, from every source** (app upload,
assistant tool, MCP client, VM job; `Artifacts/artifactFeeds.js`, card `FeedsObjects/ArtifactObject.js`,
object type `artifact` / `artifacts`). The entry is written where its history event is (after the
commit, restore, public-link and live-data transactions; metadata edits from the update trigger)
under an id derived from the history entry's id, so retries overwrite. Rotated or withdrawn links
get none. The actor is the user, with the MCP marker, or the assistant: assistant metadata edits
stamp `lastEditorAssistant` bound to the edition, like `lastEditorVia`. A deleted document names no
deleter, so the app and `delete_artifact` first write `deletedBy` in a separate write; the update
trigger ignores that stamp-only update, and the delete trigger names the stamp (no stamp, no entry;
a stamp older than 10 minutes is a leftover of a delete that never happened and names nobody).
`firestore.rules` lets a browser stamp only itself and without a channel marker
(`artifactDeletionStampIsOwn`); MCP and assistant deletions stamp on the server.
Entries carry the artifact's `isPublicFor`; a change of audience re-privatises them
(`reconcileFeedPrivacy(event, 'artifacts')`) and the earlier day cards. Their
`feedsObjectsLastStates` copy is as private as the artifact (see "An object's last feed state is
as private as the object"), and `get_updates` takes the title from the artifact.

**Live project data hands viewer data to model-written code, and four rules keep that safe**
(`Artifacts/artifactDataBridge.js`, host in `useArtifactDataBridge.js`, queries in
`artifactBridgeData.js`). (1) The locked-down CSP follows the **address** (`?alldone-bridge=1`), not the
artifact document — serveArtifact caches documents for 60s and browsers cache responses, so a policy
decided by the document could be stale exactly when data is handed over. Never make the bridge
answer a frame loaded without that parameter. (2) Only **project-shared** objects
(`readerIds` contains 0) are returned, never private ones, because a page can still navigate its
frame away with data in the URL, and WebRTC/DNS prefetching are beyond any page policy. (3) Only the
document that said hello first is answered; a second hello ends the conversation. A load counter
alone is not enough — a navigated document's scripts run before its `load` event, which
`browser-tests/artifacts/bridge.js` caught. (4) `dataAccess` is server-owned and only the owner
switches it (`setArtifactDataAccess`, or a commit by the owner). Run
`node browser-tests/artifacts/bridge.js` after touching any of this; its control page must still
reach the attacker server, or the "blocked" checks prove nothing.

**The whole feature has an end-to-end run against the local emulators**
(`node browser-tests/artifacts/e2e.js`, with `npm run emulators` and `npm run dev:web` running): it
resets the LOCAL emulators, signs in, uploads a dashboard, checks the sandboxed preview, live data
through the bridge, the backlink, the chat, the history, a reload onto a section, "Change with
assistant" and the preview card in a note — 29 checks, screenshots in `ARTIFACT_E2E_SHOTS`. It signs
in by storing an Auth-emulator session in `firebaseLocalStorageDb` instead of clicking through the
Google widget, whose redirect needs apis.google.com. The dev build needs a filled `.env` (at least
`GOOGLE_FIREBASE_WEB_PROJECT_ID=alldonestaging`, a parseable `GOOGLE_FIREBASE_WEB_DATABASE_URL` and
`GOOGLE_FIREBASE_WEB_API_KEY=local-emulator-only`); an empty one boots to an endless loading screen
(`projects//databases`). It found two bugs unit tests could not: an uploaded artifact opened without
its address, and `awardXpSecondGen` failing on every comment locally because the Functions emulator
drops `admin.firestore.FieldValue` — use `require('firebase-admin/firestore').FieldValue`.

**A link to an artifact in a note can be a chip or a live card** (`formats/artifactEmbed.js`,
`ArtifactsView/artifactNoteEmbed.js`). Both carry the in-app URL, so `scanLinkedObjects` records a
backlink for either; the card is mounted through `renderEmbedContent` and reads the artifact with the
viewer's own access.

### An MCP client acts in the user's name, and says so

Claude, Codex and other MCP clients have no account of their own: every MCP tool runs as the
OAuth-authenticated user (`assistantId = null`), so `creatorId` / `lastEditorId` is the user, which
is right for access and ownership. Two things were wrong with that and both are fixed by one marker,
`{ via: 'mcp', viaClient: 'Claude' }` (`functions/shared/mcpActor.js`): the app could not tell the
agent's work from the user's own, and the user was never notified of it, because every fan-out skips
the actor. The marker is stamped on feeds (`generateFeedModel`, both copies), comments and their
chat/push notifications (`TaskCommentService`), wiki revision authors, artifact versions and
their history events (`commitArtifactVersion({ actorChannel })`, `setArtifactDataAccess`), and the
`lastEditorVia` of a task or an artifact (bound to `lastEditionDate`, because the app writes
`lastEditorId` without knowing to clear it; the artifact update trigger reads it to label a rename). The app renders it as "Karsten Wysk (via Claude)" (`utils/mcpActorLabel.js`,
`getFeedCreatorPresentationData`); readers must keep using the user's id for avatar and navigation.
Every notification path that skips the actor keeps the actor when the marker is present:
`increaseFeedCount`, `TaskCommentService.addComment`, the wiki feed and the WhatsApp initiator guard
(`initiatorVia`). An MCP `update_task` comment is therefore not silent, unlike an assistant's.

`viaClient` comes from the `clientInfo.name` the client sends with `initialize`, remembered on its
`oauthTokens` / `oauthRefreshTokens` documents (`mcpClientName`, carried over on refresh), and is
only ever one of the labels in `MCP_CLIENT_LABELS` — a client's self-description is rendered to every
project member, so an unknown name is shown as "via MCP", never verbatim. Production clients report
`codex-mcp-client`, `Anthropic/ClaudeAI`, `claude-code`. A token from before this shipped is labelled
once its client next initializes. A new MCP-reachable tool that writes feeds or comments gets the
marker for free if it builds its actor with `getAssistantFeedUserForTool(..., toolRuntimeContext)`.
Pinned by `functions/shared/mcpActor.test.js`, `functions/MCP/mcpClientAttribution.test.js`,
`functions/Feeds/globalFeedsHelper.mcpActor.test.js` and the MCP cases in `TaskCommentService.test.js`.

**MCP can set up a workspace, and nothing else configures one over MCP.** Seven MCP-only tools in
`functions/MCP/mcpWorkspaceSetupTools.js` let a client set up a working structure for the user:
`create_project` (optionally with contact statuses), `add_contact_statuses`, `create_assistant`,
`update_assistant` (name, description, instructions, model, Tools Access, project assistant),
`create_assistant_task` (a recurring prompt the assistant runs for the caller), `get_assistant_tasks` and
`update_assistant_task` (prompt, name, rhythm, start, WhatsApp, goal, pause/resume for the caller). The
tools are shared with assistants (see "MCP and assistant tools offer the same features" below):
`update_assistant` is MCP's side of `update_assistant_settings`, the other six run the same handlers
for an assistant. Three rules keep agents from making a mess:

- **Idempotent by name.** A second call with an existing project, assistant or task name returns
  the existing object (`alreadyExisted: true`) instead of creating a duplicate.
- **Capped per user per day.** The caps are in `DAILY_LIMITS`; the counter lives at
  `users/{uid}/private/mcpWorkspaceSetupQuota`.
- **No more than the app's own screens allow.** Tools Access keys come from a copy of `toolOptions.js`
  (`ASSISTANT_TOOL_KEYS`, pinned by `__tests__/MCP/mcpWorkspaceSetupToolKeysParity.test.js`), and models
  from `SELECTABLE_ASSISTANT_MODELS`.

The documents are built field for field like the app's own forms (`getNewDefaultProject`,
`getNewDefaultAssistant`, `PreConfigTaskModal`). An assistant task stores its start the same way the
form does: the UTC instant of the local start, the local `HH:mm` and the offset. Every change writes
its Updates entry (see "Every change made over MCP shows in Updates" below); `onCreateProject` still
runs. Assistant tasks are `direct` mode only. Each tool
is its own switch under Settings → MCP. Pinned by `functions/MCP/mcpWorkspaceSetupTools.test.js`.

A scheduled assistant task runs on its own copy of the instructions (`aiSystemMessage`, copied at
creation and preferred over the assistant's `instructions` at run time), so changing an assistant's
instructions alone would never reach its schedules. `update_assistant` therefore also rewrites the
copy of every task of that assistant whose copy still equals the OLD instructions; a task whose copy
somebody edited keeps it. Tool changes keep list entries that are not Tools Access keys (written by
older app versions), and a call that changes nothing writes nothing and spends no quota.

`update_assistant_task` keeps the stored start date when only `startTime` changes: the start date is
the anchor of the rhythm (a weekly task runs on that date's weekday), and `buildSchedule` would
otherwise default it to today. The rhythm is stored per user (`recurrenceByUser`) next to the task's
default and follows the caller; pausing removes the caller from `activatedUserIds` and
`recurrenceByUser`, the same fields the scheduler (`assistantRecurringTasks.js`) reads on every tick,
so nothing else has to be recomputed. Edits carry `lastEditedVia`. Pinned by the
`get_assistant_tasks and update_assistant_task` block of `mcpWorkspaceSetupTools.test.js`.

**A scheduled assistant task can file its runs under a goal.** `parentGoalId` on the scheduled task
(set with `create_assistant_task` / `update_assistant_task`, a goal of the same project the caller
can see) makes every run create its task with that goal, through the same fields `create_task` uses
(`buildTaskParentGoalFields`: id, the goal's audience, lock key) plus `skipAutomaticGoalRouting`, so
the goal router does not refile it (`Assistant/scheduledTaskGoal.js`, called from
`ensureTaskChatExists`). A goal that is gone or not visible to the activator is skipped and the run
happens unfiled. A goal
whose milestone is done keeps receiving runs until the goal is changed. Pinned by
`Assistant/scheduledTaskGoal.test.js`, the `scheduled task goal` block of
`assistantRecurringTasks.test.js` and the `goals of scheduled tasks` block of
`mcpWorkspaceSetupTools.test.js`.

**`projectAssistant` on `create_assistant` / `update_assistant` makes an assistant the project
assistant** the way the assistant's "Default" switch in the app does (`setAssistantLikeDefault`):
`projects/{id}.assistantId` plus `isDefault: true` on it and `false` on the project's other
assistants. `false` clears both when the assistant is the current one. Only assistants of the project
itself, not global ones, and no "changed project assistant" Updates entry (the client writes that one;
the setup tools write no feeds). Pinned by the `project assistant` block of
`mcpWorkspaceSetupTools.test.js`.

### Every change made over MCP shows in Updates (decision 2026-11-09)

**Rule:** a change an MCP client makes to Alldone data writes an Updates (activity feed) entry, and
because MCP and assistant tools run the same code, so does the same change made by an assistant (the
actor is then the assistant). Over MCP the actor is the user with the MCP marker, so the line reads
"Karsten Wysk (via Claude)". **Not entries:** private user memory, comments (they show as comments
already) and sign-in data. **Gmail and Calendar actions are entries**, visible to the members of the
project the connection belongs to (Karsten's choice over "only me"): subject or title, recipients or
attendees, labels and times, never a body, an event description or Bcc. A new tool that writes must
write its entry too; leaving one out needs a reason in this section.

Where the entries are written, all best-effort after the change (a failed entry is logged and never
fails the change), each loading the feed state first like `Goals/goalToolFeeds.js`:

- **Assistants and projects** (`Feeds/workspaceChangeFeeds.js`): project created, contact statuses
  added, project assistant switched, assistant created (the person who asked follows it), one entry
  per changed assistant field (name, description, picture, instructions, model, temperature, voice,
  delegation description, Tools Access) from `update_assistant` and `update_assistant_settings`
  alike, heartbeat settings, scheduled assistant tasks created or changed (on the assistant). A
  global assistant gets none, as in the app. Callers in `assistantHelper.js` pass `getFeedUser`, so
  the actor is looked up only when an entry is written.
- **Contacts and moves**: every field `update_contact` changes (`contactUpdateHelper.js`), a contact
  created on the fly ("added", `resolveContactTarget` takes `feedUser`), task and note project moves
  over a tool (their existing "moved" entries, now with the tool's actor), and the global user
  description (on the user in the default project).
- **Goals, milestones, OKRs, wiki**: goal date and scheduling changes (`FEED_GOAL_MILESTONE_CHANGED`),
  milestones and OKRs on the project (`Feeds/projectEntryFeeds.js`, which narrows a private entry to
  its audience; an OKR's later privacy change rewrites its entries in
  `onUpdateOkrAccessProjectionSecondGen`), and wiki sources (documents, saved knowledge) as
  `FEED_WIKI_SOURCE_CHANGED` lines on the wiki that carry **no** title or text, for the same reason
  wiki revision lines carry none.
- **Gmail and Calendar** (`Feeds/integrationToolFeeds.js`, one hook in `executeToolNatively` after a
  successful tool result, so the email line, booking and labeling sync, which call the helpers
  directly, write nothing): `FEED_PROJECT_EMAIL_ACTIVITY` / `FEED_PROJECT_CALENDAR_ACTIVITY` on the
  connection's project. Only the mailbox owner gets the unread badge. Repeated single-email changes
  within 10 minutes are merged into one entry with a count (state at
  `users/{uid}/private/integrationActivityFeed`).
- **Artifacts**: see the artifacts section.

Feed types are the same value on the server (`functions/Feeds/FeedsConstants.js`) and the web
(`components/Feeds/Utils/FeedsConstants.js`), where a new type joins its kind's `FEED_<KIND>_TYPES`
list so it is routed and rendered (`RegularFeed`, "<actor> <entryText>"). `get_updates` keeps its own
map (`EVENT_TYPE_TO_OBJECT_TYPE` in `shared/UpdateRetrievalService.js`);
`UpdateRetrievalServiceFeedTypes.test.js` fails when a web type is missing there, which is how
`FEED_PROJECT_HAPPINESS` and `FEED_ASSISTANT_TEMPLATE_SYNCED` were found unmapped.

### Browser agents use the MCP tools through the signed-in page (AT-2871)

Assistants that cannot add a custom connector but can drive a browser (Gemini in Chrome, Claude in
Chrome, ChatGPT agent, Comet) get the same tools in a signed-in Alldone tab, on two surfaces:
**native WebMCP** (`document.modelContext.registerTool`, with `navigator.modelContext` as the
deprecated alias) and **`window.alldone`** (`listTools`, `callTool`, `tools.<name>(args)`, `help()`)
for agents that only run JavaScript. `utils/browserAgent/browserAgentApi.js` implements both, and
`components/BrowserAgent/BrowserAgentApiBridge.js` mounts them in the logged-in tree. Neither has
tools of its own. Both call the existing `/mcpServer` (same origin, through the hosting rewrite) with
the user's Firebase **ID token**, which `getAuthenticatedUserFromToken` already accepted. So
membership, visibility, Settings → MCP (master switch and per-tool opt-outs) and rate limits apply
unchanged, and nothing works signed out. The bridge sends `X-Alldone-Mcp-Client:
alldone-browser-agent`. The server honours that header **only for an ID token** (an OAuth token
keeps the name it reported in `initialize`), labels writes "via Browser agent" (`mcpActor.js`), and
refuses the bridge when `users/{uid}.browserAgentToolsEnabled === false` (Settings → MCP → "Browser
agents", on by default). The header is not a security boundary: a page that omits it is ordinary MCP
with the user's own rights.

Three things to know. **WebMCP is not a standard yet.** It is a W3C Community Group draft, and Chrome
149–156 expose it only to origins with an **origin-trial token**: paste one per host into
`utils/browserAgent/webMcpOriginTrial.js`, or the API does not exist and only `window.alldone` works.
**ID tokens are JWTs whose first characters are identical for every user**, so the rate limiter's
`client:` key (a token prefix) used to put every browser session into one bucket. JWT-shaped tokens
are now hashed (`getClientIdFromRequest`). **Discovery** is `/llms.txt` (`web-bundler/static`) plus
an `ai-agent-api` meta tag and the `data-alldone-agent-api` attribute. An agent that only fetches
URLs and cannot use a signed-in browser still needs the OAuth connector. Pinned by
`utils/browserAgent/browserAgentApi.test.js`, `components/BrowserAgent/BrowserAgentApiBridge.test.js`
and `functions/MCP/mcpBrowserAgent.test.js`.

**An agent that cannot find the API cannot use it, and the first version was hidden from every
check an agent actually runs (AT-2890).** `window.alldone` was installed with `Object.defineProperty`
and no `enumerable: true`, so `Object.keys(window)`, the first thing Claude in Chrome tried, did not
list it. The meta tag is in `<head>`, which is neither in the accessibility tree nor in the page
text, and on the login page there was nothing at all. So Claude reported that the page had no API.
The API now announces itself on every channel an agent reads, and none of them carries more than
the page already shows. `window.alldone` is enumerable and exists in **every** state: `ready`, plus
`loading` / `signed_out` stubs that have no tools, make no request, explain themselves in `help()`
and resolve `whenReady()` with the real API once a session installs it. `BrowserAgentApiBridge` is
therefore mounted for the whole app in `AppContent` (`sessionReady` replaces the old mount
condition), and `resolveBrowserAgentPageState` decides the state. A user who switched browser
agents off gets **nothing**, not a stub, once their user document is known. During boot a loading
stub can appear briefly, because the account is not known yet.
`Object.keys(alldone.tools)` lists the tool names once `listTools()` has loaded them, and the proxy
only turns snake_case names into calls, so `then`, `toJSON` and `constructor` never call a tool.
There is one `console.info` line per page and state, and the loading stub stays silent. There is
also a JSON manifest, `<script type="application/json" id="alldone-agent-api">`, with the state,
usage and WebMCP outcome but no tool or user data, plus `data-alldone-agent-api-state` on `<html>`.
Native WebMCP is still off in production until origin-trial tokens are registered (see
`webMcpOriginTrial.js`).

**Every agent surface tells the agent that Alldone is the system of record (AT-2832).** Durable work
state and results go into Alldone objects (find and update the existing task or note, comment
progress and results on the task, longer results in a note or artifact, no duplicates, nothing for
throwaway steps) instead of living only in the agent's memory. The same guidance sits in four
places that cannot share code: `/llms.txt`, `SYSTEM_OF_RECORD_INSTRUCTIONS` / `_SUMMARY` in
`browserAgentApi.js` (`help()`, the stubs and the manifest's `systemOfRecord`; the summary names no
tools because the manifest never does), the `ai-agent-api` meta tag, and the MCP `initialize`
instructions (`functions/MCP/mcpAgentInstructions.js`). Keep them in step, and name only tools the
MCP server serves: `mcpServerSimple.test.js` checks every tool the MCP text mentions against
`tools/list`.

### The alldone.team specialists are assistant templates

Connor Consultant (Story Builder), Judy Job and Ricky Returns (Property Screener) are added to a
project like any template: "Add assistant" lists them in their own "alldone.team specialists"
section. They are not hand-made. `syncAlldoneTeamSpecialistsSecondGen` reads
`alldone.team/mcp/specialists` hourly (alldone.team publishes it from `CHAT_APPS`) and keeps one
template per specialist in `globalProject` under a fixed id (`alldone-team-<app>`), marked
`externalSource: { provider: 'alldone.team', appId, family, available, contentHash }`
(`functions/Assistants/alldoneTeamSpecialists.js`). The sync owns only what it derives from the
catalog (name, description, avatar, instructions, its MCP server entry, `externalSource`) and
writes only when that changed; model, tools and heartbeat stay the administrator's. A specialist
alldone.team stops offering is marked `available: false`, not deleted, so existing copies keep
working while the list stops offering it. Template changes reach project copies through
`templateSync` like every other template. Each specialist's tool pages (the catalog's `tools`: Connor's Story Planner
and Story Builder, Judy's Job Radar, Ricky's Property and Stock Screener) are kept as pre-configured
`iframe` tasks of the template (`assistantTasks/globalProject/preConfigTasks/alldone-team-<app>--<tool>`,
marked `externalSource`), so a person launches the tool from the assistant; the pages switch to embed
mode inside alldone.app by themselves. Adding the specialist copies them, `templateSync` carries
later changes and removals into existing copies, and tasks an administrator adds to the template by
hand are left alone. Only alldone.team URLs are accepted, because IframeModal hands the framed origin
the person's alldone.app token.

Each specialist's tools come from ONE managed MCP server entry: alldone.team/mcp with
`authType: 'alldone_app'`, so every call runs as the person talking to the assistant (their own
alldone.team data, their Gold per action) and no token is stored on the assistant, plus
`appIds: [family]`, so Connor sees only Story Builder's tools. `serverAllowsMcpTool`
(`functions/Assistant/mcpAppGroups.js`) applies that filter to assistant runs and to MCP app views
alike. The entry carries `managedBy: 'alldone.team'` (`functions/Assistants/managedMcpServers.js`):
it always follows the template in `templateSync` (a server a copy added next to it is kept and
never turns a template change into a review conflict), the connect/disconnect callables refuse to
touch it, and the MCP servers modal shows it without remove or on/off controls. Pinned by
`alldoneTeamSpecialists.test.js`, the specialist block of `templateSync.test.js`,
`mcpAppGroups.test.js`, `mcpAppViews.test.js`, `mcpAssistantConnect.test.js` and
`components/UIComponents/FloatModals/AddAssistantModal/specialistTemplates.test.js`.

### Goals, milestones and OKRs can be written by assistants and MCP clients (AT-53)

Five tools follow the create_task/update_task pattern: `create_goal`, `update_goal`,
`update_milestone`, `create_okr` and `update_okr`. Each is its own Tools Access key (default on, like
create_task) and its own switch under Settings → MCP. The logic lives in
`functions/Goals/goalToolService.js` and `functions/OKRs/okrToolService.js`. `executeToolNatively`
only resolves the project (named in the call, else the conversation's, else over MCP the user's
default) and returns a refused or ambiguous request as `success: false` with the candidates.
Existing assistants keep their stored `allowedTools`, so they get the keys only through their Tools
Access or `update_assistant` with `addTools`.

**A fixed milestone is not an object of its own; it is the date goals point to.** The app creates an
open milestone when a goal gets a completion date nobody uses yet and deletes it once no goal points
there. The tools do the same, which is why there is no `create_milestone`: a goal's `milestoneDate`
creates the milestone, and `update_milestone` renames it, moves it with its goals (merging when the
new day already has one), or marks it done or open through the same
`executeMilestoneDoneTransition` the app calls. A done milestone and an automatic (linear) one are
not moved.

**Days are matched by a window, never by timestamp equality.** The app stores a milestone at the
local noon of the browser that created it, while `users/{uid}.timezone` is often a stale integer
offset, so the noon the server computes can be an hour or two off. An equality match would give the
same day two milestones. The tools look for an open fixed milestone within half a day of the
computed noon, and the goal then takes that milestone's exact timestamp, because every reader
compares `completionMilestoneDate == milestone.date`.

Rules taken over from the app: moving a goal's milestone date moves the whole goal when it sat in
one milestone, came from someday or would otherwise start after it ends. Sort indexes are added for
every open milestone the goal now shows in. A private goal cannot gain an assignee here, because the
privacy cascade to its tasks, chat and note stays in the app. A goal or OKR create that finds the
same name (OKR: same label in the same period) returns the existing one with `alreadyExists`, so an
agent's retry does not duplicate it.

OKRs are personal, so the tools create them for the requester and refuse to change anybody else's.
A `timeLoggedRevenue` OKR computes its value from logged time, so setting one is refused. The goal
title and progress feeds existed only in the browser (`goalUpdates.js`); their server copies in
`Feeds/goalsFeeds.js` use the same feed types (81, 86) and texts.

`update_goal` takes a `comment`, alone or next to other changes, written by
`shared/objectCommentService.js` (see the next section). Pinned by `goalToolService.test.js`,
`okrToolService.test.js` (both on `functions/Tests/fakeFirestore.js`) and the `goal, milestone and
OKR tools` block in `assistantHelper.test.js`.

### Comments, deletes and sharing for contacts and artifacts over MCP

`update_goal`, `update_contact` and `update_artifact` take a `comment`, alone or next to other
changes. All three go through `shared/objectCommentService.js`, the counterpart of
`TaskCommentService` for other object types (one entry per type in `OBJECT_COMMENT_TYPES`). The
comment, the object's `commentsData`, the chat object and `followers/{p}/{type}/{id}` are written in
one transaction, then the unread markers, the email digest and the push follow. The object's own
people follow its thread: a goal's creator and assignees (never the `ws@` placeholder), a contact's
`recorderUserId`, an artifact's owner and creator. A private object notifies only the people in its
`isPublicFor`; when the field is missing the default is the one `mapContactData` and
`buildArtifactIsPublicFor` use (project plus recorder or owner). Use a null check rather than
`filter(Boolean)` for these defaults, because `FEED_PUBLIC_FOR_ALL` is 0. The notification rule is
update_task's: an assistant's comment is `silent`, and an MCP client's comment carries the marker and
notifies the user too. A comment that fails after other changes were saved becomes a warning; a
comment sent alone fails the call.

`delete_contact` and `delete_artifact` are separate Tools Access keys in `OPT_IN_ONLY_TOOLS`, so an
assistant deletes only after its owner switched that on; the `artifacts` toggle does not grant
`delete_artifact`. Over MCP each is its own switch under Settings → MCP. Both delete only the
document, as the app does: `onDeleteContactSecondGen` and `onDeleteArtifactSecondGen` remove the
thread, note, photos, versions, public link and backlinks. `delete_contact` takes an exact
`contactId` only, because update_contact's fuzzy name matching must never pick the person to delete,
and writes the app's "deleted relevant person" entry (ported to `Feeds/contactsFeeds.js`) before the
document goes, since the feed object is loaded from it. `get_contacts` takes `contactStatus` (id or
name, `none` for no status), applied before the limit.

`update_artifact` can also restore an earlier version (`restoreVersion`, not combined with new
content), change who sees it (`isPrivate`) and switch its public link (`publicLink: on|off|new`,
through `setArtifactPublicLink`). These follow the app: only the owner changes privacy (the chat
follows, and the update trigger withdraws the public link of an artifact made private), while any
member who can see the artifact may switch the link or delete it. A private artifact never gets a
link. Pinned by `shared/objectCommentService.test.js`, `Contacts/contactDeleteService.test.js`, the
contact status case in `ContactRetrievalService.test.js`, the `update_artifact beyond content` and
`delete_artifact` blocks in `artifactAssistant.test.js`, and the contact and artifact cases in
`assistantHelper.test.js`.

### Assistant memory is private to the user (NV-20)

What the assistant remembers about a user (`update_user_memory`, injected as "User memory for this
project") lives in `assistantMemories/{uid}__{projectId}` (`functions/Assistant/userMemoryHelper.js`).
The collection has no client rule, so only Cloud Functions read or write it. It used to be the user's
per-project profile note (`users/{uid}.noteIdsByProject`), which every project member can read and
edit: a teammate could plant instructions into another member's system context, and facts the
assistant remembered from private threads were readable by the whole project. Never read that note
as memory again, and do not write memory into it.

Browsers reach the memory only through `getAssistantMemorySecondGen` / `updateAssistantMemorySecondGen`.
The owner sees and edits their memory in the "Assistant memory" panel above the profile Note tab
(`components/UserDetailedView/AssistantMemoryPanel.js`) and can switch on "show my assistant memory
in my profile note". Other members then see it there read-only. The text is served by the callable
and never copied into the note, because anything in the note is editable by everyone. Members of the
project only: a viewer of a link-shared project sees nothing. A memory write produces no feed entry.
The stored text keeps its newest 20,000 characters, and the run sees the newest 10,000. Existing
memory lines are moved out of profile notes by `migration/moveUserMemoryToPrivateStore.js` (dry run
by default; its header lists the risks). Pinned by `userMemoryHelper.test.js`,
`userMemoryMigration.test.js` and `AssistantMemoryPanel.test.js`.

### A scheduled assistant task needs no approval of its content (decision 2026-11-09)

Any project member, and the user's own assistants, may change a project assistant task's prompt,
system instruction, model and settings, and a scheduled run then acts as the user who activated it
(their Gold, tools and connected accounts). That is deliberate: a user trusts the members of their
projects and their own assistants. The security audit's NEW-A binding (an approved content hash per
user, a paused run plus a notice after somebody else's edit, and a confirmation before a manual run
of unapproved content) was removed on 2026-11-09 for that reason; do not reintroduce it without asking.
Documents written while it was live may still carry `approvedContentHashByUser` and
`contentApprovalNoticeByUser`; nothing reads them.

### Server fan-outs and public endpoints trust nothing the client wrote (security audit 2026-11)

Follower lists are member-writable and outlive membership, so `TaskCommentService`,
`ObjectCommentService`, the VM completion path and the chat email sender intersect recipients with
`projects/{id}.userIds` (`shared/projectMemberRecipients.js`); removing a member also cleans the
project's `followers` documents. `/api/booking/book` is rate limited per IP, page and recipient
(`Booking/bookingRateLimit.js`, server-only `bookingRateLimits`, hashed ids; give it a TTL policy on
`expiresAt`) and its visitor mail has a fixed subject and no echoed note. Chat media are fetched only
from this project's Storage bucket, without redirects (`shared/storageMediaUrl.js`).

### Assistant Tool Checklist

When adding a new assistant tool, wire every layer, not just the backend schema:

- Define the schema in `functions/Assistant/toolSchemas.js` and add/adjust `functions/Assistant/toolSchemas.test.js`.
- Implement native execution in `functions/Assistant/assistantHelper.js`, including permission/runtime-context checks, conversation-safe results, and focused tests in `functions/Assistant/assistantHelper.test.js`.
- Add the tool to the assistant settings UI in `components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js` so it can be enabled per assistant. Decide deliberately whether it belongs in `DEFAULT_ALLOWED_TOOLS` or `OPT_IN_ONLY_TOOLS`, then cover that in `toolOptions.test.js`.
- Add local strings for the tool label in `i18n/translations/en.json`, `de.json`, and `es.json`.
- Check channel-specific allowlists before assuming the tool is available everywhere. Gmail labeling follow-up only gets `GMAIL_POST_LABEL_SAFE_TOOLS` (`functions/Gmail/gmailPostLabelTools.js`); email replies and realtime/WhatsApp flows may have separate safe-tool filters or schema adapters.
- If prompts mention the tool, ensure the responsible assistant can actually enable it in Tools Access; otherwise the prompt can ask for an action the runtime will block.
- Offer it over MCP too (next section): add the name to `MCP_DELEGATED_ASSISTANT_TOOLS` in `functions/MCP/mcpServerSimple.js` and to `MCP_TOOL_KEYS` in `components/SettingsView/MCP/MCPSettings.js`, and make it work without an assistant. Leave it off MCP only with a reason in the list below.

### MCP and assistant tools offer the same features, on the same code

**Rule:** every capability an MCP client has, an assistant has, and the other way round, and both
run the same implementation. A tool that exists on one side only needs a written reason in the list
below; "nobody asked for it yet" is not one. Before adding or changing a tool on either side, check
the other side and do both in one change.

**How the code is shared.** An assistant tool runs in `executeToolNatively`
(`functions/Assistant/assistantHelper.js`), and MCP serves it through the same function with
`assistantId = null` (`MCP_DELEGATED_ASSISTANT_TOOLS`). A tool that started on MCP keeps its handler in
a module both sides call; `functions/Assistant/assistantTaskTools.js` is the pattern: one schema
definition (MCP gets it as is, assistants with `projectId`/`assistantId` optional and defaulting to
themselves), one handler (`mcpWorkspaceSetupTools.js`), one Tools Access key for assistants
(`assistant_tasks`), and an actor marker that says who acted (`via: 'mcp'` with the client, or
`via: 'assistant'` with the assistant). Three things to get right when a tool reaches the other side:

- **A check of the assistant's own Tools Access inside a tool** must let an assistant-less MCP call
  through, because the per-user switch under Settings → MCP already gated it
  (`assertAssistantOwnToolPermitted`).
- **"The current project" or "the current assistant"** means the thread's for an assistant; MCP falls
  back to the user's default project, which is a guess. Where a guess would write to the wrong place
  (`update_project_description`), MCP requires the project explicitly; the schema note is in
  `MCP_DESCRIPTION_NOTES`.
- **Authorship:** over MCP a write is the user's own, marked with the client (`getActorChannelFields`),
  never the assistant's. `add_chat_comment` shows the shape: user as author, no
  `lastAssistantCommentData` pointers.

**Where each capability lives (2026-11-09).** Shared modules, both surfaces:

- **Workspace setup and scheduled tasks** (`Assistant/workspaceToolsForAssistants.js`): MCP's
  `create_project`, `add_contact_statuses`, `create_assistant` (Tools Access key `workspace_setup`)
  and `create/get/update_assistant_task` (`assistant_tasks`) run the handlers in
  `mcpWorkspaceSetupTools.js` for an assistant too, defaulting to its own project and itself.
- **Assistant settings** (`Assistant/assistantSettingsService.js`): the assistant tool
  `update_assistant_settings` and MCP's `update_assistant` validate and save the same fields
  (name, description, instructions with history, model, temperature, voice, delegation description,
  project assistant) and pass changed instructions on to the scheduled tasks still on the old copy.
  **Tools Access is the one exception: only the user changes it (app or MCP), never an assistant,
  for itself or another** (`assertNoToolAccessFromAssistant`; `create_assistant` offers an assistant
  no `allowedTools`), so instructions hidden in an email or a web page cannot make an assistant grant
  itself new powers. `update_heartbeat_settings` is served over MCP for an assistant the client names.
- **Assistant pictures** (`Assistant/assistantPhoto.js`): `update_assistant`, `create_assistant` and
  `update_assistant_settings` take `photoUrl` (a public image URL; `""` removes the picture) or
  `photoArtifactId` (an image artifact the user can read, read through `readArtifactFileForUser`, the
  same reader as artifact mail attachments; the artifact tools themselves write text only, so an image
  artifact comes from an upload or a VM job). The server downloads the bytes, accepts only what its
  magic bytes say is JPEG, PNG, GIF or WebP (no SVG: it can carry script), at most 5 MB, and stores its
  own public copy at `assistants/{projectId}/{assistantId}/`, where the app's avatar upload puts it.
  Without an image library all three sizes (`photoURL`, `photoURL50`, `photoURL300`) get that one copy,
  as for contact photos, which is why the limit is half the contact one. The image is checked before
  any quota is spent and stored only once the write happens. Unlike the app's upload, no "changed
  picture" feed is written, the same as for every other `update_assistant` change.
- **VM jobs over MCP**: `execute_task_in_vm` and `get_vm_job` run as the **project assistant**
  (`MCP_TOOLS_RUN_BY_THE_PROJECT_ASSISTANT`), in a new task of that project; a project without an
  assistant gets an error that says how to set one.
- **Asking an assistant**: assistants have `talk_to_assistant`; MCP has `ask_assistant`
  (`MCP/mcpAskAssistant.js`). It posts the question as the user's comment in a task or topic thread
  with `assistantRunRequest` and starts the server-side run at once through the missed-run path
  (`enqueueMissedAssistantRunCheck` with `delaySeconds: 0`), so the run is the ordinary one: the
  assistant's model and tools, the user's Gold, the per-message run lock. It waits for that lock to
  settle (at most 120s) and returns the answer, or the thread and `waitForCommentId` to keep waiting.
- **Wiki documents**: `add_knowledge_document` takes a file of this conversation, a file of a thread
  the caller names (`threadObjectType`/`threadObjectId`, access-checked), an artifact (`artifactId`,
  its current version's text, if the user can read it) or `text`. The same tool on both surfaces.
- **Skills**: `load_skill` over MCP works on the project assistant (or a named one); without a name
  it lists the skills.

**One-sided on purpose:** `compact_thread_context` (an assistant's own thread context),
`external_tools` and `mcp_servers` (integrations configured on an assistant), `get_current_user_info`
and `delete_authentication_data` (MCP sign-in; an assistant already knows its user). `talk_to_assistant`
and `ask_assistant` are one capability with a different shape per surface.

### Browsing (`browser_*`) — the classification runs on the PAGE, not on the tool call

`fetch_url` reads a page's HTML; the six `browser_*` tools OPEN one in a real browser
(`functions/Assistant/browser/` for the policy half, `functions/Assistant/browser-worker/` for the
Playwright half, deployed as its own Cloud Run service). They exist for the questions a plain read
cannot answer — a client-rendered event page, a date picker, "are there still tickets" — and they are
one Tools Access key (`browser_automation`, opt-in only) that `getToolSchemas` fans out into six tool
names. **Workers are configured in staging and production (2026-10-07)**. Each environment has
its own IAM-private `browser-worker` Cloud Run service and matching `BROWSER_WORKER_URL` /
`BROWSER_WORKER_SIGNING_SECRET` in its GitLab Functions environment. The Firebase Admin SDK service
account has service-scoped `roles/run.invoker`. Browsing still requires the assistant toggle and a
project website policy: `selected` needs an allowlist, while `all_public` allows public websites.
The shared assistant workspace watches this same browser through `annaBrowserWorkspaceSecondGen`;
it refreshes screenshots every five seconds and supports user takeover and explicit hand-back.
Interactive login is owned by `AnnaShell` through `AnnaBrowserTakeoverContext` and rendered in the
browser pane. The approval card retains only a reopen shortcut. Keep the login controller mounted
across chat navigation and pane changes; pause the ordinary viewer and never let a chat send release
the login session. Outside this shell the approval card still supports inline takeover.
See `docs/anna-workspace.md` for deployment and verification.

****Two access modes, and `all_public` skips exactly ONE check.** `selected` (the default) needs an
allowlist match; `all_public` is opt-in per project and does not consult the allowlist at all.
Everything before that last question is unconditional in both: http(s) only, no credentials in the
URL, no IP literals, no loopback / private / link-local / CGNAT / IPv6-ULA, no cloud metadata hosts,
no single-label or `.internal` / `.local` names, and a denylist that is checked BEFORE the mode so it
means the same thing in both. An unrecognised stored value reads as `selected` — the fail-closed
direction, implemented identically in `normalizeAccessMode` (server) and `normalizeBrowserAccessMode`
(editor) and pinned by `browserAllowlistParity.test.js`. The mode is **not a client claim**: it is
read from the project document, folded into one policy object, and travels to the worker inside the
HMAC-signed token, so editing it breaks the signature.

**A redirect hop does not pass through the route handler, and that was a real gap.** Playwright's
`route.continue()` makes Chromium follow a 3xx internally and interception is not re-run for the new
request (verified with a probe against 1.49) — so until AT-2518's second pass, only the LANDING url
was checked, and a chain that went through an internal host and back out to a permitted one would
have completed with the internal page fetched and rendered. `ensureNetworkGuard` now also listens on
the `request` event, which does fire per hop, records a hop that is not permitted, and the action
functions fail the whole navigation on it. What it still cannot do is stop that hop's request from
being issued — no Playwright API can — which is why restricted egress on the worker is a required
deployment step rather than a nice-to-have. A failed navigation now also parks the page on
`about:blank`, because Chromium's error page commits asynchronously and otherwise interrupts the
NEXT navigation.

The bypass this design exists to close is that `click` and `type` can perform a purchase, a login
or a deletion without naming any of them.** A gate reading the model's own description of what it is
about to do is therefore worthless — the model would only have to call a Buy button "the green
button". So `browserSession.js` enforces the ordering **observe → classify → approve → act**: for a
click or a type the worker is first asked to `describe` the element (resolve it in the live DOM,
report role, accessible name, input type, the enclosing form's method and action, and the labels of
that form's submit controls) **without touching it**, and `browserPolicy.js` classifies that. Nothing
model-authored is an input to the decision, and an element that cannot be resolved is a refusal
rather than an unclassified click. Categories that always pause: login, file upload, booking,
payment, submit/publish, delete, external message — matched in en/de/es, and an **unrecognised form
submission is `submit_publish`, i.e. it pauses too**. The single carve-out is a GET form with
search-shaped fields (`search_submit`), because without it the feature cannot answer the question it
was built for; it never applies when a sensitive category also matched.

**An approval answers ONE question.** A grant is keyed on a signature over
(action, category, host, element shape), is created only by `respondToBrowserApprovalSecondGen`, only
by the user the request was raised for, defaults to single use, expires in 15 minutes and never
outlives the run — so "yes, book that table" can never be replayed as "yes, delete the account". A
denial sticks for the rest of the run, because otherwise the model re-asks in a loop until the user
clicks the wrong button. `BrowserApprovalCard` renders the pending request under the assistant
comment that asked for it — the same card and the same three answers as `VmInteractionCard`, keyed to
that comment by `assistantCommentId` — and reads it over a live listener on `browserApprovals`, which
is readable only by the user it was raised for and writable by nobody. **"Allow for this run" is a
POLICY decision** (`RUN_SCOPED_APPROVAL_CATEGORIES`: yes for `submit_publish` and `booking`, no for
login, payment, delete, upload and external message), and `respondToBrowserApproval` downgrades a
run-scoped answer to single use for the rest whatever the client asked — a hidden button is a hint,
not a control. The assistant's turn has already ended by the time it asks (unlike a VM run, which
parks and is still alive), so the card says to ask it to continue rather than pretending to resume.

**The billed unit is one EXECUTED step at 1 Gold**, the same unit and price as `mcp_tool_call`.
A step the policy refused, a step that paused for an approval, a step the worker failed and a step
refused by the budget are all **free** — billing a user for the protection working is how a
protection gets switched off, and a paused action is attempted again after the answer, so charging
both attempts would double-charge one decision. Idempotency is structural: the step id is minted once
inside the transaction that hands the step out and is the ledger's idempotency key
(`deductGold` now forwards `context.idempotencyKey`, exactly as `refundGold` already did). The
balance is checked BEFORE the browser is touched — acting first and finding an empty balance
afterwards performs something on a third-party site that Alldone then cannot bill — and that check
fails open, since the charge itself still uses `requireSufficientBalance`.

Three more things worth knowing. The **budget is charged in the same Firestore transaction that hands
out the step** and lives on the run document — a budget held in a Functions instance means "per
instance", and two tool calls racing in one thread would each see the last navigation as free. The
worker token **carries the allowlist and the limits** (`browserWorkerClient.js`), so the worker
enforces redirects and page-initiated navigations at the network layer — where Functions cannot see
them — without ever deciding what the allowlist is. And redaction is **two-sided on purpose**:
credentials are stripped from what the model sees, credentials _and_ PII from what the audit trail
keeps, and typed text is never persisted at all (`describeTypedValue` keeps a length and a shape).
Redacting page content on the way to the model would delete the answer the user asked for.

**The allowlist has an editor, reached from the tool row that needs it, and it is where the mode is
chosen** (off / only selected websites / all public websites, in that order of risk, with a warning
under the third that says both what changes and what does not). Ticking "Browse a website"
and finding that nothing works — because the list is empty and default deny — is the dead end the
row exists to prevent, so the Tools Access modal shows `Allowed websites (N)` under the checked box
and hands over to `BrowserAllowlistModal` **sequentially** (close, then open: a nested
react-tiny-popover treats a tap in the child as an outside click of the parent). The list is stored
per PROJECT (`projects/{id}.browserAutomation`) because two assistants in one project must not
disagree about which sites may be opened. Its validator exists twice — `utils/browserAllowlistInput.js`
for the editor, `browserAllowlist.js` for the policy — because Functions code cannot enter the web
bundle; the contract is one-directional and ratcheted by `browserAllowlistParity.test.js`: anything
the editor accepts, the server accepts and normalizes identically, and anything the server rejects
the editor rejects (the editor may be stricter, e.g. about `ftp://`).

Pinned by the ten suites in `functions/Assistant/browser/`, the two web suites
(`BrowserApprovalCard.test.js`, `BrowserAllowlistModal.test.js`) and `browser-tests/at2518` — the
only place Playwright actually runs. Configuration, enabling steps, the threat model, the Gold model
and the open items (deployment, worker egress, price review) are in
`functions/Assistant/browser/README.md`.

### App shell scrolling (sidebar vs. main content)

The web shell must keep a **definite** height: `html, body, #root { height: 100% }` in
`web-bundler/index.html` (deployed) and `web/index.html` (legacy template). react-navigation
used to supply that height — every screen lived in an absolutely-positioned card — and
migration Stage 2 deleted it, so for a while the shell only had `min-height: 100%`. With no
definite height every `flex: 1` box grows to its content, the inner `CustomScrollView`s
(sidebar body, `MainViewsContainer`, each DetailedView) stop scrolling internally, and the
**document becomes the only scroller**: scrolling the main content then drags the sidebar
navigation and the top bar off-screen (AT-2177), and popovers need scroll-offset hacks
(`getScrollOffsets` in `utils/HelperFunctions.js` is a leftover of that era). Keep
`body { overflow-y: auto }` as the safety valve for a screen with no inner scroller, and keep
`box-sizing: border-box` so the safe-area padding cannot push the shell past 100%.
`__tests__/WebShellScrollContainers.test.js` guards the rule in both templates.

**iOS standalone PWA safe areas (AT-2314)**: both HTML templates keep
`viewport-fit=cover`, the Apple standalone metadata and a light/default status bar, and
pad all four body edges with `env(safe-area-inset-*)`. Never reintroduce the old iOS-only
black `body` background: it was exactly what painted the top and bottom PWA bars black.
Fixed portal content does not inherit body padding. `hooks/useModalSizing.js` therefore
subtracts the measured safe-area rectangle as well as the keyboard, the bottom sheet
paints through the home-indicator region while padding its content above it, and the
vendored `react-tiny-popover` clamps anchored/fixed portals inside the safe rectangle.
The sheet's upward handle over-drag is limited by its remaining top clearance, so a
full-height sheet cannot be pulled into the status/header safe area.
Browsers without safe-area insets resolve every value to zero, preserving desktop,
Android and ordinary mobile-browser geometry. Keep the deployed `web-bundler/` and legacy
`web/` templates/manifests aligned; `__tests__/WebShellScrollContainers.test.js`,
`utils/safeAreaInsets.test.js`, `hooks/useModalSizing.test.js`, and the modal/popover suites
pin the contract.

**Every other popup sizes itself through `utils/modalSafeArea.js` (AT-2339).** AT-2314
above only reached the two surfaces built on `useModalSizing` — the bottom sheet and the
comment popup — because it fixed **position**, not **height**. The vendored popover patch
nudges a portal into the safe rectangle, but a card taller than that rectangle simply
overflows the opposite edge once its top is clamped, and **~10 call sites pass
`disableReposition`, which skips that nudge entirely** (the comment popup is one; it reads
correctly only because `popoverToTop` pins it at a hard 80px). Everything else measured
against the raw window: ~75 popover-content modals capped at `windowHeight -
MODAL_MAX_HEIGHT_GAP`, and the centred `position: fixed` overlay family capped in percent
— `maxHeight: '90%'` is a ~42px top gap on an 844pt iPhone against a 47px inset, which is
how the "new day" popup (`EndDayStatisticsModal`) ended up under the Dynamic Island.

The module is the single authority for popup geometry: `getSafeAreaModalMaxHeight`
(the drop-in for `height - MODAL_MAX_HEIGHT_GAP`), `getSafeAreaModalMaxWidth` (now behind
`applyPopoverWidth`, so the landscape cutout no longer makes a "full width" card overhang),
`getSafeAreaModalMaxHeightBelow` (the mentions dropdown — its top offset is **already** a
clamped viewport coordinate, so subtracting the top inset again would double-count it) and
`getSafeAreaOverlayPadding` via `hooks/useSafeAreaOverlayPadding.js`.

Two rules that are easy to get wrong. **Overlay padding goes on the overlay, never on the
card** — a percentage `max-height` resolves against the containing block's CONTENT box, so
padding the inset-0 centring parent is exactly what makes the family's existing
`'90%'`/`'94%'` caps correct with no per-modal retuning; padding the card would instead
shrink its content. And the padding uses **minimum semantics, `max(existingGap, inset)`,
not additive** — that is what makes the sweep provably non-regressive: a dialog whose gap
already clears the system UI does not move a pixel, so the comment popup's 80px offset is
byte-identical to before and only gains a horizontal clamp. Additive would have shoved the
one surface that was signed off as correct 47px down the screen.

**Minimum semantics are for gaps measured from the SCREEN edge; an offset measured from
the CONTENT area is additive instead.** The two header project switchers pin themselves at
a literal `{ top: 60, left: 16 }` _and_ pass `disableReposition`, so nothing clamps them at
all. But `60` was measured against the app header, and the shell already pads `body` with
`env(safe-area-inset-*)` — so the header starts at `insets.top` while a `position: fixed`
portal does not inherit that padding. `max(60, 59)` would leave one pixel of clearance
under a Dynamic Island; `offsetPopoverInsideSafeArea` (`utils/popoverPositioning.js`)
therefore ADDS the inset and then clamps, so the offset cannot push a tall popover off the
bottom. Getting this backwards is silent — it looks fixed and is still one pixel wrong.

A second sweep covered the spellings the first codemod could not see, and each needed its
own ratchet: a cap re-derived from a local constant (`windowHeight - MODAL_VERTICAL_MARGIN

- 2`, where that constant is exactly the 32 of `MODAL_SAFE_AREA_GAP`—`ConnectRepoModal`even called the inset-aware`useModalSizing`and then discarded its`maxHeight`), a raw
`vh`unit (a fraction of the RAW viewport, blind to the insets — use`getSafeAreaViewportHeightCap`), and a literal `contentLocation` coordinate pair. Treat
  "the guardrail is green" as meaning only "no file matches the idioms we already know";
  the misses were found by auditing for the geometry, not by grepping for the pattern.

The hook exists rather than a bare function call because these dialogs subscribe to redux,
not to the viewport: without its `useWindowSize()` a rotation would leave a landscape
overlay padded with the portrait insets. `__tests__/PopupSafeAreaGuardrails.test.js`
ratchets the whole thing — no component may subtract the raw gap from a window height
again, and every overlay-family member must apply the shared padding **last** in its style
array (first would let the static `paddingTop` it is meant to override win). Note the
`react-tiny-popover` ratchet in `__tests__/ModalSystemGuardrails.test.js` is a **substring**
match over file sources, so even naming the package in a comment counts as a new importer.

**"Open view in new window" cannot reach a browser tab from an installed PWA without an
out-of-scope hop (AT-2345).** The top-right button in every detailed view
(`OpenInNewWindowButton`, plus `OpenInNewWindowModalItem` in the more-menus) was a bare
`window.open(window.location, '_blank')`. That is correct in a browser tab and wrong in an
installed app window: Chromium and WebKit both keep a navigation whose target falls inside
the app's **manifest scope** inside the app, so the click spawns a second PWA window. Neither
manifest declares a `scope`, so it defaults to the `start_url` directory (`/`) — the whole
origin — and every Alldone URL is in scope. Nothing changed in the button; the app only
recently became a _genuinely installable_ desktop PWA (the web-bundler manifest became the
deployed pipeline on 2026-08-04, then the workbox service worker landed with offline support),
and before that a macOS "app" was a plain shortcut window that delegated `_blank` to the
browser. **No web API overrides the scope decision** — the only lever the page has is making
the destination out-of-scope. `utils/openInNewWindow.js` therefore opens the
`openInBrowserTab` Cloud Function (`functions/WebApp/openInBrowserTab.js`, on
`*.cloudfunctions.net`, a different origin and so unambiguously out of scope), which 302s to
the real URL; the browser opens the out-of-scope target in a normal tab and follows the
redirect there. Three carve-outs are deliberate and load-bearing: an ordinary browser tab
keeps the direct `window.open` (no hop, no dependency on the redirector being reachable);
**iOS/iPadOS home-screen apps keep it too** (`navigator.standalone === true` — there `_blank`
already hands the URL to the browser, so the bounce would only add a failure mode); and every
way of failing to build the bounce falls back to the direct call, so the button can never
become a no-op. The redirector is an open-redirect by construction, hence the explicit host
allowlist (`isAllowedRedirectTarget`) — anything not an Alldone origin is 400, never
redirected to. `window.open` must stay **synchronous** in the click handler on every path or
desktop popup blockers eat it. Pinned by `utils/openInNewWindow.test.js` and
`functions/WebApp/openInBrowserTab.test.js`. Note the browser, not the app, has the last
word: if a future Chromium re-captures redirect chains back into the app window, the result
degrades to today's behaviour rather than breaking.

### Offline support (OFFLINE_SUPPORT_PLAN.md — all 8 stages shipped 2026-08-17)

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

### Modals and Popups

Handle event propagation carefully. Set proper z-index and container `<div>` elements.

**A `document`-level keydown listener never sees a key while a react-native-web `TextInput` has focus (AT-2257).** `TextInput.handleKeyDown` opens with an unconditional `e.stopPropagation()` ("Prevent key events bubbling", upstream react-native-web #612), and React 18 attaches its synthetic listeners at the **root container**, not at `document` — so stopping propagation there kills the **native** event while it is still inside the app tree. Every Escape-to-close handler in this codebase was registered on `document` or `window` in the **bubble** phase: ~116 hand-rolled `document.addEventListener('keydown', …)` sites, `react-dismissible`'s `escape` prop (`keyCode === 27`), `react-tiny-popover`'s `onKeyDown` (window) and `react-hot-keys`/hotkeys-js. All of them were dead whenever a field had focus, which for a modal that autofocuses its input is **always** — the global search modal's `if (key === 'Escape') hidePopup()` was written in 2021 and had never once run in production. The failure is invisible rather than loud: the code reads correctly, and it works the moment you blur the field, which is exactly what you do when you go looking for the bug.

The fix is the **phase**, not the handler. `utils/escapeStack.js` installs ONE `keydown` listener on `document` in the **capture** phase (installed from `AppNavigator`'s `AppContainer`, the one component that mounts once for the whole app and already owns the app's document-level listeners). Capture runs on the way down, before the event reaches the input, so nothing downstream can swallow it. Two things sit on top: a **LIFO stack** for components that opt in via `hooks/useEscapeKey.js` — the most recently mounted layer gets the key, which is what makes a picker opened inside a modal close itself and leave the modal up, and what a bubble-phase `document` listener structurally cannot do (`stopPropagation` does not stop a **sibling** listener on the same node, so the picker and the modal underneath both closed on one keypress) — and a **legacy bridge** for the ~116 popups that are not on the stack: if the event never completes its trip to `document`, it was swallowed, so an equivalent Escape is re-emitted there. Detection is behavioural (a second listener on the document **bubble** phase records arrival), not a guess about which widget swallows what, so the bridge is self-limiting: the day react-native-web stops calling `stopPropagation` it goes quiet on its own, and it never double-fires. Three things it deliberately keeps its hands off, because they own Escape themselves: an in-progress IME composition, a native `<select>`, and Quill's open toolbar picker (`.ql-expanded` — the same selector `GeneralAppShortcuts.openGloablSearchModal` already gates on). It also never calls `preventDefault()`; Escape has real browser-level meaning and the popups only ever wanted to close themselves. **Do not fix this by re-vendoring react-native-web** — that patch was retired on purpose in migration Stage 2. Pinned by `utils/escapeStack.test.js`, `hooks/useEscapeKey.test.js` and `browser-tests/at2257` (a real browser is required: in jsdom every layer involved would be a double, and the defect lives in how they compose).

**Chat message edit dismiss race**: In `components/ChatsView/ChatDV/EditorView/MessageItem.js`, opening the per-message edit `DismissibleItem` directly from the timestamp/pencil click can mount `react-dismissible` early enough that the same click is interpreted as an outside-dismiss click. Symptoms: the edit handler fires, `openModal()` runs, `onToggleModal(true)` is immediately followed by `onToggleModal(false)`, and nothing appears on screen. Defer the `openModal(true)` call with `setTimeout(..., 0)` after dispatching `setActiveChatMessageId(message.id)`, and clear the timeout on unmount. If diagnosing this path, use scoped logs around `MessageItemHeader` click handling, `enableEditMode`, and `MessageItemContent`'s `onToggleModal`.

**Modal system (target state — MODAL_IMPROVEMENT_PLAN.md)**: new/migrated popups size
themselves through `hooks/useModalSizing.js` + the tokens in `components/styles/modals.js`
(width scale S/M/L/XL, `MODAL_EDGE_GAP` 16/side, `MODAL_SHEET_BREAKPOINT` 640 — a **pure
window-width** mobile check, unlike `smallScreenNavigation` which flips at 818/611 depending
on `loggedUser.sidebarExpanded`). The hook is reactive (resize + visualViewport) and
**keyboard-aware**: it subtracts the visual-viewport keyboard inset from `maxHeight`,
because popover portals are `position: fixed` and the app shell's `--app-keyboard-inset`
shrink cannot move them (iOS never resizes the layout viewport for the keyboard). The
`contentLocation={mobile ? null : undefined}` idiom has a named home:
`nudgeIntoViewportWhen` in `utils/popoverPositioning.js` (`null` is `typeof 'object'`, which
makes the vendored react-tiny-popover skip its position-flip search — pinned by
`__tests__/ModalSystemGuardrails.test.js`, which also ratchets direct `react-tiny-popover`
imports: the count may only go down; build new popups on the shared system instead).

**ModalShell (Phase 2)**: `components/UIComponents/ModalShell/AppPopover.js` is the drop-in
replacement for a direct `<Popover>` — desktop renders the vendored react-tiny-popover
unchanged (all props pass through); below `MODAL_SHEET_BREAKPOINT` the content renders as
`BottomSheet.js`: a full-width bottom sheet portal with scrim, bounded bidirectional handle
dragging, distance/velocity swipe-down dismissal, snap-back motion (reduced-motion aware),
document scroll lock (`utils/bodyScrollLock.js`), safe-area padding
(`utils/safeAreaInsets.js` — env() measured via probe, CSS can't reach fixed portals),
keyboard-riding (`bottom: keyboardInset`), Escape via `useEscapeKey` (LIFO — a nested sheet
closes first), and the AT-2236 mount-grace + dismiss-replay guards baked in. **Sheet
dismissal is its own backdrop element, not a window click listener**, so taps in nested
portals can structurally never dismiss the parent (the EmailLabelChip/RichCommentModal bug
class). Sheet close is synchronous by design — wrappers unmount the subtree on close, so an
exit animation could never play (and RNW Animated completion callbacks don't fire under
jsdom); slide-out polish is Phase 5. The sheet card is `colors.Secondary400`, matching the
FloatModals card color, so existing modal contents render seamlessly inside it without
relinquishing their own chrome (that migration comes per-modal via `ModalShellContext`).
Migrated so far: DueDateButton, EstimationButton, TaskPriorityWrapper, TaskDetailedView
Assignee + ProjectPicker, MorePopupsOfEditModals MoreButtonWrapper.
**The breakpoint may change while a popup is open, but its content tree must not (AT-2607).**
`AppPopover` owns one stable `display: contents` portal container and its desktop/sheet
hosts only move that container in the DOM. This preserves component state, uncontrolled
form state and editor instances while rotation still switches presentation responsively;
the stable portal also provides the current `ModalShellContext`, since a React portal
inherits context from its logical owner rather than its physical DOM parent. Do not put
the content back under the conditional `<Popover>` / `<BottomSheet>` branches. Pinned by
the form-state rotation case in `ModalShell.test.js` and `browser-tests/modalsheet`.
**`PopupDismissSurface` must stand down inside a sheet (AT-2287)**: the surface's
window-capture outside-gesture guard treats the sheet's own chrome (handle strip,
backdrop) as "outside" — it swallowed the handle's `touchstart` at capture (so the
drag never started; "dragging does nothing") and dismissed the popup on release
(so a partial drag closed instead of springing back). The surface now skips
installing the guard when `useModalShellPresentation() === 'sheet'`; the
BottomSheet owns dismissal there (backdrop, Escape, handle drag). Desktop popover
mode is unchanged — there the guard IS the outside-click dismissal. Pinned by
`RichCommentDismissSurface.test.js` ("stands down inside a bottom sheet"). Pinned by
`components/UIComponents/ModalShell/ModalShell.test.js` (jsdom, real guard + escape stack)
and `browser-tests/modalsheet` (real Chromium: touch grace timing, focused-input Escape,
nested LIFO, scroll lock).

**Assistant workspace viewport**: `AnnaShell` measures its Alldone content with
`useWorkspaceViewportOwner`. `utils/workspaceViewport.js` publishes browser-relative
bounds and a deduplicated change event for portals, including the vendored popover.
`useWindowSize`, `useModalSizing`, the safe-area helpers and positioning helpers use
this pane while assistant mode is active, and revert to the whole window on zoom-in.
Keep physical browser sizing (`matchMedia` / `window.innerWidth`) for the assistant
shell itself. `WorkspaceOverlayLayer` gives global dialogs and notifications a fixed
containing block matching the pane; inline fixed overlays get that block from the
workspace's transform. Body portals must keep global coordinates and add the pane's
origin exactly once. Use `WorkspaceModal` for standalone dialogs instead of a native
web Modal that creates a browser-wide portal. Never remount popup content when the
pane changes size: drafts must survive desktop/sheet transitions. Browser coverage:
`browser-tests/anna-workspace` (global and anchored dialogs, notifications, divider
resize, mobile and zoom-in). System status-bar paint remains outside this scope.

**The workspace bezel turns blue only while a tool changes the workspace (AT-2926).** The
blue accent on the frame around the Alldone pane (and its "… is working here" notch) used to
follow any live assistant run, so thinking and a plain streamed answer lit it too. It now
follows `assistantRun.activity.phase === 'tool'` with `changesWorkspace === true` on a live,
non-VM run (`isAnnaWorkspaceChangeRunning` in `annaWorkspaceWorkState.js`); a send in flight
no longer counts. The server stamps `changesWorkspace` from an explicit allowlist of tools that
create or change Alldone objects (`functions/shared/assistantWorkspaceChangeTools.js`: tasks,
notes, contacts, comments, artifacts, project description, wiki). Reads, web/email/calendar,
settings, memory, delegation and VM hand-offs stay grey, and an unknown tool stays grey until it
is added there. A flip inside a mixed batch is published at once from `toolCallBatch`'s
`onState` (deferred one macrotask so two consecutive writes do not flicker), instead of on the
7s progress tick. `composing` and any terminal status clear it. Pinned by
`annaWorkspaceWorkState.test.js`, the AT-2911/AT-2926 case in `AnnaShell.test.js`,
`assistantWorkspaceChangeTools.test.js` and the AT-2926 case in `assistantHelper.test.js`.

**Activity rows open their object, checked first (AT-2906).** Each row's first line is
`Project · Actor(s)`, then title/action chips, then the preview. A row links to the object
(`getAnnaActivityTarget`); a chat message whose thread type was never saved links to its chat
object (`/projects/{p}/chats/{id}/chat`), never to the followed chats inbox. On click
(`data-anna-activity-link`) `AnnaShell` runs `resolveAnnaActivityPath` (one read-only `get`):
a chat object is rewritten to its task/goal/note/contact, and a deleted object, a lost access or
a project this session cannot select shows an inline error instead of the router's silent
fallback to "All projects". Offline/transient errors do not block. Navigations are serialised
(the later of two quick clicks lands last), which is why `processUrlAsLoggedIn` now awaits the
route handler. The crash behind the report: `TasksHelper.getUserInProject` answers `undefined`
(not null) for a project whose members are still loading, `processURLProjectsUserChats` tested
`!== null` and stored `undefined` as `currentUser`, and every `currentUser.uid` reader plus the
members-snapshot reducer threw. Never compare that lookup with `null`; the `Store current user`
reducer now falls back to the logged user. Pinned by `annaActivityNavigation.test.js`,
`__tests__/Chats/ProjectsUserChatsColdProject.test.js` and the AT-2906 blocks of the Anna suites.

**A lost callable response is not a failed message (AT-2921).** The Anna composer starts each run
with `askToBotSecondGen`, and a phone drops that connection when the app goes to the background.
The Firebase callable SDK reports any failed `fetch` (status 0) as `FunctionsError('internal',
'internal')`, so the question showed "internal" + Retry while the server, which logged a 200, had
already written the full answer below it. `useAnnaMessageSends` now judges a dispatched request by
the chat first: a persisted reply with `assistantRun.triggerMessageId === messageId` that is not
`failed` settles it, whatever the transport said, and Retry is refused for it. A transport loss
(`isConnectionLoss` in `annaSubmissionReconciliation.js`, which keeps upper-case `INTERNAL` and
other server-sent errors as real failures) enters `confirming`: a waiting indicator, no error and no
Retry, until a reply arrives. If none arrives within the AT-2848 catch-up window of 120s after the
message was saved, and at least 15s while the page is visible, the hook shows a readable "connection
was interrupted" error. A `failed` reply still offers Retry. Pinned by
`annaSubmissionReconciliation.test.js` and the AT-2921 block of `AnnaConversation.test.js`.

**Holding the Anna composer's microphone sends on release (AT-2929).** The shared mic
(`RambleButton`, AT-2405) decides what a release means: a tap keeps toggle mode and leaves the
transcript in the composer for review, a hold of 400ms or more submits, sliding out of the ring or
recording less than 1s discards. `AnnaConversation` passes `onSubmit={sendDictation}`, which sends
the draft (text typed before plus the transcript) through the ordinary `send()`, so the offline,
Gold, project-switch and voice-call guards apply and a refused send leaves the text in place. Two
details: the mic calls `onSubmit` while its phase is still `processing`, so `send` lets exactly this
path past the `dictationBusy` check; and `insertDictation` reports whether the transcript landed,
so an empty or failed take can never send the bare draft. No focus after a voice send, so a phone
keyboard stays closed. Pinned by the AT-2929 block of `AnnaConversation.test.js` and the
hold-to-send step of `browser-tests/anna-workspace` (`DICTATION_ONLY=1`).

**The chat shows the view open NOW, not a list of visited views (AT-2914).**
`useAnnaContextNotices` returns one notice ("Looking at: …"), or `null` while no view is open
(chat-only mode). `AnnaConversation` renders it as the last entry of the current thread, after
newer messages. Re-opening the same view keeps its original time. A project picked in the
composer's switcher becomes a local "Switched to project: …" entry
(`useAnnaProjectSwitchNotices`). It is placed by time in the thread that choice resolves to, and
re-picking the active project adds nothing. Neither is written to Firestore or seen by the
assistant. Pinned by the AT-2914 cases in `AnnaConversation.test.js` and `AnnaShell.test.js`.

**The assistant is told what the work pane shows, not the Alldone route behind it (AT-2955).**
`annaPageContext` on the Anna chat used to be only `{ path, title }`, and every non-Alldone surface
wrote `{ path: '/', title: 'Anna' }`. With Story Builder on screen the assistant answered about the
hidden "Open tasks" page, or about an app it had opened earlier. AnnaShell now publishes
`buildAnnaPaneContext` (`components/Anna/annaPaneContext.js`), validated by the dependency-free
`functions/Assistant/annaPaneContext.js` on both sides. It adds `surface` (`alldone`, `app`, `vm`,
`vms`, `browser`, `none`) plus `app` (kind, name, MCP server/tool or iframe origin) or `vm` (run =
correlationId, task, status), and still keeps `path`/`title` for voice calls and older readers. An
app or VM therefore gets its own title, never the page behind it. `formatAnnaPaneContext` keeps three
things apart in the prompt: OBSERVED (Alldone's own metadata), APP-REPORTED and AVAILABLE ACTIONS.
APP-REPORTED is fenced as untrusted, and Alldone never reads a frame's DOM: apps are cross-origin and
sandboxed. It comes from MCP Apps `ui/update-model-context` (`mcpAppHost`, previously accepted and
dropped) or from an iframe tool's `{ type: 'APP_CONTEXT', context: { text?, structuredContent? } }`
(`EmbeddedAppFrame`, only from its own frame and origin and only in the pane). Both land in
`utils/annaAppModelContext.js`, in memory, capped at 2,000 characters and never logged. AVAILABLE
ACTIONS reuse existing tools only. They come from the answering assistant's real configuration
(`annaInstructions(context, { allowedTools, mcpServers })`): that app's MCP server, matched by
server id or same host, when the `mcp_servers` toggle is on. For a VM they are `get_vm_job` and
`execute_task_in_vm` with `continue_in_object_id`. Otherwise the prompt says plainly that no tool
operates the app. Answering a VM's question and stopping it stay UI-only. The shared browser's page
title is third-party text and is deliberately not sent. Pinned by
`functions/Assistant/annaPaneContext.test.js`, `components/Anna/annaPaneContext.test.js`, the
AT-2955 cases in `AnnaShell.test.js` / `mcpAppHost.test.js`, and
`IframeModal/embeddedAppContext.test.js`.

**Assistant mutation feedback**: `annaWorkspaceChanges.js` publishes short-lived,
bounded visual cues after successful native task/note/contact mutations in the
owner's sidebar conversation. Use the final persisted object/project identity
(especially after project moves), never title matching or model-provided selectors.
`AnnaWorkspaceReveal` waits for real DOM anchors, scrolls only the Alldone pane,
and acknowledges only an actually visible frame. It defers during user control or
the hidden mobile workspace, cancels on interaction, and uses `appResume` for page
lifecycle signals. Keep feedback failures separate from mutation success so they
never trigger a repeated write. Rows and detail titles expose `data-anna-object-*`
and `data-anna-project-id`; new supported object views must use those same anchors.
Keep the current view when the saved row is already mounted; otherwise try the cue's
`listPath` before its detail `path`. Task lists use the persisted current reviewer
for open tasks and the original assignee for completed tasks. Notes and contacts
use the project's All list. Allow the list listener to mount the row before falling
back to details, and cancel either navigation when the user interacts.
Coverage: `annaWorkspaceChanges.test.js`, `AnnaWorkspaceReveal.test.js`,
`annaWorkspaceRevealTargets.test.js`, and `browser-tests/anna-workspace`.
React Native Web replaces a ScrollView DOM node's `scrollTo` with its `{ x, y,
animated }` API. Reveal and cancellation must call the browser prototype with
`{ top, left, behavior }`; passing DOM options to the replaced method scrolls to
zero. The browser harness must use a real `ScrollView`, not a plain div stand-in.
After the final reveal, return to Home (`/projects/tasks/open`) only once the
persisted assistant runs for every cue's `triggerMessageId` are completed and no
other work is running. An HTTP response or spinner timeout does not prove success.
User interaction, zoom-in or hiding the workspace cancels the pending return;
manual navigation/surface selection must not be overwritten. Keep assistant mode
and the chat draft intact. Legacy cues without a request identity do not auto-return.

**Popover Width Control (legacy, unmigrated modals)**: Most modals still use
`applyPopoverWidth()` from `utils/HelperFunctions.js`, which applies an exact width per
breakpoint — since Phase 0 that is **full window width minus 32 on mobile**
(`smallScreenNavigation`), 368 tablet / 432 desktop — clamped to the window, read
imperatively from the store (not resize-reactive). It overrides inline styles due to how
it's applied via `style={[localStyles.container, applyPopoverWidth()]}`. Prefer
`useModalSizing` for anything new.

**React Native Dimensions Compatibility**: Do not use `useWindowDimensions()` in this codebase. The current React Native/web setup does not provide it reliably and it causes runtime failures such as `TypeError: useWindowDimensions is not a function`. Use `Dimensions.get('window')` instead when sizing responsive modals or panels.

**Popover Positioning and Viewport Safety**: Popovers using `react-tiny-popover` position content relative to the trigger element by default. Do not override `contentLocation` unless there is a clear reason and the behavior has been checked at narrow and short viewport sizes. The known-good task reminder/postpone date pattern is in `components/UIControls/DueDateButton.js` + `components/UIComponents/FloatModals/DueDateModal/DueDateModal.js`: keep desktop positioning library-managed with `contentLocation={smallScreen ? null : undefined}`, and make the modal itself fit the viewport with `applyPopoverWidth()`, `maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP`, and an internal `CustomScrollView`. For global centered popups such as `DueDateSinglePopup`, use a centered overlay wrapper and only center the popover on small-screen navigation (`contentLocation={smallScreenNavigation ? null : undefined}`). Avoid custom coordinate functions for large modals; they can render the `.react-tiny-popover-container` off-screen or invisibly. Fix size issues in the modal content instead: cap width/height to the available viewport, remove fixed minimums that exceed small screens, and scroll inside the modal.

**A popover that fits nowhere used to render nothing at all (AT-2189)**: `renderPopover` walks the position priority order (`['top','right','left','bottom']` by default) and recurses to the next candidate whenever the current one "violates" the viewport. Upstream, running off the end of that order `return`s without committing anything — but `renderWithPosition` has already written `popoverInfo` to state by then, so `render()` **mounts the portal** (and whatever full-screen overlay the caller wraps it in) while the container keeps its initial `opacity: 0` / `top: 0` / `left: 0`, and an active `contentLocation` **function is never called**. The result is the worst state available: invisible content that still swallows every tap. This is not a corner case on mobile — a popover anchored to a **zero-size target at the centre of the viewport** (the `DueDateSinglePopup` swipe-postpone pattern: `<Text />` inside a centring full-screen overlay) cannot fit left or right of centre if it is wider than ~half the screen, nor above or below it if it is taller than ~half the screen, so a 305×450 modal on a 390×664 phone violated all four candidates 100% of the time. Desktop escaped only because there is room at `'right'`. The patch in `replacement_node_modules/react-tiny-popover/dist/Popover.js` keeps the search but **commits the last candidate once the order is exhausted** (still nudged into the viewport), so coordinates are unchanged for any popover that already found a viable position. When writing jsdom tests against this library, **model the target rect realistically** — mocking every non-container element as `0×0 at (0,0)` parks the target in the top-left corner where `'right'` is always viable, which silently masks this entire class of bug. See `__tests__/UIComponents/ReactTinyPopoverNoFittingPosition.test.js` for the contract and `components/UIComponents/DueDateSinglePopupPositioning.test.js` for the app-level regression.

**Nested `react-tiny-popover` dismisses its parent on tap (mobile tap/click timing)**: `react-tiny-popover` (v4) closes a popover by attaching a `window` `'click'` listener and calling `onClickOutside` whenever the click target is not inside **that** popover's own `document.body` portal. A nested popover (a dropdown/picker opened from inside a popover-based modal) renders in a **separate** portal, so tapping an item in the child is "outside" the parent — the parent's `onClickOutside` fires and the whole modal closes. This reproduces mainly on **mobile web**: a tap emits the touch press (`onPress`, which does the selection) and then a **synthesized `click` shortly after**, and it is that trailing click that reaches the parent's window listener — on desktop the RN-web press typically stops the click from bubbling to `window`, hiding the bug. The ordering is dependable: `onPress` (pointerup/touchend, or the click at the event target during bubbling) always runs before the trailing `click` reaches `window`, so a flag set in `onPress` is readable by the parent's `onClickOutside`. Fix (see `components/TaskListView/EmailLine/EmailLabelChip.js` + `EmailLabelModal/EmailRow.js` + `emailLineHelper.js`): on the child item's `onPress`, stamp a module-level interaction (`markEmailLabelPickerInteraction`); in the parent's `onClickOutside`, swallow the dismiss **once** (`shouldIgnoreEmailLabelModalDismiss` clears the stamp and returns true). Prefer this **consume-once** guard over a fixed time window so it does not depend on how far apart the tap and click land; keep a generous sanity cap (~2s) so a stamp whose dismiss never arrives (the desktop case) can't later swallow a genuine outside tap. Do not reach for `contentDestination` to re-parent the child into the modal DOM — it breaks the library's viewport-relative positioning math — and avoid an in-flow inline dropdown (it expands the modal) or an absolute in-modal overlay (it gets clipped by the modal's `CustomScrollView`).

### A swipeable row is left permanently unopenable by its own swipe (AT-2449)

**`Swipeable` can deliver `onSwipeableClose` BEFORE `onSwipeableWillClose`, and every swipeable row
in the app assumed it could not.** Task, goal, contact, note and chat-message rows all carried the
same pair — `onSwipeableWillClose → setBlockOpen(true)`, `onSwipeableClose → setBlockOpen(false)` —
so that the tap which closes an open swipe row is not also read as a tap that opens it. But
`react-native-gesture-handler@1.5.6`'s `_animateRow` (Swipeable.js:203-242) starts the spring
**first** and calls the `will*` callbacks afterwards, and react-native-web's `SpringAnimation`
runs its first frame **inside `.start()`** — so a close with no distance to travel completes before
`start()` returns and the pair arrives inverted. `blockOpen` is then stuck `true` with no further
event to clear it, and `SocialText`'s press gate (`shouldOnPressInput`) rejects every tap on the
title from then on.

A zero-distance close is not exotic here: it is what **every** one of those rows does on a swipe.
They all call `itemSwipe.current.close()` synchronously from inside their own
`onSwipeableRightWillOpen`, and at that moment the `setState({ rowState: -1 })` issued a few
statements earlier in the outer `_animateRow` has not flushed (React 18 batches updates from native
event handlers), so `_currentOffset()` still answers `0` and `close()` animates 0 → 0. The reported
symptom — "after swiping a task and dismissing the postpone popup I can no longer click into the
task" — is misleading in both halves: the swipe alone wedges the row, and the popup is merely what
hides it, because `TaskItem.toggleModal` gates the whole list on `showSwipeDueDatePopup.visible`
while it is up. Redux is clean afterwards; the dead state is per-row.

`hooks/useSwipeCloseGuard.js` owns the pair for all five rows, and the two orderings are told apart
by the **microtask checkpoint** — both callbacks of an inverted pair are emitted inside the same
synchronous `_animateRow` call, while a real animation resolves in a later task. A genuinely
animated close therefore still blocks from `willClose` to `close`, exactly as before. It also
handles `onSwipeableWillOpen`, because a close whose animation is interrupted by a new open gesture
never delivers its completion callback at all. Class rows (`ContactItem`, `GoalItemPresentation`)
use the exported `createSwipeCloseGuard(setBlockOpen)` factory — the closure is the whole state
machine, so it must be created **once per row**, never per render.

**A settled close still has a GESTURE to see out, and reading "settled" as "nothing to block" broke
the goal row (AT-2449 follow-up).** The first version of this guard left `blockOpen` false for the
inverted pair. That is right about the ANIMATION and wrong about the INTERACTION: a mouse drag ends
with `mouseup` **and a trailing `click`, dispatched in the same task**, at the release point — i.e.
on the row that was just swiped. Every row here turns that click into a press on its title, so the
flag being stuck `true` had also, by accident, been the only thing stopping a swipe from being read
as a tap on the row it swiped. With it gone, **swiping a goal in the task list opened the goal's
edit mode instead of the postpone popup** — and then made the popup impossible, because
`GoalItemPresentation.onRightSwipe` defers its `showSwipeDueDatePopup` dispatch to a `setTimeout`
and `componentWillUnmount` clears `this.timeouts`, so opening edit mode **cancels the popup it was
supposed to show**. Same shape is latent on the contact and note rows (deferred popup, press target
navigates to a detailed view). The task row is the one that never showed it, for a reason worth
copying: `TaskPresentation.onRightSwipe` dispatches **synchronously**, and `TaskItem.toggleModal`
refuses to open edit mode while `showSwipeDueDatePopup.visible` — so by the time its trailing click
lands there is already a reason to ignore it.

So the rule is not "settled ⇒ do not block" but **"settled ⇒ block only for as long as the gesture
lasts"**, and that end is an observed boundary rather than a grace period: the trailing click rides
in the same task as the `mouseup`, so the **first macrotask** after it is already past the click.
It is the same boundary the rows themselves use — their deferred `setTimeout(...)` popups run in
that turn too, scheduled just after the guard's, so the row unblocks and its popup opens in a fixed
order rather than a raced one. `onSwipeableWillOpen` must not clear a block established in the
current tick (it fires later in the very same `_animateRow`), which is what `gestureBlockActive`
is for. This is a **mouse-only** hazard, which is why the release can be that tight: a browser only
synthesises a `click` for a touch sequence it judges a tap, and a swipe past `rightThreshold` (80px)
is an order of magnitude past the tap slop. Note the direction of the risk if that were ever wrong —
the block is held strictly longer than the first version of the guard and strictly shorter than the
behaviour that shipped for years before AT-2449, so it cannot be worse than either.

Pinned by `hooks/useSwipeCloseGuard.test.js` (the rule, both halves),
`components/TaskListView/TaskItem/TaskPresentation/TaskPresentationSwipeGuard.test.js` and
`components/GoalsView/GoalItemPresentationSwipeGuard.test.js` (the wiring — their `Swipeable` double
in `__swipeableAnimateRowDouble.js` reproduces `_animateRow`'s emission order and the batched
`rowState` write, which is the only reason the defect is expressible in jsdom at all) and
`browser-tests/at2449` (a real mouse swipe, a real popover dismiss and a real click, in real
Chromium, on a task row **and** a goal row — jsdom has no Hammer recogniser, so the gesture itself
cannot happen there and any jsdom-only test of this path would have to call the handlers by hand,
which is exactly the step that hides the bug; the goal regression was found by adding that row to
the harness and A/B-ing it against the pre-fix commit).

### Task completion animation (AT-2404)

Ticking a task's checkbox punches the checkbox, bursts a ring and six sparks out of it, fills a slim
bright-green **progress bar** left-to-right across the title with a green row wash following the same
edge, confirms with a small pulse at 100%, and — **only for a row that is about to leave its list** —
collapses the row upward out of the way. The state lives in
`components/TaskListView/TaskItem/TaskPresentation/taskCompletionMotion.js` (owned by
`TaskPresentation`, the row) and is triggered from `CheckBoxWrapper` (the checkbox, several levels
down) through a `beginCompletionMotion` prop — **not** redux: a slice keyed by task id would
re-render every mounted row on every completion, the exact fan-out AT-2336 exists to prevent, for
state that concerns one row for under a second. Because it is implemented once in the shared row it
applies everywhere `TaskPresentation` renders — open lists, MyDay, Goal DV, pending, done, the
inline subtask list, the TDV Subtasks tab, backlinks, drag mode, the comment popup — on mobile and
desktop alike. There is no second/mobile task-row component.

**A SUBTASK MUST NEVER COLLAPSE.** The collapse is only ever a cover for a removal that is about to
happen anyway: a completed top-level task disappears because the `inDone == false` query stops
matching it, not because anything here removes it. That premise is **false for a subtask**.
`setTaskStatus` keeps a subtask's `inDone` at its parent's value and never stamps `completed`
(`tasksFirestore.js` — `inDone: task.parentId ? task.inDone : isDone`), and **no** subtask query
filters on `done` (`watchSubtasksList`, `watchSubtasks`, the open/MyDay/Goal-DV lists that bucket by
`parentId`). A checked-off subtask therefore stays exactly where it is, greyed
(`TitleContainer` already styles `task.isSubtask && task.done`), ready to be reopened. The first
pass of this feature collapsed it anyway and never restored `collapsing`, so a completed subtask was
left as an invisible zero-height row that only came back on a remount — it looked deleted and was
still there. The gate is `rowRemainsAfterCompletion(task, { inCommentPopup })`, a pure exported
function resolved **in `TaskPresentation`** and passed to the hook as `retainRow`, never decided at
the checkbox: expressing it at the one shared row is what makes it impossible for a subtask context
to forget. It answers true for `isSubtask`, for a bare `parentId` (legacy/partial docs — `DragHelper`
derives one from the other) and for the comment-popup header, which is a row inside a modal with no
list to leave. A retained row plays every other beat and then **releases** — the bar, its head and
the wash fade out and the state clears — leaving the ordinary done-subtask appearance, which is also
what a reload renders, so a subtask you just completed and one that was already done look
identical.

**`begin()` returns the number of ms the caller must wait before writing.** That is the whole
contract, and it is what keeps `CheckBoxWrapper` from having to know what kind of row it is in or
whether motion is enabled. Three answers: **1070ms** for a collapsing row (~990ms of motion — burst
560, sweep 70+450, pulse 150, collapse 670+320 — plus an 80ms buffer so the row is flat and invisible
before the write, and the snapshot that removes it can never interrupt the animation halfway),
**690ms** for a retained row (nothing is racing, so the buffer would be dead time), and **300ms**
under reduced motion. Undo is untouched — a 10s bar over 7-day retention, independent of this
timing.

**The checkbox is where the delight goes, because it is bounded.** The row wash stays deliberately
quiet (`UtilityGreen125` at 0.55) — completing a task happens constantly, including in bursts when a
list is cleared, so a full-row colour has to sit low in the attention order or it strobes. A 24px
box cannot strobe a list, so that is where the saturated `UtilityGreen200`, the expanding ring and
the six sparks live (`CheckBoxContainer/TaskCompletionCelebration.js`). Two things about it are
load-bearing: the green check is an **overlay**, not a restyle of `CheckBox` (the persistent done
state is grey `Text03` everywhere in the app and is not this animation's to change — an overlay
means there is nothing to unwind), and the punch scale is applied to the **real checkbox**, so what
squashes and springs back is the element the finger landed on. It stands down over the `pending`
clock and the AI-step control, which are different affordances that a green "done" tile would lie
about. Spark travel is ~11px: the predecessor here was a random 300px Giphy GIF portalled over the
middle of the screen on **every** tick, plus a `giphyRandomGif` cloud-function round trip, which is
exactly the gimmick to avoid. That overlay is still wired to the deliberate one-off paths that
dispatch `showTaskCompletionAnimation()` (WorkflowModal, FollowUpModal, comment-popup workflow
controls) through `GlobalModalsContainerApp`, and to nothing else.

**One `Animated.Value` drives the title bar AND the wash** (`scaleX`, both with
`transformOrigin: 'left center'`), so the wash's leading edge IS the bar's leading edge — two values,
however carefully tuned, read as two animations that happen to overlap. A second shared value
(`flourish`) fades in everything green together and is what the retained-row release winds back
down. A third, `pulse`, is the confirmation at 100% and is a **normalised clock, not an amplitude**:
it is sequenced strictly _after_ the fill in the same `Animated.sequence` (a confirmation that can
overlap the thing it confirms is a wobble), and the bump shape — thicken, settle, bloom the head out
— lives in the interpolations in `TaskCompletionProgress`, so the confirmation can be re-shaped
without touching the sequence. The release itself is a **timer**, not the `Animated` completion
callback: it has to fire identically on the animated path, the reduced-motion path and any renderer
whose composite never reports finishing, and a subtask that kept its progress bar because one
callback never arrived is the exact failure this exists to remove. A `done → open` effect resets
everything as a second guarantee, so reopening a subtask can never leave completion styling
behind.

**Only a genuine completion is celebrated.** `scheduleMoveTasksFromOpen` is also how ticking a
_workflow_ task hands it to the next reviewer — `stepToMoveId` is a step id, not `DONE_STEP`. That
row still fades and collapses (it is leaving the list) but gets no sweep, no green and no checkbox
burst, because the task is not done — it would otherwise be congratulated for finishing something it
has only handed on. The flag is `begin({ isCompletion })`; it was called `strikeThrough` while the
title beat was a strike-through.

**A progress bar, not a strike-through — the geometry is the same, the message is not.** The first
two passes drew a dark `Text02` line through the middle of the title. It was accurate and it read as
_deletion_: a struck-out row is the visual language of "this was removed". `TaskCompletionProgress`
therefore keeps the measurement and inverts the metaphor — a 3px `UtilityGreen200` bar filling
0→100% with a lighter `UtilityGreen150` glowing head at the leading edge. Deliberately **not** a
track-plus-fill and deliberately **no percentage numbers**: a grey track announces a UI control in a
list of prose, and a `0% → 100%` badge is unreadable at this speed while adding a second thing to
look at.

**The bar goes THROUGH the text, and the intermediate pass that put it under the text was wrong.**
Having argued that "a bar through the glyphs is a strike-through however green it is", that pass
centred the bar on the **bottom edge** of each line's ink. It shipped, and the immediate dogfooding
verdict was _"der grüne Strich ist nicht mittig zum Text"_ — because an underline is exactly what it
had become: a mark detached from the text, sitting visibly low. The argument confused the POSITION
with the MESSAGE. What says "completed" rather than "deleted" is the colour, the direction and the
moving head; the strike-through's **place** is simply where a line across a title belongs. Both
paths now aim the bar's **centre** at the line's centre and subtract half the bar's thickness to get
the `top` they set — `(line.top + line.bottom) / 2` on the measured path, `lineHeight * 0.5` on the
fallback, so a row that fails to measure cannot quietly keep drawing the underline. Related: the
per-line union takes `min(top)` as well as `max(bottom)`. That is sub-pixel (the grouping key rounds
`top`, so a group spans under a pixel) but the midpoint is now load-bearing, and half a union is a
bias with nothing behind it.

**On top of that geometric centre sits exactly one pixel of optical correction, `OPTICAL_OFFSET_Y`.**
The centring pass shipped with none and argued none was wanted — a range's client rect spans the line
box, CSS splits half-leading evenly, so the em box is concentric with it, and the x-height centre of
lowercase and the cap-height centre of mixed case sit ~1px off that midpoint in **opposite**
directions, making any constant nudge look like font-specific guesswork. That reasoning is right
about which direction a _font-fitting_ correction would take, and it is why this is not one. But the
geometrically centred bar still read as slightly high in production (_"now the strikethrough is a
little too high"_): the line box is symmetric about the em box, the **ink inside it is not** — a
Latin face hangs descenders below the baseline while most of a lowercase word's mass sits above it,
so a line of text has its visual centre of gravity marginally below the centre of the box holding it.
The fix is a flat `+1` applied to **both** paths, never to one, and never as a per-line term: it
shifts the whole sweep and must not change the spacing between wrapped lines, or the last line of a
three-line title drifts off its text. The glowing head needs no separate handling and must not get
one — it derives its `top` from the bar's, so it stays concentric for free. One pixel is the smallest
correction available; anything larger starts walking back toward the underline this replaced.

**A wrapped title is ONE bar's worth of progress, not three filling at once.**
`buildSweepSegments` gives each measured line the share of 0→1 that matches its own ink width, so
the head runs off the end of line one exactly as line two starts and travels at a constant speed
through the title. Three simultaneous fills read as three progress bars, which is exactly the
"UI widget" feel being avoided. It is still ONE `Animated.Value` — each line interpolates its own
window of it with `extrapolate: 'clamp'` — so the lines can never drift apart. The last segment's
`end` is pinned to exactly `1` rather than computed, because floating-point drift there leaves a
hairline of unfilled title precisely where the confirmation pulse fires.

**The sweep measures the text, not the column.** `TaskCompletionProgress` runs a
`Range.getClientRects()` over the rendered title and groups the resulting per-word rects into one
span per wrapped line. Without this the bar spans the title column, which
is `flex: 1` and stretches to the trailing tags — "Buy milk" on a desktop row would show a
several-hundred-pixel bar under empty space, which reads as a row-level loading indicator rather
than as the title being completed. Any failure (no DOM, missing marker, empty measurement) falls
back to full-width bars sized off the title's `onLayout` height, capped at the three lines
`numberOfLines={3}` allows, centred in the line box like the measured path and still filled
**sequentially** (equal shares).

**There is no element that contains a task title, so the range is drawn between two markers
(AT-2404 follow-up).** `SocialText` lays a title out as ONE `flexWrap` row whose children are, in
order: the leading chips from `LeftTagsAndIcons` (priority, Gmail, calendar, VM status, milestone
date), then one `<Text>` per word/inline tag from `WordsList`, then a hidden marker. Nothing wraps
"the text" — `LeftTagsAndIcons` renders a **fragment**, so its chips are plain siblings of the
words — and the chip count varies per row. `Content` therefore renders a **pair** of empty,
`visibility: hidden`, zero-size markers around the words (`textRangeMarkers.js` derives the start
id from the end id), and `measureTitleLines` ranges `setStartAfter(start)` → `setEndBefore(end)`:
exactly the words and inline tags, never the chips and never the markers.

The obvious-looking shortcut is the trap that shipped: `elementId` **is** that end marker, and it is
an end-of-text **position probe** for `TasksHelper.showWrappedTaskEllipsis` (which reads its
`bottom`/`left`), not a container. It is deliberately empty, so `selectNodeContents` on it selected
nothing, `getClientRects()` came back empty, and `measureTitleLines` returned null on **every**
completion — the measured path never once ran in production. It read as working because the whole
suite stubbed `document.createRange` and the stub answered for whichever element it was handed. Keep
that marker last and zero-size; it has the other consumer.

**A wrapped line is `lineHeight + 6` tall, not `lineHeight` — this is what drew three bars across a
two-line title.** Every per-word `<Text>` carries `marginTop: 3`/`marginBottom: 3` (`WordsList`'s
`wrappedText`), and a flex line's cross size is the tallest **margin** box on it, so the real pitch
is 30px (task) / 28px (subtask). The fallback — which, per the above, was the only path ever
running — divided the measured height by the bare line height: `round(60 / 24)` is `round(2.5)`,
which JS rounds **up** to 3. It hid on both neighbours, which is why only dogfooding found it: one
line was `round(30 / 24)` = 1 and correct, three lines was `round(90 / 24)` = 4 clamped back to the
3-line maximum and correct. Two lines was the only visible arity that was wrong. The same wrong
pitch also walked each bar 6px further up its own line than the last. Use `resolveLinePitch`;
`descriptionText`'s `maxHeight: 90` and `TitleContainer`'s `lineHeight + wrappedTextVerticalMargins`
multiline check are the two independent confirmations that 6 is the number.

Grouping rects into lines is by **vertical overlap** (`> half the shorter height`), not by rounded
`top`. Per CSSOM-View a range reports both the border box of each selected element **and** the rects
of the text inside it, so one word arrives twice with tops that can straddle a `.5` boundary and
split one line into two bars; and an inline tag is a different height from the words beside it. Real
lines are a clean 6px apart with zero overlap, so the threshold has enormous margin either side.

Three things that are load-bearing and easy to break: each bar needs
`transformOrigin: 'left center'` (RNW 0.21 passes it through `preprocess` to CSS `transform-origin`)
or it expands from its own middle and stops reading as progress at all — the same origin is what
keeps the pulse's `scaleY` centred; the rects must be measured against an **untransformed** wrapper,
since measuring a scaled node reads a box already squashed to `scaleX(0)`; and the glowing **head**
must sit OUTSIDE the scaled bar and travel by `translateX` instead, or it is squashed to nothing
along with everything else — the point of a head is that it keeps its shape while the bar behind it
grows. No head is drawn on the fallback path, which does not know where a line ends and would park
it in empty space.

`textDecorationLine` (`'underline'` or `'line-through'`) is deliberately not used — it cannot be
animated, and `SocialText` renders hashtags, mentions, links and the leading priority/Gmail chips as
separate nested elements, so a decoration on the parent `<Text>` is at the mercy of each child's
styling.

**Reduced motion keeps the information and drops the motion** — the bar appears statically at 100%,
the checkbox is green, `pulse` stays at rest (its resting frame IS the static statement), the ring
and sparks are not rendered at all (they carry nothing), the row never collapses, and the hold
shortens to 300ms so it does not read as lag. Zero would mean no completion feedback at all. Same `useReducedMotion()` from `Ghosts/ghostAnimation.js` and the same
`animationsAreDisabled()` jest convention as every other animation here — which means a suite that
wants to see the real branch must opt out of it, or an inert row makes every collapse assertion pass
vacuously. Pinned by `taskCompletionMotion.test.js` (the rule and the hook),
`TaskPresentationCompletion.test.js` (the REAL row, real checkbox press, subtask vs top-level vs
comment popup vs reopen — the wiring, which is where the subtask bug actually lived),
`CheckBoxContainer/TaskCompletionCelebration.test.js`, `CheckBoxContainer/CheckBoxContainer.test.js`,
`TitleContainer/TaskCompletionProgress.test.js` (segment geometry, wrapped-title hand-over and the
DOM measurement path through react-dom), `TitleContainer/TitleContainer.test.js` and the
`completion motion handshake` block in `CheckBoxContainer/CheckBoxWrapper.test.js`. Note
`findAllByProps` must pass `{ deep: false }` when counting bars: an `Animated.View` matches both as
the composite element and as the host `View` it renders, which silently doubles every count.

Its `measuring the title SocialText actually renders` block is the one that would have caught the
above, and the reason it can is that it renders the **real** `Content` and synthesises the layout
from the nodes the range genuinely contains — so "the chips are excluded" and "a two-line title
yields two bars" are assertions about the code rather than restatements of a stub. A rect stub that
answers for whatever element it is handed cannot tell that the wrong element is being measured;
that is exactly how the empty-marker defect passed a green suite.

### Gold earned for a task flies into the counter as 3D coins

`earnGold` dispatches `setTriggerGoldAnimation(goldEarned, checkBoxId)` as before; what plays is
decided by `GoldAnimationsContainer`. Where WebGL is available and motion is welcome, `GoldCoinFlight`
launches that many metallic coins from the checkbox on the shared full-app overlay
(`RootView/GoldCoins/goldCoinsOverlay.js` — one fixed, transparent, `pointer-events: none` canvas,
created on first use, whose loop runs only while coins are in the air), along the burst-and-arc path
in the pure `coinFlight.js`, into the top bar's Gold icon. The Gold counter counts up one coin per
landing through `goldCounterBridge.js`: it shows `base + landed` while coins fly, then the higher of
that and the real balance until the server's reward arrives (or `SETTLE_MS` passes, if it never
does). Everywhere else — no WebGL, reduced motion, or the overlay failing to load
(`goldCoinsUnavailable`) — the original Lottie pair (`GoldEarnedAnimation` + `GoldChain`) plays. The
container is mounted by the root view AND every detailed view, so each trigger object is launched
exactly once (a `WeakSet` in `GoldCoinFlight`). The overlay runs in parallel to the completion
motion and never delays the task write.

**A task that earned real money throws cash as well.** When the project has an hourly rate for the
logged-in user (`project.hourlyRatesData = { currency, hourlyRates }`) and the task has an estimate,
`celebrateTaskEarnings` (`GoldCoins/cashReward.js`, called next to the done-time statistics update in
both completion paths of `tasksFirestore.js`) throws banknotes out of the checkbox on the same overlay
and floats the amount above it (`+37,50 €`, in the user's locale). The sum is `estimate / 60 * rate`
(`getTaskEarnings`) — the same number the Statistics view and revenue OKRs count, so the animation
never claims money the statistics do not. On a DAY-RATE project (`dayRateTimeLog.enabled`) every task
throws cash, estimate or not, but with NO figure: the day is billed as a whole, and the completed-task
count is only the signal that the day counts as worked, so no task earns a share worth showing. The
generated "Time log for day rate" task never throws cash (`generatedTimeLog`). Notes are thrown away from the nearer screen edge, drawn
unlit (lit paper washes out on the white app) with a correctly oriented back, and flutter down like
paper (`cashFlight.js`). Each reward picks one of ten choreographies at random, never the same
one twice in a row: `COIN_STYLES` (arc, fountain, spiral, lineUp, bounce, comet, helix, hover,
slingshot, pinball) and `CASH_STYLES` (fountain, rain, explosion, moneyGun, tornado, cardFan,
geyser, wave, floatUp, stack), chosen by `pickStyle` in `goldCoinsOverlay.js`. Every coin style
must start at the checkbox and land exactly on the counter (the counter ticks on landing), and
every cash style must fade in from 0 and out before `life` ends — `coinFlight.test.js` /
`cashFlight.test.js` run each style against those rules, so a new style only has to pass them. No rate, no estimate, someone else's task, no WebGL or reduced motion: no
cash, and it never throws into the completion path. Both overlays load through
`loadGoldCoinsOverlay` so tests can replace the dynamic `import()`, which Jest's Babel does not
transform.

### Empty-inbox celebration (AT-2445)

**A count of 0 does not mean "empty" — it also means "not counted yet", and telling them apart is
the whole bug.** `openTasksAmount` is a running total accumulated across one Firestore listener per
project (`watchOpenTasksAmount` and its observed/workstream siblings in `taskNumbers.js`), it starts
at 0, and `unwatchOpenTasksAmount` forces it back to 0 whenever those listeners are rebuilt — which
happens on **every** mount of the all-projects board, because `TasksAmountContainers` registers an
empty project list for one pass before the real one arrives, and again on every Later/Someday
toggle. `OpenTasksViewAllProjects` nonetheless decided with a bare `!openTasksAmount`, so it rendered
the empty-inbox congrats through the whole loading window of every visit. My Day never had this
problem (`tasksLoaded && …` in `MyDayOpenTasks`); the all-projects board was the outlier.

That flash is not cosmetic, and this is why three previous tasks about the animation all "worked"
and were never seen. The block mounts `EmptyInboxOverview`, whose `useTodayEmptyInboxCelebration`
claims the **once-per-day** celebration marker in a `useLayoutEffect` — before paint, deliberately
(AT-2418: a passive effect would paint the finished green dot and then jump it back to scale 0). So
the day was routinely spent by a frame nobody saw, and the genuine empty-inbox moment later that day
animated nothing. `openTasksAmountLoaded` is the missing half: every count listener reports its
first snapshot (**and its error branch**) through a per-query token, `OpenTasksAmountContainer`
announces readiness once that generation's listeners have all reported, and it **fails open** after
`OPEN_TASKS_AMOUNT_READY_TIMEOUT_MS` — "the congrats never appears again" is far worse than "it
appears a few seconds late". The token is per QUERY, not per project: the workstream watcher opens
one listener per workstream id under a single watcher key. Second line of defence in the hook
itself: a day claimed but torn down before its run has been on screen for
`CELEBRATION_CLAIM_SETTLE_MS` is **handed back** (`releaseEmptyInboxDayCelebration`), and only a
marker this session claimed can be refunded — one restored from localStorage means the animation
demonstrably ran.

**The celebration is staged where the eye already is.** AT-2418 put it on the one element that
genuinely changes — an 11px square in the streak grid — which is correct and invisible: the grid is
inside a card several blocks down the page and today's cell is at the far right of a 53-column year.
The congratulation headline now pops in with a confetti burst thrown from behind it
(`emptyInboxCongratsMotion.js` + `EmptyInboxConfetti.js`), and the dot keeps its beat as the detail
you find when you look down. **One** run id drives both, so they are one event; the decision
therefore moved up to `AllProjectsEmptyInbox`, which owns it and passes `celebrationRunId` down to
`EmptyInboxOverview` (the card falls back to deciding for itself when no run id is passed, which is
what keeps the Settings → Profile copy unable to spend the day). Owning it there is also what lets
**My Day** celebrate at all — it renders this block without the achievement card, and clearing your
last task there is where it usually happens.

`celebrateNewDay` means "this surface may SPEND the day" and defaults to **off**; only the two
open-task boards opt in. The Done, Pending and Workflow all-projects boards render the same block
and must not — an empty Done list means you completed nothing today — and if they could celebrate
they could also spend the day out from under the board that should have. Confetti trajectories are
hashed from the piece index, never `Math.random()`: this board is subscribed to the task counts and
re-renders constantly, and a random value read during render would teleport every piece onto a new
trajectory mid-flight. The layer is an absolutely-positioned `pointerEvents: none` overlay so it can
never move the Add task button or intercept a tap on it. Reduced motion renders no decorative layer
at all. Pinned by `OpenTasksAmountContainer.test.js`, the AT-2445 blocks in
`OpenTasksViewAllProjects.test.js` / `AllProjectsEmptyInbox.test.js` /
`useTodayEmptyInboxCelebration.test.js`, and `EmptyInboxCongratsCelebration.test.js` — which, like
AT-2418's flow suite, opts out of BOTH jest's inert-animation convention and reduced motion, because
the predecessor's only test mocked `isReduceMotionEnabled` to `true` and therefore exercised the
static branch forever.

### The Empty inbox card draws the last month as a 3D city (skyline)

The card has a Week/Month/Year switch (remembered in localStorage, `alldone.emptyInbox.range`; Week
until the user picks one). Week and Month draw the current week or the last 5 weeks as a three.js
city (`Achievements/Skyline/`), laid out like a calendar page — weekdays as columns, weeks as rows,
the current week nearest the camera; Year is the original 2D grid for the whole year. The scene is
built for one layout (`createSkylineScene(…, { weeks })`, `SKYLINE_RANGE_WEEKS`), so the card
remounts it with `key={range}`. A single week is a 7×1 strip, so it gets a flatter canvas, a
narrower orbit (`getOrbitView(t, sweep)` — turning a strip diagonal costs most of its width), no
plane, and a balloon, birds and helicopter kept below its roofs, because its frame has no sky above
them. Without WebGL (native, jsdom, `canRenderSkyline` in `webglSupport.js`,
which must never import three) there is no switch and the grid is all there is. three.js is
loaded with a dynamic `import()` into its own `skyline` chunk and never enters the main bundle; the
web bundle aliases `three` to its ES module build because the app's Babel config turns imports into
`require`, which otherwise picks three's CJS shim and throws on `process.emitWarning` in a browser.

**Data.** One building per day: height = `doneTasks` summed over the user's **active** projects from
`statistics/{projectId}/{userId}` (one `day` range read per project; the past is cached per session,
only today is re-read — `utils/backends/Users/skylineStatistics.js`), scaled to the user's own
95th-percentile day (`getSkylineScale`) so one extreme day cannot dwarf the rest. Building TYPE
follows the same measure (`getBuildingType`: park → house → mid-rise → tower → skyscraper). A gold
flag waving on the building's highest point marks a day in `emptyInboxDays` (the same array the
grid reads) — it replaced a green roof, which a green project's building made indistinguishable. Everything that decides what a
building means lives in the pure, unit-tested `skylineData.js`.

**Look.** Drawn straight onto the white card (transparent canvas) in app colours only, with lit
shading. Height is the only thing that carries data; each day otherwise picks one of several designs
for its height band (cottage, silo, row houses, shop; fan block, round tower, L-block, twisted stack;
stepped tower, banded cylinder, spiral, twins with a sky bridge, obelisk, spire skyscraper) . Colour
comes from the day's PROJECTS: the body is the busiest project's colour, accents the second
project's, and stacked designs colour their slabs by each project's share (`getProjectColorAt`).
`BODY_PALETTE`/`ACCENT_PALETTE` only fill in what the data leaves open; design and fill-ins are
seeded by date so a day always looks the same, and the palette picks are always drawn so a second
project appearing never changes the design. Every design tops out at exactly the day's height. A night sky and cloud shadows were each tried and removed (they revealed the edge of the canvas). Days sit `PITCH` apart with roads between every
row and column. Nothing may be drawn on the ground outside the city.

**Light and materials.** Physically based (`MeshStandardMaterial`): masonry (stone, plaster, brick)
and tinted glass for towers, whose windows are real low-roughness, slightly metallic glass that
reflects a prefiltered `RoomEnvironment` (skipped gracefully where float render targets are
missing). Neutral tone mapping keeps the palette honest. Light is that environment, a hemisphere
fill and one shadow-casting sun (or moon); the shadow camera is deliberately wide so a low sun's long
shadows are not cut off, and the light never comes from below ~17° so golden hour stays lit. Project
colours are small touches only (lobby bands, awnings, small roofs, tower bands, sky bridges).
Framing fits the camera to the real building tops where they stand (`setBuildingTops`), eased by
time rather than per frame. Tuning was done by rendering the real scene headless in Chromium
(Playwright + SwiftShader, bundled with esbuild, a frozen `Date` for day/golden hour/night) — jsdom
cannot show any of this, so do the same before changing materials or light.
`getDaylight` puts the sun where it really is for the user's city (`getSunPosition`, the standard
low-precision almanac): real sunrise, sunset, noon height and season. The location is inferred
WITHOUT a permission prompt — IANA time zones are named after cities, so `guessLocation` maps the
common ones to coordinates and otherwise derives a longitude from the UTC offset. Day blends into
night through civil twilight (sun between +6° and −6°), which is also when the lamps come on; low
sun is warm and throws long shadows, the night is a dimmer cool moon. The city faces south, so the
midday sun lights the side the camera sees. Facade detail (faint floor lines, darkening where walls meet the street, and a window grid on
walls only) is injected into the buildings' material with `onBeforeCompile`. Windows are quiet
darker glass by day; a seeded third of them glow warm as emissive light, faded in with the street
lamps by `getDaylight().lamps` (an early always-lit version read as noise — tie them to the evening).
The injection keeps three's lighting and shadows; the anchors it replaces (`worldpos_vertex`,
`color_fragment`, `metalnessmap_fragment`, `emissivemap_fragment`) must still exist in the Standard (physical) shader after a three.js
bump, or the detail silently disappears. Traffic is deliberately sparse (8 slow cars): the city should feel calm.
After dark the city gets its own light, all of it faded in with `lamps` and absent by day: warm
light pools under the street lamps, car headlights with a beam on the road and red tail lights, the
plane's red/green/strobe navigation lights, the balloon's flickering burner, brighter skyscraper
beacons, and a helicopter that only flies at night, sweeping a searchlight cone over the streets
(birds roost then). These are additive glow sprites and meshes, not real lights — a real point
light per lamp would multiply the per-fragment cost of every building.

**Camera.** It flies on its own and ignores the page scroll (`getOrbitView`: a slow ±30° sweep, elevation
~38–49°, never round the back so the ground legends are never upside down; a wider sweep turns the
wide calendar diagonal to the camera and shrinks the city).
Every frame `fitDistance` bisects the closest distance at which the ground with its legends and
the tallest possible building on the outermost blocks project inside the canvas with a margin
(bounds kept asymmetric and tight so no room is reserved where nothing can be — the legends are
bounded where they are painted, with the week-date width measured, not by a rectangle whose
near corner projects far outside them), and a lens shift (`setViewOffset`) centres the projected
box, so only its SIZE has to fit: the camera looks at a fixed ground point while the towers rise
above it, and fitting the distance alone left an empty band along one edge. The
camera never sits closer than that, so the city can never be clipped by the canvas edge; a clipped
city is what breaks the illusion that it stands on the card. Flying objects stay over the city and
appear/disappear by scale, never by crossing the edge. Two earlier designs were dropped: a
scroll-driven off-axis "flyover" with a fixed ground (looked wrong in practice), and a low camera
(outer buildings fanned outwards).

**Interaction.** Hover/tap shows a day; there is no drag or zoom, and the only event the canvas stops
is `click` (the all-projects card is itself a link). Every tap on the city also launches an
ASTEROID — at the tapped building, or at the tapped spot on the ground (a tap off the city's ground
launches nothing). It appears high over the city by scale (never across the canvas edge), streaks in
trailing fire and smoke while a red ring tightens on its target, and does its damage only where it
lands: `getAsteroidDamage` (pure, in `skylineData.js`) gives 2 hit points for a direct hit and 1 to
anything else in the blast, whose radius stops short of the next block, so aiming at a building
never hurts a neighbour; a road strike catches both sides, and the 15% big ones (`CRITICAL_HIT_CHANCE`)
hit for 4 and reach the four neighbours. Buildings still roll their hit points (`rollHitPoints`) and
lose floors per hit (`getIntegrity` keeps a third standing until the final blow, so the collapse
stays an event), then collapse into dust and rubble. The impact is flash, fireball, a ring of fire on
the ground, shockwave, smoke column with a mushroom cap, debris, embers, one real `PointLight` (always
in the scene at intensity 0, so shaders never recompile), camera shake and a scorch mark that stays.
Fire is **opaque, unlit, flat-shaded** puffs coloured along a white→yellow→orange→red→soot ramp —
additive glow is invisible on the card's white sky. What lies on the ground (shockwave, scorch) is
clipped to the city's ground with `localClippingEnabled` clipping planes, and debris that leaves the
city burns out before it lands, so an edge strike cannot paint the card. The week strip has no sky above its towers, so there a rock aims at a tall tower's lower floors, the blast is smaller, and fire and smoke flatten out under the highest roof (`blastCeiling`) instead of rising off the canvas. Six rocks can be in the air;
under reduced motion there is no flight or explosion, only the damage. Memory-only and keyed by
date — a statistics refresh must not resurrect a demolished day, a reload brings everything back.
The celebration run that pops the 2D today dot pops today's flag instead, and the first hit on
a building knocks its flag and rooftop equipment off.

**Today is marked in the app's blue (`Primary100`), never in gold.** Gold already means "empty
inbox" (the flags), so today gets the colour the 2D grid rings its square in: a blue ring round
today's block on the ground, today's weekday and week legends in bold blue, a ripple spreading from
the block, and a "Today" tag (a sprite, so it reads from every angle, drawn with `depthTest: false`
so a tower in front cannot hide it) floating over the roof. The tag is part of the framing bounds
(`setBuildingTops`), so it never leaves the card; the day line under the city prefixes "Today". The
Year grid rings today's square with a 2px blue border whether or not it was cleared (it used to lose
the ring exactly on a cleared day).

**Life and cost.** The decorative layer (a few slow cars, street trees and lamps, zebra crossings,
a small flock of birds, an occasional balloon or plane) carries no data, is not interactive, and is switched off under
reduced motion (which also freezes the camera at `SKYLINE_REST_VIEW`). The render loop only runs
while the card intersects the viewport. `skylineScene.test.js` drives the real scene in jsdom with
only the WebGL renderer and the 2D canvas stubbed — it is the one test that executes this module,
which needs `three` in Jest's transform allowlist and the class-static-block Babel transform.

### Rage mode — a vertical-scrolling raid that takes off from your page

A small crosshair after "Anna Alldone: How can I help?" in the assistant line (`AssistantOptions` →
`components/RageMode/RageModeButton.js`) starts a vertical-scrolling shooter in the style of the
early-90s classics (`raidArena.js`). A voxel Anna Alldone with a jetpack takes off from the
assistant's avatar in the same line (and lands back on it when you leave),
**the page you are on slides down off the screen and generated ground scrolls in above it**, and
the mission is flown over that ground: today's tasks are dug in as labelled bunkers, scripted waves
of fighters and incoming mail come in, and the boss at the end is built from today's open-task
count. Between missions a hangar sells repairs, mega bombs and upgrades for credits earned in the
run. It replaced the earlier free-flight "shoot the page apart" mode (snakes, greetings, letter
knock-outs), which is gone. Purely for fun: **no data is ever written.** On for everyone; hidden only
for anonymous viewers, without WebGL, under reduced motion, or on a browser that opted out with
`?rageMode=off` (`?rageMode=on` undoes it; `rageModeFlag.js`). The arena is its own lazy
`rage-mode` chunk (three.js is shared with the skyline chunk).

**The app's DOM is never mutated, and the take-off is a STYLE, not a node.** The only things the
arena touches are inline style properties: `transform` + `will-change` on `#root` (the slide) and
`overflow: hidden` on `<html>` and `<body>` (a transformed root would otherwise grow a scrollbar).
React never renders those properties on those elements, and `setTemporaryStyle` restores each one to
exactly what it was — including removing a `style` attribute that did not exist — so the markup is
byte-identical afterwards (`browser-tests/rage-mode` asserts it). Everything else is drawn on the
arena's own canvas: a destroyed task row is covered with a plane in the colour behind it
(`resolveBackgroundColor`) and breaks into shards of a canvas copy of itself. Removing or moving real
nodes would hit the React/Quill `NotFoundError` class described above. **Nothing may reach the app**:
a transparent input layer covers the viewport under the canvas, and keys are swallowed in the
`window` capture phase, before every document-level listener including the escape stack
(Cmd/Ctrl/Alt combinations stay with the browser).

**The seam.** The camera is orthographic, one world unit per CSS pixel, so a hole drawn at a row's
`getBoundingClientRect()` covers exactly that row. Ground objects live in one group that scrolls with
the level: a point at ground distance `g` sits at screen y = `scroll − g`. While the page is on
screen, the ground must exist only ABOVE its top edge, so every ground material shares one clipping
plane (`seamPlane`) whose constant is the page's top edge; a soft shadow strip under the seam makes
the ground read as lying on top of the page. Leaving reverses it: the seam is re-anchored at the
bottom of the screen and rises with the page as it slides back up, so the ground never jumps. The
page's task rows on screen at take-off are the welcome committee (`pageTargets`): every other one
carries a turret that shoots back, and their titles (plus every other task row in the DOM) become the
bunker labels further up. Rows are found by the id every task row already has
(`task_body_<project>_<task>_…`, TaskPresentation's `nativeID`); bunkers take the project's marker
colour through `services.getProjectColor`, which reads the projects map from the store on demand
(lazily required) rather than subscribing the button to it (AT-2336).

**The game logic is pure and seeded** — `raidLevel.js` (missions, the six-wave script, bunker
placement that never lands in the river, terrain chunks), `raidEnemies.js` (scripted flight paths,
aimed fire), `raidArmory.js` (main gun levels, special volleys, rocket homing), `raidRun.js` (shield,
bombs, score, credits, the hangar price list), `raidControls.js` (mouse follow, keyboard, RELATIVE
touch drag so the thumb never covers her). The seed is the date (`daySeed`), so today's level is a
fixed thing you can get better at. **Credits are never Gold**: they are earned by shooting, live only
as long as the run and buy consumables; a game that paid out Gold would let a modified client mint
real currency.

**Where she launches from** is the avatar wrapper in `AssistantOptions`, tagged with
`RAGE_LAUNCH_ANCHOR_ID` (`rageLaunchAnchor.js`). `findLaunchPoint` searches OUTWARDS from the
crosshair for the nearest ancestor containing one, so two assistant lines on one screen never launch
from each other's avatar, and it falls back to the crosshair itself. The avatar's size is passed too:
she grows out of it and shrinks back into it.

**Progress follows the user across devices** (`raidProgress.js`). Clearing a mission saves a
checkpoint — the mission number plus the run as it leaves the hangar — and every successful hangar
purchase saves its own checkpoint; the next raid takes off at the following mission, and a game over replays from the
checkpoint (with that game's credits banked) rather than from mission 1. Only "Start over" clears it (↺ in the status pill pressed
twice, or the confirming button in the hangar and on the game-over card), and a start over is saved
as an EMPTY checkpoint so other devices drop theirs too. Two copies: the server's
(`rageModeProfiles/{uid}.progress`, written by `saveRageModeProgress`, returned by
`getRageModeProfile`) and the browser's (localStorage per uid) for saves
that could not reach the server yet (`pending`). Before Anna leaves her avatar, the arena waits
for `getRageModeProfile`, showing a loading panel. A failed read offers retry or exit; no timer
starts local gameplay (AT-2700). A successful empty profile starts at mission 1. The server stamps
`savedAt`, so devices with different clocks agree. `reconcile` adopts the server copy, retaining
only newer unsynced local saves for delivery; a synced local copy cannot override an empty server
profile. **Progress saves at every mission completion and every successful hangar purchase**
(AT-2700 follow-up), plus `gameOver`, explicit exit/navigation teardown or confirmed start-over.
Each boundary writes a pending local record and queues an individual cloud save. Rapid purchases
are delivered sequentially; an older acknowledgement cannot overwrite the newest local checkpoint.
Failed saves retain the queue for explicit retry. Every next takeoff waits for all outstanding saves,
with a retry/exit panel on failure; **active flight never saves or reloads progress**. Losing banks
only that mission's credits into the latest checkpoint; exiting retains the last completed
checkpoint/purchases (existing quit policy; uncompleted credits are not banked).
Score writes and leaderboard reads happen only at game end. Game-over offers save retry;
preflight/replay/reset also wait for outstanding score/board requests to settle.
`raidPersistence.js` carries the request barrier across arena teardown/reopening for the same uid,
so queued saves cannot overlap a new flight or its initial authoritative profile read. There is no
Rage progress realtime listener or polling. Loading/saving screens park requestAnimationFrame until
ready; no artificial delay. Gold weapon purchases remain explicit shop actions, with play paused. Both copies are owner-editable, so a checkpoint is always
read through `sanitizeCheckpoint`; the server's copy of those rules is
`functions/RageMode/rageModeProgress.js`, and `raidProgress.test.js` fails the build if the two
disagree. Since credits only buy in-run consumables, a forged checkpoint cheats nobody. Missions scroll faster as they go (`missionScrollSpeed`: 96 px/s, +12% per mission, at
most 1.8×), and the route is stretched to match so a mission keeps its length in time.

**The run-up.** On the page she does not simply fly off: she lands out of the avatar, RUNS (legs
on hip pivots in `rageModels.js`, jetpack sputtering) while the page starts to move slowly, then the
jetpack fires — a ring of dust, she rises, tips into flight, and the ground accelerates to the
mission's speed. The mission (and its first wave) starts at lift-off, and nothing fires before it.

**Shadows are real, not painted.** A shadow-casting sun throws every flying and standing object's
silhouette onto an invisible `ShadowMaterial` catcher plane, so shadows land on the ground and on the
page alike, and fall further away the higher something flies (heights in `Z`). Blurry blob shadows and
dark crater decals were removed because they read as dirt on the light ground; a destroyed bunker now
leaves a soft, light foundation patch with rubble that smokes for a moment. Keep the ground light:
fire cools into light smoke, never soot, and the hemisphere light's ground colour is bright so shaded
faces do not turn into dark spots.

**Enter (or 👋) is the greeting** (`rageGreeting.js`, pure and tested): one loop towards the camera in
which she turns from flying away up the screen to face you, greets with a pose and a speech bubble
and drops back into formation. An orthographic camera has no perspective, so "towards the camera" is
done by SCALE (`GREETING_GROW`); the pose's `z` runs 0 → 1 for exactly that. She stays steerable and
vulnerable but holds fire, and the greeting is cancelled by a game over, the hangar or leaving.

**The cast is Alldone's working day** (`raidEnemies.js`): mail swarms and fighters, chat bubbles
that zigzag and fire three-dot spreads, notification pings that HOME on Anna (the one steered path,
turn-rate limited so a sideways dodge works), sticky notes that split into two when destroyed,
checkbox mines that arm within `MINE_TRIGGER_RADIUS` and burst into a ring, meeting invites that fire
rotating rings, the deadline clock — a mid-mission mini-boss whose spiral turns with its hands — and
a golden starred task that never shoots and always drops power-ups. Fire patterns (aimed, spread,
ring, spiral) and each kind's tint, health and contact damage live in `ENEMY_TYPES`; the arena only
draws them. Mission 1 is hand-written and introduces the cast a wave at a time; later missions draw
from `WAVE_POOL` (seeded by the day), which unlocks notes, mines and meetings in mission 2 and the
deadline in mission 3, always flies a carrier, and puts a drawn deadline in the middle slot. The
first appearance of each new kind in a run is announced with how to deal with it.

**Power-ups** (`raidPickups.js`) drop from kills by `DROP_CHANCE` per kind (a carrier, a deadline and
the boss always drop): ☕ coffee (rapid fire), 💡 brainstorm (spread shot), 🛡️ shield bubble, 🩹 repair,
💣 bomb, 🤖 assistants (two drones that orbit and shoot), ⏳ deadline extension (the whole enemy side —
movement, fire, bullets, the boss — runs at `SLOWMO_SCALE`), ⭐ gold star (double score), 🧲 magnet,
💳 credits. A battered shield makes repairs three times as likely; a second pickup of a running buff
extends it, up to twice its duration. Kills chained within `COMBO_WINDOW` build a combo (`raidRun.js`)
worth up to ×3 on POINTS, never on credits.

**There is always a boss, and there are five of them** (`raidBosses.js` for how they fight,
`raidBossModels.js` for how they look), one per mission in turn: the Backlog (aimed fans, lunges, mail
swarms), Inbox Overlord (rows of falling letters with gaps to find), Calendar Colossus (column beams
that flash a warning before they burn, one always on Anna; corner bursts), Notification Storm (a
swinging bell whose shockwave rings each leave one gap; homing pings) and the Grand Deadline
(counter-rotating spirals, its hands sweeping as beams). Each gets angrier below half health. All
are equally hard every day (`BOSS_HP`, scaled only by the mission) — on an empty inbox too: today's
open-task count (the number the Home button's badge shows, `getAllProjectsOpenTasksAmount` over
`sidebarNumbers`) is only what each wears, counting down as it takes damage, and 0 the whole fight
on an empty inbox. Beams and waves ALWAYS telegraph before they can hurt (`BEAM_WARN`, and a wave's gap
is drawn exactly where `waveHits` has it). Text on a disc (a cylinder turned to the camera — the clock
face, badges, pickup tokens) needs `DISC_TEXTURE_TURN`, or it shows a quarter turn off.

**There is a GLOBAL leaderboard** (`functions/RageMode/rageModeLeaderboard.js`), shown after every
game over: the top five, the player's own row highlighted (or shown
below the five with its rank when it is not among them), and the name they play under, editable in
place. One document per player in `rageModeLeaderboard/{uid}` — no client rule, so only the callables
`getRageModeLeaderboard` / `setRageModeName` and `submitRageModeScore` touch it; a new best is written
to the board in the SAME transaction that keeps the profile highscore (also carrying a best from before
the board existed). Rank is a `count()` of strictly higher scores plus one, so ties share a rank and
nothing reads the whole board. The board is visible to every Alldone user across workspaces, so a real
name is never shown by default: until a player chooses one they are "Pilot ####" (derived from the uid),
and a chosen name must be 2–20 letters, digits, spaces or `. _ - '` — nothing that can carry a link,
markup or a mention. Scores are posted only when the run ends. Keys typed into the name field are kept from the game and the app
(`NAME_INPUT_ATTRIBUTE`): the window capture handler lets them type and stops everything else.

**The raid is fitted to the screen** (`raidScreen.js`): the same waves on a phone would be three times
as dense as on a laptop, with the same Anna and the same hit box. Against a 1280×800 reference area,
`density` (√ of the area ratio, 0.5–1.15) scales HOW MANY — enemies per wave, bullets per ring, bunkers,
armed rows at take-off — and `pace` (0.65–1) scales HOW OFTEN enemies, bunkers and bosses fire. Health,
damage, scoring and mission length do not change. Recomputed on resize.

**Steering is relative where it has to be.** A browser cannot move the real cursor, and at take-off
it is still on the crosshair, so the first mouse movement after a reset only records the gap between
the (hidden) cursor and Anna; later movements move her by as much and close the gap a little,
bounded so she always moves the way the mouse moved. It resets after the shop, the hangar, a game
over and keyboard steering. The weapon shop opens mid-mission too (🛒 / B) and pauses everything,
buff timers included; it is also on the hangar and the game-over card.

**Sound** (`rageSound.js`) is synthesised: a compressor bus with a short generated reverb, small
random detunes so repeats never sound identical, rate limits for rapid fire, and a voice per event —
each special weapon, explosions by size, every enemy's fire, mines arming, each power-up's own chime,
combo steps, every boss's arrival plus the bell's dong, the clock's tick and charging/firing beams,
the run-up's footsteps and ignition, a jetpack rumble that follows the ground speed, a low-shield
alarm, and stings for mission start, mission complete and game over. Loops (engine, laser hum) stop
on mute, pause, the hangar, game over and exit.

**Weapons are bought with Gold on the SERVER, never granted by the client.** The main gun always
fires and is upgraded with credits; ON TOP of it fires one special weapon bought with Gold
(`rageWeapons.js`: blaster = none, shotgun 100, rocket 250, flamethrower 400, laser 600, black hole
1000, finger snap 2000), switched with 1–7 or the weapon bar and bought in the shop panel reached
from the hangar, which always asks to confirm. `functions/RageMode/rageModeProfile.js` hosts three
callables — `getRageModeProfile`, `purchaseRageModeItem`, `submitRageModeScore` (plus
`saveRageModeProgress` and the leaderboard's two) — over
`rageModeProfiles/{uid}`, a collection with NO client rule at all, so Firestore's default deny keeps
ownership and highscores out of reach of the browser (deliberately not `users/{uid}` or
`users/{uid}/private/**`, which are owner-writable). A purchase goes through `deductGold` with source
`rage_mode_item` and the idempotency key `rage_mode_item:<weapon>`, scoped per user — each weapon is
charged at most once ever. The server's price list is `functions/RageMode/rageWeaponsCatalog.js`;
`rageWeapons.test.js` fails the build if the display copy disagrees. `submitRageModeScore` keeps the
best score and caps it at 10 million. The arena stays free of backend imports: `RageModeButton` hands
it `services` (the three calls via the lazily-required `rageModeBackend.js`, plus live getters), and
the harness passes fakes. `tuning` (`seed`, `bossAt`, `noWaves`, `startShield`, `startCredits`, `invincible`) exists
for tests only (plus `waves`, `bossHp` and `pickups`, which `browser-tests/rage-mode --cast` uses to
show the whole cast at once). All strings come from one table, `rageStrings.js`.

**Credits are balanced for about a hundred games, and a test holds it there.** A perfect mission
pays ~250 credits early and ~500 later (`CREDITS` + `MISSION_BONUS_CREDITS` in `raidRun.js`), an
ordinary game about half that, while the permanent upgrades cost ~20,500 (cannon 3,000 → 7,000,
shield generator 2,500 → 3,500 → 4,500); repairs (60) and bombs (80) stay cheap enough for every go.
That only works because **a lost game keeps what it earned**: `gameOver` banks the attempt's
`missionCredits` into the checkpoint (`bankCredits` in `raidProgress.js` — before mission 1 is ever
cleared that is a `completed: 0` checkpoint, which `sanitizeCheckpoint` keeps only while it carries
credits, upgrades or purchased extra bombs; the server copy applies the same rule), and the game-over card opens the hangar
(🛠️, or H) to spend them before another go at the same mission. Without banking, a grind this long
would strand players at the first mission they cannot clear. Difficulty never stops rising but each
mission adds less (`missionDifficulty`: `1 + 0.3·(n−1)^0.7` — 1.3 at mission 2, 2.4 at 10, 3.5 at 30).
An earlier tuning paid ~2,200 for mission 1 and everything was bought after two missions, after
which nothing was hard. The `balance` block in `raidRun.test.js` sums every kill of the real
generated missions and fails if the hundred-game target drifts.

**The HUD must fit a 320px phone with a 12px edge gap** (`EDGE` in `raidHud.js`): the status pill and
the weapon bar are `width: max-content` capped at `100vw - 24px` and wrap (a fixed element at
`left: 50%` is otherwise offered only half the screen and wraps far too early); the buff chips and the
bomb button sit above the weapon bar's MEASURED height; the boss bar sits below the pill's measured
height; toasts wrap within `min(460px, 100vw - 48px)`; panels pad by `EDGE` plus the safe-area insets
and put the launch / play-again button first, full width.

**Light ground needs opaque effects**: explosions, flames and enemy fire are opaque tinted sprites,
never additive glow, which vanishes on a light background (the skyline learned the same). Particles,
shots and sparks are `InstancedMesh`es with `frustumCulled = false` (their bounding sphere is the
unit geometry at the origin). **Overlays are placed on the VISIBLE viewport**
(`visibleWidth`/`visibleHeight` in `raidHud.js`): on a phone a page that overflows sideways widens
`innerWidth` past the screen, and `left: 50%` on a fixed element then lands off screen.
`raidArena.test.js` drives the real arena in jsdom with only the renderer stubbed;
`browser-tests/rage-mode` (`--touch`, `--game`) is the only place it actually renders.

### Per-project empty inbox — the completed sweep (AT-2492)

**Clearing one project is celebrated too, and the difference from the all-projects moment is one of
KIND, not of degree.** When a project's today/overdue list goes to zero, that project's own header
row — the 56px `ProjectHeader` line — plays a **completed sweep** in the project's own colour. On
the selected-project board the Anna "tasks done" picture pops in on the same run id, so the two read
as one event. There is no headline, no achievement card, no green dot, no streak, and — the absolute
rule — **no confetti of any kind**. That layer is what makes the all-projects moment visible from
across a room, so withholding it entirely is what keeps the ranking legible; the first pass of
AT-2492 threw a smaller confetti burst here instead, and tuning piece counts alone left the two
reading as "the same celebration, slightly weaker". Trigger is today's list per project, so N small
flourishes compose on the way to the one big achievement. A settled row is byte-identical to before.

**The run is FOUR sequential stages over ~2.8s, and the extra time buys stages rather than a slower
sweep.** The version that first reached production was one 860ms pass (620 travel + 240 fade) and
Karsten's verdict was that it works but is over before it registers — "make it more celebratory and
maybe up to 3 seconds long". A single gesture cannot be stretched to three seconds: a 2.5s fill
across a 900px row reads as a stuck progress bar. So `projectCompletedSweepMotion.js` runs
`Animated.sequence` over four values, one per beat — **FILL 820ms** (the wash's `scaleX` behind a
full-strength 3px leading edge, with a 2px accent bar drawing in along the bottom of the band),
**SHIMMER 760ms** (a wide soft band of the same colour gliding over the now-filled row — light over
coloured glass, which is what makes the row read as _finished_ rather than merely tinted), **PULSE
540ms** (the whole band brightens once and eases back while the accent thickens 2px→4px — the
confirmation), **SETTLE 660ms** (everything fades; the old 240ms exit is what made the whole thing
feel clipped). Sequential, never parallel: the edge has to reach the end of the row before anything
else starts, or the user sees a highlight fading in the middle of the line and the "it got all the
way there" statement is lost — and a confirmation that overlaps the thing it confirms is a wobble.
Within a stage everything derives from ONE value (the AT-2404 rule), and `pulse` is a normalised
**clock**, not an amplitude, so the breath's shape lives in the interpolations and can be re-tuned
without touching the sequence.

**Two of the layers are gated by GEOMETRY, not by opacity, and that is deliberate.** The leading edge
and the shimmer band each travel from fully off the left of the row to fully off the right of it, and
the overlay clips (`overflow: 'hidden'`) — so each is invisible before and after its own stage with
no per-stage bookkeeping that could get out of step with the sequence. The pulse glow gates itself
the same way, by amplitude: both ends of `pulse` map to 0, which is also what leaves no residue.
The accent bar exists because the **edge leaves the row** at the end of stage 1: without it a pale
project colour would spend the shimmer and the breath as an almost invisible 20% tint, so the row
keeps one full-strength element throughout.

**Duration no longer ranks the two celebrations — KIND does, and that reversal is the point.** The
previous pass encoded the ranking as "half or less" (860ms against the all-projects 3000ms);
`ProjectEmptyInboxCelebration.test.js` now asserts only that the sweep never _outlasts_ the big one
plus the 2.5–3.0s window Karsten asked for, and the ranking is carried entirely by the structural
assertions that were always there: no confetti of any sort, `position: absolute` bounded to one 56px
row, no viewport-derived dimension anywhere (the all-projects fall is `position: fixed` and escapes
to the viewport). Consequence worth knowing: `PROJECT_LINE_EXIT_HOLD_MS` is derived from the run, so
in All Projects a cleared project now lingers **~2.9s** instead of ~1s before its block is dropped.
That is the deliberate cost of putting a three-second celebration ON the row — the row has to survive
its own celebration — and every bound below still holds, so the worst case for a bug is a line that
leaves three seconds late rather than never.

**The project line, not the picture, because the picture does not exist where this usually happens.**
`SelectedProjectEmptyInbox` only renders on the selected-project board, so a celebration living on
it could never fire in **All Projects** — which is where a project is normally cleared. The header
row exists in both views and is the same component in each, so moving the celebration onto it is
what makes one implementation serve both boards. Colour is the **project's own**, not the app's
green "done": a task turning green is a statement about that task, while a project line is an
identity, and the two land within a second of each other so they must stay distinguishable.
Pale project colours survive because the wash carries the fill and the full-strength edge carries
the motion.

**The hard part is that All Projects DROPS a cleared project from the board** (`hideProjectData` in
`OpenTasksByProject`), header included, in the same commit that empties it — so "celebrate the
project you just cleared" and "remove the project you just cleared" are in direct conflict.
`useProjectCompletedSweep` returns a `holdProjectLine` that keeps the line for one sweep and then
lets it go, the same grammar AT-2404 uses for a completing task row (sweep, then leave). The settled
layout is unchanged; only the moment of departure moves, by under a second. The hold is bounded
three ways because a project stranded on a board it should have left is a visible bug where a missed
sweep is merely a missed flourish: it always expires on a timer, it is never taken when there will
be no visible sweep (reduced motion, jest), and it is never taken for a line leaving for any other
reason — applying a priority filter hides projects through the same code path and is not delayed at
all.

**Two store slices say "today is empty" and they race, which is what the probe is for.**
`sidebarNumbers` (the unfiltered today+overdue count the marker records are keyed on) and
`thereAreNotTasksInFirstDay` (which actually drives the hide) are written by two different Firestore
listeners and land in whatever order the network gives them. When the hide wins, the line would be
gone before we knew the project had been cleared. So a line that is both leaving **and** otherwise
eligible gets a provisional `PROJECT_SWEEP_PROBE_MS` hold while we find out. It is armed by
a **render-phase state update** (React's documented "adjust state when a prop changes" pattern), not
from an effect — an effect runs after the commit that already removed the block, so the user would
see the project vanish and reappear.

**That probe shipped at 120ms and made the sweep effectively invisible ("I don't see the animation
on the project lines").** Two things were wrong and they compounded. The window was far too tight:
the two slices are not merely two listeners, they also arrive through different amounts of React
work (`thereAreNotTasksInFirstDay` is derived up through `OpenTasksByProjectHandler` and the
parent's state, `sidebarNumbers` through a store dispatch), so a skew of several hundred
milliseconds is ordinary. And losing the race did not delay the celebration, it **deleted** it —
which is the part worth remembering. `lineOnScreen` was treated as a PRECONDITION for celebrating,
but in All Projects it is also a CONSEQUENCE of the celebration being declined: once the probe gave
up, the board dropped the row, and the same **still-mounted** hook (it lives in `OpenTasksByProject`,
not in the block it animates) then refused the very clearing it had been waiting for, forever —
that project never renders a line again that day. So "not on screen" had to be split into its two
meanings: a project that never had a line this session (an All Projects block for a project cleared
earlier — correctly skipped, so its own board still celebrates it), and a line that has **just left
because of the clearing we are being told about**. A clearing this hook WATCHED
(`didProjectReachEmptyInbox` true here) is proof the line was there a moment ago, so it still plays
and the hold puts the row back for it, bounded by `PROJECT_LATE_CLEARING_GRACE_MS`; past that the
run is declined and the reached-record is left **unspent**, so the project's own board still gets
it. The probe is now the prevention (raised to 700ms — it is only ever opened for a line that is
both leaving AND fully eligible, i.e. exactly the moment a project empties in front of you, so
nothing else on the board is delayed by a frame) and the grace is the cure for the tail.

**Two more ways the same feature could show nothing, both fixed with it.** A run was marked "played"
BEFORE the motion check, so a run arriving while motion was unavailable was consumed permanently and
could never play once it became available — and that is reachable without touching a setting,
because react-native-web's `isReduceMotionEnabled()` resolves to **`true`** whenever
`window.matchMedia` is missing (it fails _closed_). Related: `useReducedMotion` seeded its state
`false` and corrected a microtask later, so the first commit always assumed motion — harmless for a
ghost, but this celebration claims its once-per-day marker in a layout effect on exactly that
commit, i.e. it spent the day believing it was about to animate. It now reads the media query
synchronously on first render (falling back to `false`, the safe direction), and the claim itself
stands down when there will be nothing to see rather than being handed back afterwards — a day spent
on a frame nobody saw is the AT-2445 failure.

**Only a real browser can check any of this.** `__mocks__/react-native.js` replaces `Animated.timing`
with a no-op `{start}` stub, so no jest test can observe this animation advancing, and jsdom computes
no layout, so `onLayout` never fires and the leading edge (gated on a measured row width) never
renders. Every test the feature shipped with was therefore green while the sweep was invisible in
production. `browser-tests/at2492` drives the real component in real Chromium and asserts on painted
width across the run; it also reproduces the All Projects late-count case end to end, and is the A/B
that separated "the animation is broken" (it never was — wash 96→900px, edge travelling, correct
colour and geometry) from "the trigger never fires". It now samples the whole ~2.8s run every 60ms
and checks **each stage where it is visible** — the wash growing, the edge crossing and leaving, the
shimmer band travelling **over an already-full wash** (moving it during the fill would be a second
wipe chasing the first), the breath rising and returning to zero, the accent thickening and
returning, and every layer sharing one exit opacity. Run the same harness against `master` for the
A/B: the shipped single-pass sweep scores 13/21 there, failing every stage-2/3 check and reporting
`still painting at 840ms`. Its `--reduce-motion` mode asserts the **inverted** contract — no run, no
paint, and the day left **unspent** — which is what it should always have done; it previously
asserted the animated expectations and therefore reported the correct behaviour as a failure.

**"The list is empty" is not "the project was cleared", and conflating them is the whole bug this
design avoids.** The reporting account has 78 projects, 64 of them guides, and most are empty on most
days — so celebrating whenever an empty list is seen would throw confetti for work nobody did, every
time one is opened. The all-projects feature already solves this in two parts: `useReachEmptyInbox`
detects the `>0 → 0` **transition** and persists an achievement day, and the celebration hook keys off
that record rather than off the live count (which is what lets it fire when you open the board hours
later). AT-2492 copies that shape one level down with **localStorage in place of Firestore** — it is
purely visual, and a write on the task-completion path is what AT-2340 exists to avoid.
`projectEmptyInboxCelebrationMarker.js` therefore holds **two** stores over the shared
`dayCelebrationMarker` factory (`reached` and `celebrated`), in their own namespace: a user routinely
earns the small and the big celebration within a second of each other, when the last task of the last
project falls, and a shared namespace would let either silently spend the other.

Three things are load-bearing. The transition rule is **strict** (`didProjectReachEmptyInbox`: both
sides finite, the new one exactly `0`) because a count that becomes `undefined` is an absent answer,
not a cleared project — `clearSidebarTasksAmount` wipes the whole map on an account switch, and a
project with nothing due today never gets a key for that user at all; the celebration gate is
deliberately **looser** (`projectTodayListLooksClear`, "not a positive count") because after a reload
that same project reads `undefined` rather than `0`, which is the ordinary shape of the "cleared this
morning, opened this afternoon" case. The decision lives in **`OpenTasksByProject`**, the one
component that stays mounted for every project whether or not that project has anything to show —
not in `OpenTasksByDate` (where the first pass put it), which unmounts with the block it is trying to
animate, and not in the empty block itself, which only mounts once the list is already clear and so
could never see the transition. And `useProjectCompletedSweep` does its **own** transition detection
as well as reading the record: effects run child-before-parent, so on the tick the count reaches zero
the app-wide `useReachProjectEmptyInbox` (mounted in `InitLoadView` beside `useReachEmptyInbox`) has
not written its record yet, and a hook that only read it would never fire for the live case.

Gates that decide who may spend the day, each closing a way of celebrating something that did not
happen: **the project line must actually be on screen, or have just left because of this very
clearing** (the AT-2445 lesson — a marker spent by a frame nobody saw is a celebration that silently
never happens; in All Projects a project cleared earlier and arrived at later renders no header at
all, so the day stays unspent and its own board can still celebrate it — but see the probe note
above for why "on screen" alone was too strict), no active task filters (`thereAreNotTasksInFirstDay` and the filtered store both
describe a FILTERED list, so a filter empties a project without it being done), the board is the
logged user's own, and not an assistant profile board. `OpenTasksByDate` keeps exactly one gate of its
own — `dateIsToday` — because it renders once per date section and with Later expanded several can be
empty at once.

One dependency worth not breaking: `PROJECT_LINE_EXIT_HOLD_MS` > `SWEEP_TOTAL_MS`, and
`PROJECT_CELEBRATION_CLAIM_SETTLE_MS` > the hold. The sweep's timer is started from the overlay
inside `ProjectHeader` and the hold's from `OpenTasksByProject`, so nothing guarantees their order;
both are derived rather than hand-tuned, and pinned from both sides.

Known limit, and it degrades in the safe direction: the reached-record is per device, so clearing a
project on your phone and opening it on your laptop shows no celebration. Pinned by
`projectEmptyInboxCelebrationMarker.test.js`, `useProjectCompletedSweep.test.js` (the rules and the
hold, mutation-checked), `ProjectCompletedSweep.test.js` (the visual contract — note the RN animation
driver runs on rAF and does NOT advance under jest fake timers, so runs are driven by hand through
the `Animated.Value` the component interpolates), `OpenTasksByProjectCompletedSweep.test.js` (the
board-level conflict: the line stays for the sweep AND still leaves afterwards),
`hooks/useReachProjectEmptyInbox.test.js`, and `ProjectEmptyInboxCelebration.test.js` — the last of
which renders the real sweep against the real all-projects block and asserts comparatively, so a
future change that quietly hands the small celebration confetti or a viewport-escaping layer fails
the build. Plus `browser-tests/at2492`, which is the only place the sweep is ever seen actually
painting: a suite that stubs reduced motion but not `window.matchMedia` still gets one fully
animated commit, which is enough to hide a swallowed run, so both jest suites now drive the media
query as well.

### The cleared project's line disintegrates, and the task row does not (AT-2495)

**The 1.2s right-to-left dust disintegration belongs to the PROJECT line, and putting it on the task
row first was the mistake worth remembering.** The ask — "make it look like the line disappears the
way Thanos snaps his fingers" — was about the project line; the first pass read it as the completed
task row and shipped it there. It is not a matter of taste which row gets it: a task is completed
dozens of times an hour, often in bursts while a list is cleared, and **every one of those
completions holds its Firestore write for the length of the animation** (`COMPLETION_HOLD_MS`), so
the cinematic version cost 1950ms per row against 1070ms. A project's line leaves the board at most
once per project per day, and only ever because something worth marking has happened. That scarcity
is the whole licence for the effect, and it is also why the celebration lives there and nowhere
else. The task row therefore has its AT-2404 exit back unchanged — 320ms of height→0, opacity→0 and
a 6px lift — pinned by the `leaves by collapsing` case in `TaskPresentationCompletion.test.js`,
because the modules it would need still exist one directory away. The other half of AT-2495 stayed:
the completion motion still plays when a task is finished from the long-press checkbox popup
(`taskCompletionHandoff.js`).

**The exit is the sweep's fourth stage, not a second animation after it.** AT-2492's run is
FILL → SHIMMER → PULSE → SETTLE; a line that is LEAVING replaces the 660ms settle with the 1200ms
disintegration, so the whole thing is 3320ms rather than 2780 and reads as one gesture. The settle is
subsumed rather than skipped: the sweep overlay is a CHILD of the masked row, so the dissolve front
carries the coloured wash and the accent bar off with everything else — fading them out first and
then dissolving an already-plain row would spend 660ms throwing away the thing worth watching.
Nothing waits on any of it; the only cost is `PROJECT_LINE_EXIT_HOLD_MS` (~3.4s), which postpones
the board dropping a block it has already decided to drop.

**Which of the two stage-4s runs is read 2.1 seconds in, from a ref, and that is load-bearing.** The
celebration starts on the `sidebarNumbers` snapshot; "the board is dropping this block"
(`thereAreNotTasksInFirstDay`, threaded down as `completedSweepLineWillLeave`) arrives through a
different listener and is routinely SECOND — the same skew `PROJECT_SWEEP_PROBE_MS` exists to
absorb. Deciding at `start()` would therefore have picked the settle for the ordinary case and
silently lost the disintegration, and it fails invisibly, because a settle is a perfectly
plausible-looking animation. The value passed down is `baseHideProjectData`, deliberately **not**
`hideProjectData`: the second is false for the whole hold — that is what the hold IS — so it could
never say "this line is leaving".

**Since the rounded project-card redesign, the mask goes on the whole card; the particles go beside
it (AT-2535).** Masking the old 57px `ProjectHeader` left the new `ProjectSection` surface, body
padding and rounded corners behind until the block vanished abruptly. `ProjectSection` therefore
owns `useProjectCompletedSweepMotion` + `useProjectLineExit` and masks/collapses its complete
`Animated.View`. The sweep itself must live in `ProjectSection` as
an absolute-fill CHILD of that node: leaving it in `ProjectHeader` keeps its old `top: 20` /
`bottom: 1` content-band geometry, so only ~35px of a potentially much taller card is coloured even
though the mask correctly erases the whole card. Its tint is the resolved
`palette.PROJECT_ITEM_ACTIVE`, the exact colour `ProjectHeader` paints, not the raw marker colour;
the latter has the same hue but is a visibly brighter shade. The same resolved tint feeds the
sparks. `ProjectLineDisintegration` is a SIBLING of that masked card — a child would be erased by the
very front it is shedding — inside a wrapper `View` so its absolute placement resolves against that
card and nothing else. The card's resolved `marginBottom` is supplied to the exit separately because
`onLayout` excludes margins; it interpolates to zero with the height, avoiding a final spacing jump
when the hold unmounts. Two failure modes are guarded
explicitly: an exit whose verdict is **withdrawn** mid-run (a task landing back in the project) is
reset, and an exit the board **never finishes** is put back after `EXIT_RECOVERY_MS`, because an
erased zero-height card is a hole the user can neither see nor click and has to reload to clear. The
card's height is frozen when the exit begins, so the collapse cannot overwrite what it is collapsing
from and the particle layer keeps the full height while the card closes underneath it.

**The celebration is nine sparks, and it must never become confetti.** AT-2492's ranking rule
stands: the all-projects empty inbox owns confetti (46 pieces, gravity, spin, a `position: fixed`
layer that escapes to the viewport), and clearing one project stays smaller in KIND. So these are
struck OFF the dissolve front on the same `particleLiftOff` derivation the dust uses — the
celebration is visibly caused by the line leaving rather than thrown over it — they rise and twinkle
(grow into their peak, where a mote only ever shrinks), nothing falls or spins, they carry the
project's own colour with every third one gold so a pale project still reads, and the layer is
`position: absolute` bounded to the project card. Their life is CLAMPED to `COLLAPSE_START` rather than
tuned to fit, so `SPARK_LIFE` can be retuned without leaving a particle drifting while the board
pulls the content below up through it.

Pinned by `projectLineDisintegration.test.js` (the mask arithmetic re-derived from the CSS spec, the
grain, the dust and the celebration), `ProjectLineDisintegration.test.js`,
`projectCompletedSweepMotion.test.js` (the branch, both arrival orders, both recoveries),
`ProjectHeaderLineExit.test.js` (the wiring — the mask on the complete card, animated spacing, the particles outside it,
and every other board in the app unaffected), and the AT-2495 blocks in
`ProjectEmptyInboxCelebration.test.js`, which measures the sparks against the real all-projects
confetti so a future change that quietly promotes them fails the build. Plus `browser-tests/at2495`,
which is the only place any of this is ever seen: jsdom drops `mask-image` without a word and
`__mocks__/react-native.js` stubs `Animated.timing`, so it screenshots the card every ~50ms and counts
surviving pixels per column, in four modes (leaving, late verdict, staying, reduced motion).

### Per-project completion sweep is disabled (AT-2551)

The per-project FILL → SHIMMER → PULSE → DISINTEGRATE run above is no longer connected to the open
tasks board. After the rounded-card change its overlay covered the entire project card, and the
shimmer plus pulse read as two page-wide flashes when a project became empty. `OpenTasksByProject`
therefore does not call `useProjectCompletedSweep`, pass completion-run props to `ProjectSection`, or
hold a cleared All Projects card for the animation. A cleared card leaves as soon as the existing
empty-project condition says it should. The selected-project header and empty illustration remain
visible but static, while task-loading skeletons continue to use their independent readiness flags.
The animation modules remain available for now so this product decision is a small, reversible
wiring change rather than a broad deletion of the earlier motion work.

AT-2558 adds one narrow exception: when any genuine top-level task completion **or user-facing
postpone out of Today** is followed by the board confirming that its project is leaving, the card
gets AT-2495's original 1.2s right-to-left mask, dust and sparks. It starts the disintegration
directly through `projectDisintegrationMotion`; the broad FILL → SHIMMER → PULSE colour sweep stays
disconnected. Completion reports before its held write; postpone reports from the shared
`postponeTaskWithMotion` coordinator after the row's short exit and immediately before its write.
That ordering means the exit does not depend on which of the open-task and sidebar snapshots arrives
first. It also keeps the signal at the UI boundary that knows a mounted, top-level Today row is
actually changing its placement date: do not publish from generic Firestore due-date helpers, which
also serve background, bulk, subtask and non-Today changes. Quick dates, custom calendar dates,
Someday and single-task auto-postpone all converge on this coordinator. Date-list drag/drop only
reorders inside one list (cross-list drops remain unimplemented), and bulk organize mode remains
excluded. A signal alone cannot start the exit; filters, workflow handoffs, subtasks, projects with
other visible content, selected-project boards, assistant profiles and reduced-motion paths retain
the immediate/static behavior above. If new work lands while the card is dissolving, both the hold
and mask are withdrawn immediately so the live project returns whole and clickable.

AT-2565 applies the same handoff one level down when that postponed task belongs to a goal. The
shared `postponeTaskWithMotion` coordinator publishes the goal id after the task row's exit and
immediately before its write. `useGoalSectionExit` still requires the goal to be absent from both
the populated and empty-goal lists before it holds the existing row for the AT-2507 fade/collapse,
so the signal cannot decide visibility or remove a goal that has its own Today reminder. Dragging,
deleting, reassigning, re-goaling, goal-level postpone, non-Today lists, filters, organize mode and
reduced motion keep their existing immediate/static behavior. Completion and task-postpone events
share the in-memory goal-task-exit channel; no Redux or persistence state is added.

### GPT-Live voice calls (in-app, phone, WhatsApp)

Every assistant call uses GPT-Live (`gpt-live-1`) for speech and client delegation to the current
assistant's configured chat model, instructions, history and tools. Voice is 40 Gold/min with
a 15-second minimum; backend reasoning uses the assistant's normal model rate. In-app calls use
WebRTC; phone and WhatsApp calls arrive over SIP as `live.transport.incoming` and run on the same
`assistantLiveController`, which greets SIP callers itself (no browser gates playback) and keys
transcripts, tool `sourceChannel` and billing on the session's `channel`. The Realtime SIP path
(`realtime.call.incoming`, `OPENAI_REALTIME_MODEL`) is now only a fallback while the OpenAI webhook
subscription still names it. See `functions/WhatsApp/GPT_LIVE_CALLING.md` for session, billing,
interruption, rollout and verification details. Keep the shared chat execution path and
model-specific pricing; do not introduce a separate voice backend model.

**A PSTN phone call is the account holder only when the carrier says so (NV-35).** Twilio passes
the STIR/SHAKEN verdict as `StirVerstat`; `handleIncomingPhoneCall` records it on the session as
`callerVerified` / `callerAttestation`, and only `TN-Validation-Passed-A` counts. Any other value,
or none (international calls, carriers without STIR/SHAKEN, sessions from before this change), makes
`runLiveAssistant` run as an unverified caller (`functions/shared/callerVerification.js`): no
`getOptimizedContextMessages` (no chat history, memory, instructions or project data) and no Anna
context, a fixed context saying the account cannot be used, `runtime.callerIdentityUnverified`, which
`filterAllowedToolsForRuntimeContext`, `isToolAllowedForExecution`, `interactWithChatStream` (no
implicit `load_skill` or wiki tools) and `resolveKnowledgeBaseAccess` all honour, so only `web_search`
remains, and no `post_voice_answer_in_chat`. WhatsApp and in-app calls are not affected. The
transcript still lands in the account's daily topic for display, but each turn carries
`callerUnverified: true`, and `getOptimizedContextMessages` and the WhatsApp `getConversationHistory`
skip such comments, so a later run never reads a stranger's words as the account holder's. Residual:
an unverified call still spends the account's voice Gold.

**A voice call is a read of its topic, so it is gated like one (NV-28).** `startAssistantBrowserCall`
loads the topic's recent comments into a live session the caller controls. `resolveBrowserCallTopic`
therefore requires `projects/{projectId}.userIds` membership and a place in the topic's `isPublicFor`,
the same rule `assertObjectAccess` applies to `askToBotSecondGen`. It used to accept anyone listed in
`creatorId`, `lastEditorId`, `members` or `usersFollowing`, and `members` keeps every former commenter
after a topic is made private.

### The iOS shell answers native bridge calls from its own main frame only (NV-33)

Capacitor registers its `bridge` script message handler with `WKUserContentController.add(_:name:)`,
which WebKit exposes to every frame, and dispatches any message to a plugin without checking the
sender. An HTML artifact framed in the app (code a model or a member wrote) could call
`IosShareExtension.setCredential` and send every later share to its own server.
`AlldoneBridgeViewController.capacitorDidLoad` therefore replaces that handler with
`MainFrameBridgeMessageFilter`. The filter forwards only messages from the main frame whose origin
is the app's own `serverURL`. `CAPBridgeViewController.loadView` is `final`, so swapping the
handler is the only hook. A new native plugin needs nothing extra. The share endpoint is pinned in
three places, kept in step by hand: `IosShareEndpointPolicy` (plugin `setCredential`),
`ShareViewController.isTrustedShareEndpoint` (separate target) and `isTrustedIosShareEndpoint` in
`utils/iosShareExtensionCredential.js`. All three require https, a `europe-west1-alldone{aleph,staging}.cloudfunctions.net`
host and the `/iosShareTask` path. The local emulator URL is allowed in debug builds only. The JS
side re-mints a credential whose stored endpoint fails the check even when the user id matches,
which is what used to let a planted endpoint survive. Native changes ship only with a new iOS shell
release (TestFlight/App Store), not over the air. Pinned by `utils/iosShareExtensionCredential.test.js`.

### Assistant voice calls survive the background differently on every platform (AT-2496)

**The call is a browser WebRTC connection to OpenAI, and the "recording" is a server-side text
transcript.** `AssistantVoiceCallButton` owns the `RTCPeerConnection`, the mic stream and a hidden
`<audio>` element; the Cloud Function only brokers the SDP, and the sideband controller writes
transcript turns into the call topic — no audio is ever recorded. So "the call continues in the
background" means exactly one thing: the peer connection and the capture keep flowing while the
page is hidden. What can keep them flowing is decided per platform, and
`components/UIComponents/assistantCallBackground.js` is the one place that spells it out:
desktop and Android (a TWA renders in Chrome, which owns the mic and its own "microphone in use"
notification) keep a capturing tab alive on their own; the **iOS Capacitor shell** needs the
`audio` entry in `UIBackgroundModes` (`ios-app/ios/App/App/Info.plist`) because WebKit proxies the
web view's AVAudioSession into the host app, so the app's background mode is what keeps the
capture alive after Home / lock; and an **iOS browser or home-screen PWA has no lever at all** —
WebKit mutes the capture track while hidden and unmutes it on return, which is why the connected
state shows a "keep Alldone open" hint there and nowhere else.

Two rules follow and the component wires them to the connection's lifecycle. **A hidden page never
opens the microphone**: `getUserMedia` is refused from a hidden page, and on iOS the muted track
comes back by itself, so a stall or an `ended` track seen while hidden is only remembered
(`micCheckPendingRef`) and replayed once visible — after `RETURN_MIC_SETTLE_MS`, because replacing
the track during the window in which WebKit unmutes the original would drop the first words spoken
after coming back. The first version of the health monitor did the opposite and, on iOS Safari,
called `getUserMedia` from the background on every stall. **A `disconnected` peer connection gets a
visibility-dependent grace** (`resolveDisconnectGraceMs`: 8s visible, 60s hidden), re-armed on
every visibility flip so a call that really died in the background still ends within seconds of
return rather than a minute later; `connected` cancels it and only `failed`/`closed` are terminal
on their own. The iOS shell additionally gets `CallAudioSessionPlugin.swift` (`CallAudioSession` on
`window.Capacitor.Plugins`): `begin()` configures `.playAndRecord`/`.voiceChat` **before** the web
view opens the mic and reports whether the build carries the background mode, `end()` releases
the session **after** the tracks are stopped; both are best-effort and a failing plugin never stops
a call. The Media Session registration is what Android's ongoing-call notification is built from,
and its `hangup` action is the only one wired to anything (play/pause/stop stay inert — a headset
"stop" must not hang up).

Only a device can verify any of it: jest has no WebRTC and no visibility semantics, so
`AssistantVoiceCallButton.test.js` drives the REAL component against a fake peer connection and
pins the rules, not the platform behaviour. Note the suite unmounts every tree it renders — a
still-mounted component keeps its `visibilitychange` listener and reacts to the NEXT test's events
with the next test's `getUserMedia` mock, which is how a "called twice" assertion came back as
three. The Info.plist mode and the plugin are native shell changes and therefore need a TestFlight
/ App Store release; OTA cannot add a background mode.

### Rambler dictation — a microphone can hand the browser digital silence (AT-2357)

On macOS, `getUserMedia({ audio: true })` enables Chrome's default processing chain
(echoCancellation/noiseSuppression/autoGainControl), which routes capture through the system
**Voice-Processing I/O** audio unit. With some input/output device combinations — built-in mic
while output goes somewhere else, virtual audio devices, mic modes — that unit hands the page a
track of **literal digital silence**, while macOS' own input-level meter (which never goes near the
browser) keeps showing a healthy level. It works with AirPods because input and output are then the
same device. **The user-visible symptom is a server error**: MediaRecorder happily encodes the
silence, the blob is non-empty (Opus compresses silence to a few hundred bytes/s) so the client size
guard passes, the clip uploads, Gold is spent, and Deepgram correctly reports nothing —
`EMPTY_TRANSCRIPT` → "No speech detected". The signature in the Cloud Run logs for
`processramblesecondgen` is the **payload size**: the reported failures were 3.7–5.9 KB against
~102 KB for working takes of the same length in the same session.

`hooks/rambleMicCapture.js` therefore measures the captured signal in the browser, and
`useRambleRecorder` acts on it twice. **Before** recording, `acquireDictationStream` probes (≤350ms,
and a healthy mic clears it on the first read) and re-acquires the mic with the processing chain
disabled when the device delivers bit-exact silence or the track is already `muted`; the aliveness
test is `peak > 0`, so any energy at all — including inaudible self-noise — counts as a working
microphone, which is what keeps a quiet room from being mistaken for a dead device. Because the
rescue happens before `MediaRecorder` starts, the broken take never happens and no speech is lost.
**After** recording, a peak below `SILENT_PEAK_THRESHOLD` (~-66 dBFS, three orders of magnitude
under speech) means the take is never uploaded: no Gold, and a message that names the device instead
of blaming the speech. Everything degrades to "unknown" without Web Audio, and **unknown never
blocks an upload** — a false "silent" verdict would throw away a recording the user actually made.

What is remembered, and what retires it, is the fiddly half. A capture that is silent processed
**and** alive raw is the only proof that the processing path is the broken one, so only that
combination writes the learned record (`rambler.captureMode`), and the record carries the
**deviceId** it was learned on. It is retired three ways, because a workaround that outlives its
hardware is the same bug in reverse: a `devicechange` event drops it (plugging in headphones or
switching the system default does **not** change the `"default"` deviceId, so the event is the only
signal there), a recording whose actual device differs from the learned one re-acquires with the
normal defaults and gets a fresh verdict, and a raw capture that is silent too clears it rather than
pinning a degraded mode forever. Above all that sits the user's own setting
(`rambler.micMode`, Settings → Customizations → "Dictation microphone": Automatic / Standard /
Compatibility) — deliberately localStorage and not the user doc, since it describes one machine's
audio hardware. **An explicit choice is obeyed as written**: no probe, no second acquisition, and a
silent take is reported without overriding it. Pinned by `hooks/rambleMicCapture.test.js` and the
`silent microphone (AT-2357)` block in `hooks/useRambleRecorder.test.js`.

**The processing chain was only half of it: the browser also hands you a different microphone than
macOS does.** The first fix shipped and the same user still failed — with an error naming
"MacBook Pro Microphone" while macOS System Settings was set to his webcam, level meter healthy.
A browser keeps its **own** microphone preference (Chrome: Settings → Site settings → Microphone,
and an installed PWA gets a **separate** entry from the browser tab), and a device pinned there, or
a stale cached `"default"`, outranks the system input source. No web API can read or change that
preference — `enumerateDevices` will not tell you which entry the browser would pick, and
`getUserMedia({audio: true})` just returns it. So switching the capture mode on that device could
only ever produce silence more efficiently, which is exactly what the user saw. Two consequences:
**every re-acquisition pins the device** (`deviceId: { exact }` — `ideal` is a preference the
browser may silently ignore, and a silently ignored pin means the probe measured one mic and the
recording used another), and when the acquired device is silent **both** ways the automatic path
**walks the other audio inputs** (`findWorkingInputDevice`, capped at `MAX_FALLBACK_DEVICES`) and
records from the first one that is alive, remembering it as `rambler.inputDevice`. Declining to
record from a device that demonstrably produces nothing is the only lever the page actually has.
Alias entries (`default`, `communications`) are never walk candidates — they point at the hardware
we just measured — and neither are devices sharing its `groupId` or label; a candidate that cannot
be opened is skipped rather than retried unpinned, because the unpinned retry would reopen the
device we are escaping. The learned device retires exactly like the learned mode (devicechange,
still-silent raw), and **an explicit device chosen in Settings → Customizations → "Dictation
microphone" is never walked away from**, same rule as the mode. That row now lists the real devices
(`rambler.micDevice`), which is the only thing that can overrule a browser pinned to the wrong mic;
labels are empty until permission has been granted once, hence the opt-in "Show my microphones".
The failure message had to change too: naming only the device we recorded from reads as an
accusation to someone who picked a different one in macOS, and it sends them to the one place that
cannot fix it — it now says the microphone is the **browser's** choice and points at the picker.
The reporting user confirmed both halves: Chrome's site-settings microphone was pinned to
"MacBook Pro Microphone", and he was in the **installed PWA**, whose entry is separate from the
browser tab's. He also could not open DevTools — which is why `rambler.lastDevice` records the
device each recording actually came from and the picker shows it under "System default": from
inside a page there is otherwise no way to learn which microphone that resolves to, and a settings
row reading "System default" teaches a mis-pinned user nothing.
Pinned by `components/UIControls/RambleButton.test.js` (message branch) plus the device blocks in
the three suites above.

### Holding the floating "+" is a hold on the add-task mic (AT-2823)

Pressing and holding the task board's floating "+" (`FloatingAddTaskButton` → `AddTaskTag`
`holdToDictate`) enters the same push-to-talk mode as holding the mic inside the open add-task popup:
ring, slide-to-cancel, timer, and release → transcribe → create the task. It is **not** a second
recorder. After `PUSH_TO_TALK_HOLD_MS` (400ms) the "+" opens the popup and hands the press still in
progress to the title input's `RambleButton` through `components/UIControls/pushToTalkHandoff.js`
(`AddTaskTag` → `RichCreateTaskModal` → `MainModal` → `TaskEditForm` → `InputArea` →
`CustomTextInput3` → `RambleButton`, prop `pushToTalkHandoff`). The "+" keeps tracking the gesture
with `usePushToTalkGesture`; the mic claims the handoff once, starts recording and shows the ring
immediately, and the forwarded release takes the ordinary `resolvePushToTalkRelease` path. Unlike the
mic, nothing records on press-down, because a tap on "+" must never switch the microphone on, so the
first ~400ms are not captured (product decision). A tap shorter than that opens the popup on release,
as before. Two click traps are handled: the mouse press's trailing `click` would reach the popover's
outside-click dismissal, since the "+" stops taking pointer events once a task editor is open, so
`utils/swallowNextClick.js` consumes it (mouse/pen only, since touch produces none). RNW's
`onPress` is also suppressed for `POINTER_CLICK_SUPPRESSION_MS` so the popup is not remounted, and
keyboard activation still opens it. Pinned by `components/Tags/AddTaskTagHoldToDictate.test.js`
(real `AddTaskTag` + real `RambleButton`, real DOM events) and `pushToTalkHandoff.test.js`.

**Letting go closes the popup at once, and the task is created in the background (PT-5424).** Every
release of a hold closes the popup in `AddTaskTag` (`closePopupNow`), whether the take is submitted,
slid out to cancel or too short, so "+" can be held again for the next task while the previous one is
still being created. That only works because the take outlives the popup, which takes two pieces. The
mic stops a submitting take with `stop({ detach: true })`, and `useRambleRecorder`'s unmount cleanup
then leaves it alone: a real MediaRecorder fires `onstop` after `stop()` returns, i.e. after the
popup unmounted, and the old cleanup cancelled it there, losing the task silently. And
`RichCreateTaskModal` registers `createDictatedTaskInBackground` on the handoff
(`setBackgroundSubmit`) on every render. On release `RambleButton` hands the take to it
(`runDetachedRambleSubmit`): it transcribes under the bottom-left `LoadingData` spinner
(`runWithLoading`) and creates the task through the same `persistNewTask` as Enter, i.e. with the
popup's project and Automatic routing. Nothing is inserted into the closed editor. Failures alert
(`reportRambleProcessingError`, "Task could not be created"); offline stays silent as before because
the connection toast explains it. A hold-opened popup never focuses its title (`InputArea`), which on a
phone would open the keyboard under the finger. The hold starts on "Automatic" in All projects and
on the open project inside a single project. Pinned by the PT-5424 cases in
`AddTaskTagHoldToDictate.test.js`, `useRambleRecorder.test.js`, `FloatingAddTaskButton.test.js`,
`RichCreateTaskModal/InputArea.test.js` and
`__tests__/UIComponents/FloatModals/RichCreateTaskModalBackgroundDictation.test.js`.

**The same holds for a hold on the popup's own title mic (PT-5425).** There is no opener to close
the popup, so the mic asks the host: `RambleButton`'s `claimBackgroundSubmit` →
`CustomTextInput3`'s `claimDictationBackgroundSubmit` → `TaskEditForm` (Enter's guards: mention
picker, tag editor, assignee popup) → `RichCreateTaskModal.claimDictatedTaskInBackground`, which
answers `null` (the interactive insert-then-Enter path stays) or `{ dismiss, submit, onFailed }`.
Order matters: the mic stops the take with `{ detach: true }` FIRST and calls `dismiss` only when
the recorder promised to deliver, so a take too short to keep never closes the popup. A draft with
dropped `blob:` files declines, because the popup revokes them on unmount. `dismiss` also locks the
popup's single-flight guard, so one release creates one task. `CustomTextInput3` splits the draft at
the caret at release time through the same `getFinalText` as typing (`backgroundDictation.js`), and
`submit` receives that composed title plus its linked-object URLs. Every failure (a recorder error
such as a silent microphone, a failed or empty transcription, a failed write, and an `onstop` that
never arrives, after `DETACHED_DELIVERY_TIMEOUT_MS`) reopens the draft in the global
`DictationTaskRecoveryModal` (`dictationTaskRecovery.js`), with the dictated title once it is known.
A failed write after a "+" hold is restored the same way. Pinned by
`components/UIControls/RambleClaimBackgroundSubmit.test.js`, the PT-5425 blocks of
`RichCreateTaskModalBackgroundDictation.test.js` and `useRambleRecorder.test.js`,
`TaskEditFormBackgroundDictation.test.js` and `CommentsTextInput/backgroundDictation.test.js`.

### Dictation vocabulary — "Alldone" is a homophone of "all done" (PT-4648)

Transcription biases towards a curated product glossary in **two** places, and both are required.
`functions/shared/transcriptionVocabulary.js` is the single source: `getTranscriptionKeyterms()`
feeds Deepgram's Nova-3 `keyterm` parameter (the acoustic layer, in
`functions/Notes/deepgramTranscribe.js`), and `buildVocabularyPromptSection()` is embedded in the
rambler cleanup **system** prompt (the semantic layer, `functions/Assistant/ramblerCleanup.js` — it
sits in the system message because it never varies, so it belongs in the prefix `prompt_cache_key`
caches).

**One layer is not enough, and the reason is the brand itself.** "Alldone" is pronounced exactly
like the ordinary English phrase "all done", so boosting it acoustically trades one error for its
mirror image: _"are we all done here?"_ starts coming back as _"are we Alldone here?"_. Only the
cleanup LLM has the surrounding sentence and can tell the product from the adjective, which is why
the prompt rule is deliberately **two-sided** — it protects the ordinary phrase as explicitly as it
pushes the brand. This is also why Deepgram's `replace` (find & replace) is **not** used here: a
blind `all done` → `Alldone` rewrite would clobber every legitimate use of the phrase.

**`language: 'multi'`, never `detect_language`.** `keyterm` requires an explicit language, and
`detect_language` is the one mode the docs never bless alongside it. Worse, detection **silently
downgrades the model**: it covers 35 languages, Nova-3 does not, and when the detected language is
missing from the requested model Deepgram walks down Nova-3 → Nova-2 → Nova-1 → Enhanced → Base on
its own. **Nova-2 does not support `keyterm` at all**, so keyterms would have died on exactly the
requests nobody can see. `multi` is Nova-3 multilingual (en, es, fr, de, hi, ru, pt, ja, it, nl)
with **word-level** code-switching, which also fits dictation better than per-clip detection — a
mixed-language sentence cannot be represented by picking one language. Detection would _override_
`language`, so the two must never both be set. The accepted trade-off is that a language outside
those ten transcribes worse than it did under detection; the logged `detectedLanguages` is what
makes that visible if it ever happens.

**Failure is absorbed, not predicted.** Keyterm support per detected language is not documented, and
a rejected parameter would take down dictation for whoever speaks that language — far worse than
losing a spelling boost. So a 4xx-shaped rejection retries **once** without keyterms and sets
`keytermFallback`; a transport/5xx failure is _not_ retried (it would just fail twice and double the
latency of an outage). A silently degraded configuration therefore shows up in the logs instead of
only in transcript quality.

**Adding terms:** distinctive proper nouns only. Deepgram explicitly warns that generic common words
dilute the prompt and cause false boosts, so no `task`/`goal`/`note`/`assistant` — they are
transcribed correctly already and would only cost accuracy elsewhere. Budget is 500 tokens per
request (Deepgram errors past it; the docs recommend 20–50 terms). Casing is preserved, so write
each term exactly as it should appear. **Never use the legacy `keywords` weight syntax**
(`keyterm=Alldone:2`): Deepgram does _not_ error on it — it accepts the whole string as one literal
keyterm and boosts nothing, so it fails silently and looks like keyterm simply not working.

**The static glossary is the floor; a per-user list is merged on top of it.** A workspace's own
proper nouns — colleagues' names, their employers, project and assistant names — are exactly the
words a speech model cannot guess, and they are per-user by definition. `mergeVocabulary` in
`transcriptionVocabulary.js` is the **only** place the final list is decided, and both
`getTranscriptionKeyterms()` and `buildVocabularyPromptSection()` are thin wrappers over it: if the
acoustic and cleanup layers were allowed to hold different lists, the cleanup could "correct" a
spelling Deepgram was told to emit and the two halves would fight. The static glossary is placed
first and can never be displaced by a workspace term — combined cap 40 (`MAX_TOTAL_KEYTERMS`),
dynamic cap 30.

**Do not put a workspace scan on the transcription critical path (~1s today).** The per-user terms
are precomputed into `users/{uid}/private/voiceVocabulary` (owner read/write under the existing
`users/{userId}/{document=**}` rule — **no rules change**, and the Admin SDK writes it), and a
dictation pays exactly **one document read** for them. `functions/shared/userVoiceVocabulary.js`
implements a **stale-while-revalidate** cache: fresh (< 24h) is used as-is; **stale is used anyway**
for the dictation in flight while a rebuild runs alongside it; only a **cold** miss waits, bounded
by `COLD_BUILD_TIMEOUT_MS`, so a user's first-ever dictation already benefits without a slow
workspace costing them their text. The cache read itself is bounded too
(`CACHE_READ_TIMEOUT_MS`) — it sits directly in front of the Deepgram call on every dictation, and
a timed-out read deliberately does **not** fall through to a build, because a degraded Firestore
would only compound the delay. Triggers on contact/project/assistant writes were rejected as
the refresh mechanism (they pay on every contact edit, for every member, to keep a list fresh that
is only consumed when somebody dictates), as was a scheduled rebuild (it scans the workspaces of
users who never touch the microphone). The lazy cache is self-limiting: a user who never dictates
costs nothing, one who dictates fifty times a day rebuilds once.

**The rebuild must be awaited before the response returns.** Cloud Run may freeze the container once
a response is sent, so an un-awaited rebuild is a cache that never fills — the user would silently
get the static glossary forever and nothing would say why. It started before transcription, so by
the time `processRamble` drains it (`VOCABULARY_REBUILD_DRAIN_MS`) it has already had the whole
transcription + cleanup window and costs no wall clock in practice.

**Two things the scan must not do.** It must filter contacts by `isPublicFor` — this runs through
the Admin SDK, which **bypasses security rules**, so without the filter a colleague's private
contact leaks into another user's keyterm list through a spelling hint. And it must stay on
**active** projects (`resolveScopeProjectIds`): on the reporting account that removes 64 guide
projects full of other people's names, which is also the difference between a bounded scan and an
O(projects) one. Caps are `MAX_PROJECTS_SCANNED` 25 / `MAX_CONTACTS_PER_PROJECT` 200, and what was
skipped is reported rather than silently truncated.

**Ranking is written to reject, not to collect** (`functions/shared/voiceVocabularyTerms.js`, pure
functions). A generic keyterm is not neutral — Deepgram warns it dilutes the prompt and costs
accuracy on every other word — so a candidate must clear a stoplist (Alldone's own domain nouns,
organisational filler, role titles, legal-form suffixes, function words in all ten `multi`
languages) **and** a structural check: at least one meaningful word shaped like a proper noun.
The structural check is what generalizes, since no stoplist can enumerate every generic phrase
("my project" is rejected by shape, not by list). Contact given names are deliberately dropped
while surnames are kept as separate terms — a phrase keyterm does not boost its parts, and
"Somova" is the word a model cannot guess whereas "Anna" collides across a contact list. Company
legal forms are stripped ("Heyflow GmbH" → "Heyflow"). Score is source weight × recency ×
cross-project repetition, and ties break alphabetically so an unchanged workspace always produces
an identical list — non-determinism there would churn the `prompt_cache_key`.

**The cap is on TOKENS, not on terms — a term count silently fails for non-Latin workspaces.**
Deepgram's limit is 500 tokens, and 40 Latin names cost ~110 while 40 Japanese organisation names
cost ~750. The failure is invisible: Deepgram 4xx → the keyterm-free retry re-uploads the whole
audio buffer, so that user's acoustic vocabulary (including "Alldone") is permanently dead AND
every dictation pays a doubled round trip, with `keytermFallback: true` as the only symptom.
`mergeVocabulary` therefore spends a `MAX_KEYTERM_TOKENS` budget using `estimateKeytermTokens`,
which deliberately OVER-counts (2 tokens per non-ASCII character, one per two ASCII characters) —
verified never to under-count across Latin, Cyrillic, CJK, Arabic and Thai, since under-counting is
the only direction that breaks the request. A realistic Latin list scores 217 of 450, so the
ordinary case loses nothing. Related and deliberate: `isDistinctiveTerm`'s proper-noun shape check
only means anything for scripts that HAVE case — `toUpperCase()` is the identity for CJK/Arabic/Thai,
which is why the naive `word === word.toUpperCase()` acronym test admitted **every** caseless word.
Those are now admitted on length alone via `hasLetterCase`, with the token budget (not the shape
check) bounding the damage. **Known gap:** `GENERIC_WORDS` is Latin/Cyrillic-only, so a generic
caseless word (「テスト」 = "test") is not filtered.

**An incomplete scan must never overwrite a good vocabulary.** `scanProject` swallows per-project
errors and contributes nothing for a project it could not read, so a transient blip produces a
shorter — possibly empty — list that is indistinguishable from a genuinely smaller workspace.
Persisting it would stamp `updatedAt: now`, i.e. mark it **fresh**: one blip during a background
rebuild would destroy the user's vocabulary and then serve the empty result confidently for 24
hours, with `vocabularyCacheState: 'fresh'` in the logs saying everything was fine. So a rebuild
with `failedProjectCount > 0` is discarded when a cached document already exists (`hasExistingCache`),
and written only on a cold cache, where some terms beat none.

**Every failure degrades to the static glossary and nothing throws into the rambler.** Losing the
personalized boost is a bad day; losing the dictation is a broken feature. `getUserVocabularyTerms`
has no rejecting path at all, a failing project contributes nothing rather than failing the build,
and a failed cache write still returns usable terms for the dictation in flight. In `processRamble`
even the `require`s are inside the try/catch — the same shape as the `loadCleanupContext` incident,
where a module-level throw surfaced to the user as "Failed to transcribe audio" — and the
post-billing summary call is guarded too, since a throw there would charge the user and then return
an error instead of their text. The rebuild is drained on the failure paths as well as the success
one (`failAfterDraining`), because `EMPTY_TRANSCRIPT` is the documented silent-microphone symptom
(AT-2357) and repeats: each attempt would otherwise pay for a full scan and have it killed by the
container freeze.

**Two smaller traps.** The contacts query orders by `__name__` **descending**: contact ids are
timestamp-prefixed push ids, so an unordered `.limit()` returns the OLDEST contacts, dropping
exactly the newest colleagues while the recency multiplier ranks the survivors by freshness. It
falls back to the unordered query if Firestore rejects the ordering, because a missing index would
otherwise make the project contribute nothing at all. And `sanitizeStoredTerms` re-applies the
build path's normalizer and limits to terms read BACK from the cache — that document is writable by
its owner under `users/{userId}/{document=**}`, and a stored term containing a newline would escape
the `- <term>` bullet structure of the cleanup **system** prompt.

**Observability:** `[processRamble] timing` carries `keytermCount`, `keytermFallback`,
`detectedLanguages` and `summarizeVocabularyUsage`'s raw-vs-cleaned **counts** — never the dictated
content, so it is safe to leave on. That is the only way to tell the layers apart: a brand hit
already in `raw` means keyterm caught it, a hit appearing only in `cleaned` means the LLM fixed it,
and a confusable form shrinking from raw to cleaned while the brand grows is the mirror-image error.
Pinned by `functions/shared/transcriptionVocabulary.test.js` and
`functions/Notes/deepgramTranscribe.test.js` — the latter drives the **real** `@deepgram/sdk`
against a mocked `fetch`, because the wire format is the thing that breaks and a mocked SDK would
green-light a comma-joined keyterm that boosts nothing in production.

**The per-user terms are counted in aggregate and NEVER named.** The static glossary is Alldone's
own vocabulary, so `Alldone: 2` in Cloud Logging is fine; the dynamic list is made of contact names
and employers, and `Somova: 1` would put a colleague's surname — plus the fact that this user
dictated it — into the logs. `summarizeVocabularyUsage`'s third argument therefore produces only
`vocabularyDynamic` totals, alongside `vocabularyCacheState` (`fresh` | `stale` | `cold` |
`unavailable`) and `vocabularyDynamicCount`. `cacheState` is the one to watch: a persistent `cold`
or `unavailable` means the rebuild never lands and the personalization is silently doing nothing.
Note `unavailable` is reported — rather than `cold` — when every project in a build failed to read,
because "an outage" and "a cold build of an empty workspace" are exactly the two states that log
line exists to tell apart. Pinned by `functions/shared/voiceVocabularyTerms.test.js` and
`functions/shared/userVoiceVocabulary.test.js`.

**Meeting transcription shares the same helper.** `functions/Notes/transcribeMeeting.js` used to
repeat the Deepgram call inline with its own copy of the options; it now calls
`transcribeAudioBase64`, so the model, formatting and vocabulary cannot drift between the two paths.

### A note's body lives in a bucket, and two rules used to disagree about which one (AT-2498)

**A note document carries no `content` field** — the body is a Yjs binary at
`notesData/{projectId}/{noteId}` in a per-environment Storage bucket
(`notescontentprod` / `notescontentstaging` / `notescontentdev`). So every note reader and
writer has to resolve that bucket name, and until AT-2498 they did it two incompatible
ways. `NoteService.getBucketName`, `noteContextHelper` and the assistant's `create_note` /
`update_note` handlers each treat the **deployed project** as authoritative and ignore a
configured value that disagrees with it; `searchHelper.getNoteContent` and the
copy/template/delete paths took `defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET')`
as written. Both rules returned the same answer right up until the production value of that
parameter became `notescontentdev` on **2026-08-29** (the same deploy that moved functions
onto the `firebase-adminsdk` SA). From then on the writers kept writing to
`notescontentprod` while the search indexer asked a bucket in **another Google Cloud
project** for the body, and the production SA cannot read it — so `getNoteContent` threw
`storage.objects.get denied` on **every** note create and update, and no note body reached
Typesense at all.

The failure had no product symptom, which is the part worth remembering: notes saved, the
assistant reported success, the Firestore trigger fired, the AT-2340 content gate correctly
passed — a production trace reads `Processing update for notes …` → `Getting content for
note …` → `Using storage bucket: notescontentdev` → permission denied. Only search went
quietly stale, and note search is exactly the thing nobody notices missing for a week.
`functions/shared/notesStorageBucket.js` is now the single authority
(`resolveNotesBucketName` / `getNotesBucketName`): deployed project identity wins, a
disagreeing configuration is warned about **once per instance** rather than per note, and a
project that is neither production nor staging still honours its configured value — which
is what makes the change provably inert for the emulator, CI and local scripts. Note it
deliberately does **not** match `NoteService.getBucketName`'s stricter rule for unknown
projects (that one forces `notescontentdev` and is pinned by `NoteService.bucket.test.js`);
the two are different questions and both are correct.

**Two smaller reliability gaps on the create path went with it, both invisible for the same
reason.** `onCreateNote` collected its work into a `promises` array and **never awaited it**
— so `createRecord`, which downloads the body and upserts it into Typesense, was
fire-and-forget: Cloud Run may freeze the container the moment the function returns, and an
indexing failure surfaced as an unhandled rejection instead of a failed invocation, which is
how a `storage.objects.get denied` on literally every note create went unreported.
(`onUpdateNote` and `onDeleteNote` have always awaited theirs.) And `persistNote` wrote the
Firestore document **before** uploading the body, merely starting the upload alongside it —
but the document write is what fires the indexing trigger, so the two raced: a trigger that
won read no file and indexed the note with an **empty** body, and nothing re-indexes a note
until its document changes again. Content is now stored first, which is also the order every
update path already used (`updateContentMetadata` saves to Storage, then stamps `preview` +
`lastEditionDate`). All assistant-created notes — `create_note`, contact notes, user memory,
menubar/meeting notes — go through that one method.

**The assistant's `update_note` was never the problem, and it is worth knowing why.** All
three of its content sub-paths (`addFormattedContentToStorage` for prepend,
`applyPatchEditsToStorage` and `replaceContentInStorage` via `updateContentMetadata`) write
`preview` + `lastEditionDate` after saving the body, and that pair is precisely the content
signal `noteUpdateNeedsIndexing` requires — so the sync fires correctly. The caveat is that
those metadata writes are wrapped in catch-and-log blocks that still report the tool call as
successful: if the document update fails, the body has changed, the note document has not,
`onUpdateNote` never fires and the new text is never indexed. Pinned by
`functions/shared/notesStorageBucket.test.js`, `functions/searchHelper.notesBucket.test.js`,
`functions/Notes/onCreateNoteFunctions.test.js` and
`functions/shared/NoteService.persistOrder.test.js`.

### Never read a note with `Y.Text.toString()` where a model or an offset is involved

`toString()` concatenates string content only, so every embed (URL chip, mention, task tag,
image) vanishes, while in Y.Text coordinates each embed still occupies one position. On note
8b4wQWfKyLXpZFtqYsNC (2026-09-28) that cost both ways: the meeting-summary run wrote a calendar
link, `update_note` read the note back via `getStorageContent` (then `toString()`) and showed
`Calendar event: Re-Design Juno — ` with nothing after the dash, so the assistant re-patched the
section seven times; and patch offsets computed on that string landed one position early per
preceding embed. `functions/shared/noteTextProjection.js` is the fix: `projectYText` renders
embeds as text and `toYIndex` maps a text offset back (an offset inside an embed snaps to one
side — embeds are atomic). `getStorageContent` returns the projection, and patch mode resolves
each edit against a fresh projection and maps it into Y.Text. Previews still use `toString()`
on purpose. Pinned by `shared/noteTextProjection.test.js` and the `notes with embeds` block in
`shared/NoteService.test.js`.

Two things from the same run. **A failed tool call is returned to the model as its result**
(`Assistant/toolCallFailure.js`, via `executeToolCallBatch`'s `recoverError`) instead of ending
the run. That run had finished its work and then made a no-op `update_task`, and the user's whole
reply was `Error executing update_task: …`. Cancellation and an exhausted time budget stay fatal,
calls later in the same batch are skipped with a "not executed" result, and after
`MAX_CONSECUTIVE_FAILED_TOOL_ROUNDS` (3) rounds in which every call failed the old stop applies,
so an unattended run's `failOnToolExecutionError` still fires for a genuinely broken tool. This
covers the interactive `storeChunks` loop only; `collectAssistantTextWithToolCalls` (Gmail
labeling etc.) still fails fast. **And each `update_note` took ~50s** because
`SearchService.findNotesBySearchCriteria` listed every project the user belongs to (~190
sequential reads) and then probed each for the note (up to ~190 more). With both `noteId` and
`projectId` it now does three reads (`findNoteInProject`, same membership + visibility rules);
the fallback paths read projects at bounded concurrency and check the caller's project first.

### A date-only dueDate is "due on that day", not a new timestamp (AT-2891)

Codex resent `update_task` with `dueDate: "2026-10-27"` next to every progress comment to keep a
task in Today, and each call wrote the task and posted another "updated task due" feed entry
(eleven in 40 minutes on one task) although every call resolved to the same midnight timestamp.
`TaskService.updateTask` never compared the new dueDate with the stored one. Two rules now apply. An
identical timestamp is no change at all (no write, no `lastEditionDate`, no feed). In the
assistant/MCP funnel (`TaskUpdateService.performTaskUpdate`), a bare `YYYY-MM-DD` on a task that is
already due that day **in the user's timezone** keeps the stored timestamp, time of day included
(`shared/dueDateIntent.js`), and the tool result tells the model to stop resending it. Anything else
is applied as before: another day (including an overdue or Someday task), any value carrying a time,
and a request with `alertEnabled`, where dueDate is the reminder time. Pinned by
`TaskUpdateService.dueDateIntent.test.js` and `TaskService.dueDateNoop.test.js`.

### A recurring task remembers where it was planned, and asks when that matters (AT-2803)

Postponing a recurring task to a later day (or to Someday) stores the date it had before as
`recurrenceOriginalDueDate`, once: a further postponement never overwrites it, moving it earlier
stores nothing, and every new occurrence starts without it. Every writer applies that rule: the
client (`setTaskDueDate`, `updateTask`, `setTaskToBacklog`), auto-postpone, project postpone and,
for assistant/MCP `update_task`, `TaskService.updateTask` via `functions/shared/recurrenceOriginalDueDate.js`.

Completing such a task opens `RecurringTaskDateBasisModal` when the answer can matter: the task was
postponed to another day, **or** it is overdue (`shouldShowRecurringTaskDateBasisModal` in
`recurringTaskDateBasis.js`). It offers the original date, the current due date, today and a custom
date, with rows that name the same day merged. The choice travels as `recurrenceBaseDateOverride`,
normalised to local noon of the chosen day. `calculateNextRecurrenceDate` reads that day in the
assignee's timezone (`timezone` on the user doc), adds the interval and, when the result is not after
the completion, skips ahead on the series' own cadence (anchor + k intervals, so a monthly task on
the 31st stays on month ends). A completion without the popup (on the planned day, early, assistant,
MCP, status picker, bulk) keeps the legacy rule: completion time plus one interval. Pinned by
`recurringTaskDateBasis.test.js`, `RecurringTaskDateBasisModal.test.js`,
`recurrenceOriginalDueDateWrites.test.js`, `functions/shared/recurrenceOriginalDueDate.test.js` and
the AT-2803 blocks of `functions/Tasks/recurringTasksCloud.test.js`.

### A recurrence copy must carry its goal's privacy, not just its goal id

`parentGoalId` and `parentGoalIsPublicFor` are one fact written as two fields: the open-task lists
(`processTaskChange` in `utils/backends/openTasks.js`) group a task under its goal only when the
array names the reader, so a task with a goal id and a null array is filed under "no goal" while
still pointing at one, and the list warns `[OpenTasks] oldTask.parentGoalIsPublicFor missing/invalid`
on its next edit. `functions/shared/TaskModelBuilder.js` used to hardcode the array to null while
passing `parentGoalId` through, and `recurringTasksCloud` clones the whole completed task into it - so
every new occurrence of a recurring task silently dropped out of its goal group (a production sweep on
2026-09-02 found 282 such tasks on one account, all recurrence copies). The builder now resolves the
array through `resolveParentGoalIsPublicFor` (caller's array, else public-for-all, matching
`mapGoalData`'s default for a goal without `isPublicFor`); `migration/backfillParentGoalIsPublicFor.js`
repairs existing documents from the goal's current privacy. Pinned by
`functions/shared/TaskModelBuilder.test.js` and the goal-privacy block in
`functions/Tasks/recurringTasksCloud.test.js`. The client-side `createRecurrentTask` in
`tasksFirestore.js` has no callers; the cloud function is the only producer.

The same two-field invariant applies to follow-ups. `createFollowUpTask` builds its copy through
`followUpTaskBuilder.js`, which carries `parentGoalId`, `parentGoalIsPublicFor`, and the goal lock
key from the source task. An unlinked task must normalize both goal fields to null rather than
leaking a stale visibility projection into the new document. A legacy linked task missing the
visibility projection resolves it from the Goal before the follow-up is written; a failed optional
read preserves the Goal id and does not block creation. Pinned by `followUpTaskBuilder.test.js`.

### Day-rate logging: the target is a ceiling as well as a floor — for calendar time

A project with day-rate logging on (`project.dayRateTimeLog`, `utils/DayRateTimeLogHelper.js`) bills
the day, not the minutes, so its `targetMinutes` is a cap too: a day whose real tasks add up to more
than the day's ceiling has its `statistics/{projectId}/{userId}/{DDMMYYYY}.doneTime` trimmed back to
it. **The ceiling is the target, or the hand-logged non-calendar minutes when those are higher**
(`dayCeilingMinutes`). Overlapping and long calendar events (a workshop, travel, a dinner) are what
inflate a day past the target, so calendar time can only ever fill a day up to it; time typed onto a
non-calendar task is the user's explicit record and is always kept — ten hours logged by hand stay
ten hours, and a 3h event on top of them is trimmed, not the hours. The top-up and the cap are gated
differently on purpose. The top-up waits for the task trigger or a manual "worked day" and stands
down when a non-calendar task carries hand-logged time; the cap waits for neither (`shouldCapDay` in
`calculateDayRateTimeLogAdjustment`). Both are one mechanism: a **pinned** day (`shouldPinDay`) ends
at its ceiling through the same statistics repair delta, and the generated "Time log for day rate"
task is the anchor — it holds the top-up as its estimation (0 on a capped day) and the trimmed
minutes as `genericData.cappedMinutes`. That field is what makes the cap reversible: when a day later
drops under its ceiling without qualifying for a top-up, the reconcile gives exactly those minutes
back so the statistics return to the task total. It is derived from the excess, not from the repair
delta, so re-reconciling an already-capped day (delta 0) does not forget them.
`reconcileExistingDayRateTimeLog`, the path every ordinary task change takes, used to do nothing for
a day with no anchor; it now creates one when the day is over its ceiling, because a calendar sync
or an estimation change is precisely how a day goes over. Pinned by the `day cap` block in
`utils/DayRateTimeLogHelper.test.js`.

### Happiness ratings — what a rating popup knows before you rate

Both rating surfaces (the "new day" popup and Settings → Happiness → "Rate happiness") render
`ProjectHappinessRatingList` on `useProjectHappinessEditor`, and three things in that pair are easy
to get backwards. **`ratings` is not "already rated"**: it holds the value on screen, which a tap
sets immediately, so it cannot tell a stored rating from one made a second ago; the editor's
`storedEntries` (written ONLY by the per-day watcher: an entry object, `null` once the watcher has
answered "nothing", absent until it answered at all) is what the "Rated / Not rated yet" badge, the
"N of M projects rated on this day" line and the tests read. **"Tasks done" for a day comes from
`statistics/{projectId}/{userId}/{DDMMYYYY}`** — `useProjectDayStatistics` reads it exactly as the
new-day popup does (`getUserStatistics`), and an unanswered read is `undefined`, rendered as a dash
by the shared `ProjectDayActivity` row, never as `0`. **The date picker's dots** come from
`useHappinessRatedDays`, one range watcher per project over the VISIBLE month, attached only while
the picker is open (and keyed `settings_happiness_rated_days_*`, distinct from the editor's per-day
watchers); under `markingType="custom"` a plain `{ marked: true, dotColor }` renders the dot and the
selected day layers its `customStyles` on top. The Settings header stacks on `smallScreenNavigation`
and lets the two controls wrap (`rowGap`), because title + primary button + "Filtered by" never fit
one 72px line on a phone. Pinned by `__tests__/ProjectHappiness/*` and
`__tests__/SettingsView/UserHappiness.test.js`.

### Client feed cleanup: concurrent trims race, and a lost race reads as permission-denied

**Interacting with an object acknowledges its existing activity-feed unread entries (AT-2536).**
`queueObjectActivityFeedUnreadClear` removes that object's nested counter from both
`feedsCount/{projectId}/{userId}/followed` and `/all`, in the same batch as the interaction. It
never touches `chatNotifications`, which is independent comment/chat unread state. The central
`increaseFeedCount` path applies this only when the new feed's `creatorId` is the signed-in user;
assistant/system-authored feeds therefore leave the user's unread entries intact. `storeComment`
also applies it for a newly created user comment, but not when `editingCommentId` identifies an
edit. Root-task Done/Open feeds are server-owned and appear only after the task write, so the three
`moveTasksFrom*` transition paths queue the same clear in the authoritative task batch; the later
server feed excludes its actor and cannot make the task unread again. The decision and writes are
pinned by `utils/backends/Feeds/activityFeedReadState.test.js` and
`__tests__/Feeds/activityFeedReadCallSites.test.js`.

Every write batch trims `feedsStore/{project}/all` and the user's `followed` store to the newest
200 readable entries (`deleteOldVisibleFeeds`, called from the `feedsCleaned` block of each
`*Updates.js`). In steady state that is 1-2 overflow documents per run, and a burst of edits used to
start one cleanup **per batch**: all of them read the same overflow and raced to delete it, and every
loser logged `[feeds cleanup] Could not trim legacy client feed data … permission-denied`. The
denial is real but not about authorization: the delete rule evaluates
`canReadObject(projectId, resource.data)`, and on a document the winner already removed that
dereferences a missing `resource.data` - a rules evaluation ERROR, which the client receives as
PERMISSION_DENIED (it shows up as `ERROR DELETE` bursts in the `rules/evaluation_count` metric, never
as DENY). Replaying the queries in the emulator with the real project document allows everything;
deleting the same document twice reproduces the error. `utils/backends/Feeds/feedCleanup.js` now
coalesces concurrent runs per collection and treats `permission-denied` / `not-found` on a delete of
a document the query just returned as "already gone"; any other delete failure still rejects and is
still reported. The other project member's browser races the shared `all` store the same way, so the
tolerance matters even with the coalescing. Pinned by `utils/backends/Feeds/feedCleanup.test.js`.

### A privacy change reaches the stored activity in two halves, and a browser owns only one

Every activity entry of an object — `feedsStore/{projectId}/all`, each member's
`feedsStore/{projectId}/{userId}/feeds/followed` store and the object's `projectsInnerFeeds`
history — carries its own `isPublicFor`, and the access projection derives each entry's
`readerIds` from THAT field. So making an object private (or public again) has to rewrite the
entries that already exist, and the pre-rollout client did all of it: rewrote every store and
deleted the entries out of the followed stores of the members that lost access. After the
`readerIds` rollout that code failed on every privacy change **and on the creation of every
private task** (an invoice task is one) with two uncaught `Missing or insufficient permissions`
rejections, for two different reasons: a feed query with only `objectId ==` cannot prove
`canReadObject` and is refused as a whole, and another member's followed store is gated on
`request.auth.uid == userId`, so no query shape reaches it. Because the rejection came before the
batch commit, the change wrote **nothing** — the unread counters, the shared store, all of it.

The split is now explicit. `utils/backends/Feeds/feedPrivacy.js` is the **browser half**: every
query carries `objectId ==` plus `readerIds array-contains <me>` (array-contains merges with
equality filters on its own, no composite index), it touches only the signed-in user's own
followed store, and a writer whose own access the change removes only deletes from that store —
the update rule evaluates `canWriteObject` on the document as written, so an entry rewritten to a
privacy that no longer names the writer would be refused. `functions/Feeds/objectFeedPrivacy.js`
is the **server half**, run from the tasks/notes/goals/contacts/skills `onUpdate*` triggers next to
`synchronizeAccessProjection` whenever the update moved `isPublicFor`: it deletes the entries and
unread counters of every member outside the new list and rewrites everybody else's, with the Admin
SDK. Both halves are idempotent merges toward the same state, so the browser's immediate pass, the
trigger, a retried trigger and the assistant's own server-side chain
(`globalFeedsHelper.addPrivacyForFeedObject`, which now delegates to the same module) can overlap
freely. Neither half may reject into a caller: the client wraps its commit and warns, the trigger
catches and logs, because the object update itself has already happened. Pinned by
`utils/backends/Feeds/feedPrivacy.test.js`, `functions/Feeds/objectFeedPrivacy.test.js` and the
`re-privatise only the activity it can see` case in `__tests__/Firestore/firestoreRules.emulator.test.js`.

### An object's last feed state is as private as the object (2026-11-09)

`feedsObjectsLastStates/{projectId}/{objectType}/{objectId}` caches the last feed object of every
object with activity, title included, and every member could read it, so the title of a private
task, note, goal, contact, skill or artifact was readable by members who cannot see the object.
`firestore.rules` now decide a read from the object's own document while it exists
(`canAccessObjectWhileProjectionIsPending` on it, so a stale stored value never matters), from the
last state's stored `isPublicFor` once the object is deleted (the deletion feed wrote it from the
object), and keep users, projects, assistants and the wiki member-wide. A last state without
`isPublicFor` (written before the field existed) stays member-readable. A missing last state still
answers a member (`canProbeMissingObject`), because every feed helper reads it before writing and
rebuilds a missing one. Writes stay open to members and read no other document, since they ride in
the batch of the object change and a batch may make at most 20 document lookups; the one write
refused is widening the stored `isPublicFor` of a last state the writer could not read, which is
what would expose a deleted object. A reader of the live object may still correct a stale value
(that branch alone reads the object). The privacy reconciler (`objectFeedPrivacy.js`) moves the
stored `isPublicFor` with the object. Never list this collection: the rule needs the object id, so
a collection query is refused (the unused `getFeedObjectsLastStateList` was removed). Artifacts no
longer skip their last state (the `skipObjectLastState` flag of AT-3002 is gone). Pinned by the
`feed object last states are as private as their object` block of the rules emulator suite (11 of
its cases fail against the old member-wide rule) and `functions/Feeds/objectFeedPrivacy.test.js`.

### Gold Transactions

- Every gold change (earn, spend, refund, adjustment) must go through `applyGoldChange` / `deductGold` / `refundGold` / `adjustGold` in `functions/Gold/goldHelper.js` so it lands in the user's `goldTransactions` subcollection. Never mutate `users/{uid}.gold` directly — the log is how users see what happened in the Gold history modal.
- When adding a new gold spend or refund, always pass a descriptive `source` (a new machine key, e.g. `meeting_transcription`, `gmail_labeling`) plus as much linking context as you have: `projectId`, `goalId`, `objectId`, `objectType`, `channel`, and an optional human `note`. The sanitized fields are defined in `functions/Gold/goldTransactions.js` — add new fields there if you need more link context.
- Add a human label for every new `source` in `components/SettingsView/Profile/Properties/GoldTransactionsModal.js` (`getTransactionLabel`) and a matching translation key in `i18n/translations/en.json`, `de.json`, and `es.json`. The modal falls back to `Gold transaction` if the source is unknown.
- Prefer storing enough context that the transaction can deep-link back to its source (chat/topic, goal, contact, Gmail message, etc.). The modal's `getTransactionLink` builds the URL from `projectId` + `objectId` + `objectType` / `channel`; extend it when adding a new source type that has a natural destination.

#### Nothing a client sends can create Gold

Until October 2026 any signed-in account could mint Gold three ways: write `users/{uid}.gold` itself (the users update rule only protected membership fields), call `refundGoldSecondGen` with any amount (it credited whatever it was sent), or call `deductGoldSecondGen` with a negative amount (the ledger only checked "finite and not zero"). Three rules now hold, and a new gold path must keep them:

- **`gold`, `dailyGold`, `premium` and `stripeCustomerId` on `users/{uid}` are server-owned** (`ownerUpdateKeepsServerFields` in `firestore.rules`; a new account may only start with `getNewDefaultUser`'s defaults). So are the `goldTransactions`, `goldRewardClaims` and `goldChangeClaims` subcollections (owner-readable, never client-writable), because a forged spend could be refunded and a deleted claim re-earned. Never write any of them from the client; a client-triggered grant is a callable that decides the amount itself (the premium signup bonus is `grantPremiumSignupGold`, once per account via an idempotency key, only on the signup check of an account less than a day old).
- **A ledger direction carries its sign** (`deltaMatchesDirection` in `goldTransactions.js`): `spend` negative, `earn` and `refund` positive, only `adjustment` either way.
- **A client refund gives back one of the caller's own charges** (`refundClientSpend`): the refund source must be paired with a spend source in `REFUNDABLE_CLIENT_SPENDS` (`iframe_refund` ↔ `iframe_deduction`, `goal_unlock` ↔ `goal_unlock`), it is matched to the newest spend of that source in the last 24h (and the same `objectId` when given), and the spend's `refundedAmount` caps the total. A new client flow that needs to refund adds its pair there. Server code refunding its own charges keeps using `refundGold`.

**Rewards are granted by the server, never on a request from the browser** (AT-2978,
`functions/Gold/serverGoldRewards.js`). `onUpdateTaskSecondGen` pays when a top-level task moves
forward (open → workflow step → … → done): leaving the open step pays the task's owner, leaving a
workflow step pays that step's reviewer, both only as project members. `onCreateObjectCommentSecondGen`
pays a member's comment in a guide (`parentTemplateId`) on an object the whole project can see, under
the source `guide_comment`. The idempotency key names the step a task LEFT and the person paid
(`task_progress:{taskId}:{stepIndex}:{uid}`), not the transition time, so reopening and completing a
task again pays nothing the second time; a comment is keyed by its id. The amount comes from that key
with the same hash the browser uses for its coin animation (`getRewardGoldAmount`, kept identical in
`utils/backends/firestore.js` and pinned by `serverGoldRewards.test.js`), so the coins shown are the
coins paid; the browser only plays the animation (`showGoldRewardAnimation`). The day the reward lands
on in `statistics/` is the recipient's own local day (`calendarUserDay.js`). `dailyGold` still caps
the total. `earnGoldSecondGen` is kept as a no-op for open tabs of older app versions and pays nothing.

`deductGoldSecondGen` accepts only the spends the app starts itself (`CLIENT_SPEND_SOURCES`), today
only `iframe_deduction` as a whole amount up to 10,000. Any other source is refused, so a client cannot
write ledger entries under server sources and skew `goldStats`. A new client spend adds its source
there. **A guide goal is unlocked by `unlockGuideGoalSecondGen`** (AT-2978,
`functions/Guides/unlockGuideGoal.js`), which charges the 80 Gold (must equal `UNLOCK_GOAL_COST`) and
stores the lock key in one transaction, reading the key and the goal's owner from the stored goal; the
guide creator (administrator or `realTemplateProjectIds`) unlocks for the goal's owner. `firestore.rules`
make `unlockedKeysByGuides` server-owned for owner updates, let a project membership mutation only drop
keys (`unlockedKeysNotAdded`), and let a new account start only without keys. The goal content stays
readable for members in Firestore: the decision was that paying cannot be skipped, not that the content
is hidden. An idempotency claim settles a change only if the ledger wrote it (matching `idempotencyKey`
and `direction`); an empty claim at a predictable key used to count as paid.

**Usage that already happened is charged in full, even below 0** (`settleUsageGold` in
`goldHelper.js`, AT-2978). An assistant answer (`reduceGoldWhenChatWithAI` → `spentGold`) and a
dictation (`processRamble`) are charged after the model and Deepgram have run. `deductGold` is
all-or-nothing, so a cost above the balance used to charge nothing, then the interim fix took only
what was left. Now the full cost is always booked (`allowNegativeBalance` in
`applyGoldChangeInTransaction`, which only that settlement passes), a negative result is logged at
`console.warn` (`[gold] Usage settled into a negative balance`), and every paid entry point refuses to
start while the balance is 0 or less, so a debt blocks the next run until the user tops up (monthly
Gold or a purchase pays it off first). A run is never cut off half-way. Every other spend still needs
the balance to cover it. Client gates must test `gold > 0`, never `gold === 0`, or a negative balance
passes them.

Pinned by `functions/Gold/goldIntegrity.test.js`, `functions/Gold/clientGoldRequests.test.js`, `functions/Gold/serverGoldRewards.test.js`, `functions/Guides/unlockGuideGoal.test.js`, `functions/Assistant/assistantGoldSettlement.test.js`, `functions/Premium/premiumSignupGold.test.js`, `functions/Premium/stripeLinkCode.test.js` and the `server-owned` and `goal lock keys` blocks of `__tests__/Firestore/firestoreRules.emulator.test.js`.

#### Gold analytics & rollups (tracking earn/spend over time)

- **GA4 events (consent-gated)**: `goldHelper.js` calls `logGoldAnalytics` → `GAnalytics.logEvent` for every change. `normalizeServerEvent` in `functions/GAnalytics/GAnalytics.js` maps each ledger direction to its **own** GA4 event so they don't pollute each other: `earn_gold`→`earn_virtual_currency`, `spend_gold`→`spend_virtual_currency`, `refund_gold`→`refund_virtual_currency`, `adjust_gold`→`adjust_virtual_currency` (all with `virtual_currency_name: 'gold'`, `value`, `source`). `adjustGold` passes the **signed** delta so admin deductions report a negative `value`. These only fire for users with `analytics.consent === 'granted'`, so GA **undercounts** — use it for trends, not exact totals.
- **Firestore rollups (consent-independent, exact)**: the `aggregateGoldTransactionStats` trigger (`functions/Gold/goldStatsAggregator.js`, registered on `users/{userId}/goldTransactions/{transactionId}` in `index.js`) increments `goldStats/daily/days/{YYYY-MM-DD}` and `goldStats/monthly/months/{YYYY-MM}` (UTC buckets). Each doc holds gross `earn`/`spend`/`refund` + signed `adjust`, per-direction counts, a signed `net`, and `spendBySource`/`earnBySource`/`refundBySource` maps (spend-by-source = feature usage). Idempotent via an `aggregatedAt` stamp on the source ledger doc (guards against at-least-once duplicate trigger delivery; an `update` doesn't re-fire `onDocumentCreated`). `goldStats` is admin-read / server-write only (`firestore.rules`).
- **Deploy steps**: deploy the function + `firebase deploy --only firestore:rules`, then backfill existing history with `node migration/backfillGoldStats.js --firebase-project-id=<project>` (dry run; add `--execute` to apply, `--user-id=<uid>` to scope). The backfill reuses the same per-transaction idempotent path, so it is safe to run with the trigger already live. No Cloud Tasks / IAM grants are needed.
- **A spend total is not interpretable without its billing dimensions (AT-2487).** `spendBySource` says which feature spent Gold; it cannot say why the number moved, because the Gold charged for one unit of the same feature depends on how the run was billed. The VM is the case that forced this: a run on the user's own Claude/Codex subscription or their own API key pays the 20-Gold base reserve and 10 Gold per sandbox minute but **zero** Gold for model tokens (`tokenBillingExempt`), so `vm_execution` — **63%** of August 2026's entire spend, 309,864 of 490,806 Gold — falls both when usage drops and when a user connects a subscription, and the two are indistinguishable. Worse, the ledger carried **nothing joinable to `vmJobs`**, so answering it by hand meant matching on `projectId` + `objectId` + timestamp, which is ambiguous the moment a thread has run more than once. Each source-tracked direction therefore also carries `spendByBilling` / `spendByModel` (and the `refund*` equivalents), keyed `<source>__<value>` — `vm_execution__exempt`, `assistant_usage__gpt-5-2`. `functions/Gold/goldDimensions.js` is the single authority for that key format.

    Four things are load-bearing. **`billingExempt` is a tristate** — `true` (the user's own provider paid for the tokens), `false` (Alldone Gold paid), and **absent** (the question does not apply: a Gmail classification has no exempt variant). Coercing absent to `false` would add a constant to every rollup doc and imply a comparison that does not exist, which is why `sanitizeContext` persists it only for a real boolean and `computeStatsDimensions` emits nothing otherwise. **Keys are source-scoped**, because a bare `opus` bucket would merge VM spend with any future consumer of the same model and could not be reconciled against `spendBySource[source]`. **Model keys are slugged** to `[a-z0-9_-]` (`gpt-5.6-sol` → `gpt-5-6-sol`, `openrouter:deepseek/deepseek-v4-flash-0731` → `openrouter-deepseek-deepseek-v4-flash-0731`): a raw id carries dots, colons and solidi that need backtick-quoted field paths everywhere they are read. The raw value is kept verbatim on the ledger entry, so nothing is lost. And **the model recorded is the one the price was frozen from** (`agentModel`, the requested family/alias), never the concrete `resolvedAgentModel` the CLI reports mid-run — the base reserve is charged before a sandbox exists, so using the resolved id where available would split one run between an `opus` bucket and a `claude-opus-4-5` bucket.

    **Every token-priced charge site declares its model**, not just the VM: `assistant_usage` (via `spentGold`, which also covers pre-configured task topics), Gmail labeling and its follow-up prompt, the email draft-reply and create-task flows, all three routing classifiers, the rambler, and the realtime voice calls (`phone_call` / `whatsapp_call`, plus legacy `browser_call` sessions — token-priced at 100 tokens/Gold, so its `realtimeModel` is now frozen onto the call session at creation rather than read from env config at charge time, which would re-attribute Gold already spent). Flat- and duration-priced sources declare nothing and must keep doing so: `mcp_tool_call`, `iframe_deduction`, `linkedin_enrichment`, `meeting_transcription` and `whatsapp_voice` have no model in their price at all.

    A VM run charges Gold from **five** places (`vmJob.startVmJob`'s base reserve, `vmJobRunner`'s per-minute monitor and settlement top-up, `vmLlmProxy`'s incremental token charges, and the refund paths in `vmJob`/`vmJobRunner`/`vmInteraction`/`vmJobReconciliation`). All of them must stamp the **same** dimensions or one run splits across buckets and stops reconciling, so they read them through the single `buildVmGoldBillingDimensions` in `functions/Assistant/vmGoldDimensions.js` rather than hand-writing a context literal each. Refunds carry them too, so a source's NET Gold cost stays decomposable. `correlationId` is now minted **before** the base reserve is charged so the very first ledger entry of a run is already joinable.

    **Historical data is not backfilled, and cannot be honestly.** Entries written before this shipped carry no `model`/`billingExempt`/`correlationId` at all, and the only way to reconstruct them would be an approximate `vmJobs` match on projectId + objectId + a time window — several runs share a thread, so it would write silent misattribution into buckets that currently just do not exist. Every pre-existing number is therefore **unchanged and still correct**: `spend`, `count` and `spendBySource` are untouched, and a transaction declaring no dimensions writes no dimension fields, so `migration/backfillGoldStats.js` keeps working as-is. Read a dimension map as covering only the period since deploy, and cross-check its per-source total against `spendBySource[source]` for the same window to see how much of it is attributed.

### The growth scoreboard is the growth loop's reward signal, and only code defines it

`growthScoreboardSecondGen` (daily 03:30 UTC, `functions/Growth/`) writes yesterday's funnel to
`growthMetrics/daily/days/{YYYY-MM-DD}`: the Growth project's contacts per status (outreach), GA4
traffic, signups by source, three activation candidates, paying users (started/stopped), revenue
from actual payments, Gold spent with an ESTIMATED upstream cost, and on Mondays the margin per
paying user over 90 days. In production it then rewrites a private artifact "Growth Scoreboard" in
the Alldone Growth project as a new version, so the artifact's history is the scoreboard's history.
`growthMetrics` and `revenueEvents` have no client rule (catch-all deny): no browser and no agent can
read or change the numbers, and an edit to the artifact is replaced by the next run. Every
assumption lives in `growthConfig.js`; the artifact lists them under "What is estimated".

Four things are load-bearing. **Revenue is what was paid, not a price list**: Stripe balance
transactions (real fees, settlement currency; VAT is an estimated share until invoice tax is read)
and the RevenueCat webhook, which now records every priced event in `revenueEvents` because Apple
money never reaches Stripe; Apple subscription revenue therefore only counts from that deploy. A
subscription payment is spread over the month or year it pays for, or a yearly customer would look
unprofitable for nine months. **Signup origin is written once by the browser**:
`utils/growth/signupAttribution.js` keeps the first page load's campaign labels in sessionStorage
(nothing for a visit without a signal; never a click id, a full referrer or a query string) and
writes `users/{uid}/private/signupAttribution` right after the signup batch, outside it so it can
never block provisioning. The owner can write that document, so the server re-sanitises it before it
becomes a map key. **No person leaves the run**: the day document holds counts, sums and
percentiles only; the premium user ids the next run needs to count who started and stopped live in
the server-only `growthMetrics/state`. The administrator and `EXCLUDED_USER_IDS` are left out of
margins. **GA4 needs no configuration in code**: the run lists the properties its own service
account (the Firebase Admin SDK account) may read, so granting that account Viewer on a property is
the setup; until then the section says what is missing. GA only sees consenting visitors, so the
run compares the `sign_up` events GA saw with the real signups from Firebase Auth (`visibleShare`).

**Paying users come from Stripe, not from `users/{uid}.premium`.** That flag is only refreshed when
the premium checker runs for a user (login, checkout) and is stale for most subscribers: the first
production run (2026-11-08) counted 2 flagged users against about 26 active subscriptions. The run
lists Stripe's `active` subscriptions (and counts `trialing`/`past_due`), matches each customer to an
account by `stripeCustomerId` or, failing that, by its VERIFIED email (`findUserIdByVerifiedEmail`),
and reads Apple subscribers from the premium status RevenueCat sets (`premium.source == 'apple_iap'`).
"Logged in" counts `lastLogin`, which moves only on a real login, so it understates daily use.

**Never hand a `google-auth-library` client to a `googleapis` module in Functions.** `googleapis`
bundles google-auth-library 10 while `functions/` uses 9; googleapis-common then reads the v9
client's headers in the v10 shape and sends the request with NO credentials, which Google answers
with "Login Required" — it looks like a permission problem and is not one. `growthTraffic.js` calls
the GA REST endpoints with a token from our own `GoogleAuth` instead.

Costs are bounded: Firebase Auth's user list (API pages, no Firestore reads), three days of
signups, count() queries, one goldStats rollup, the day's Stripe transactions; only the Monday
margin reads every paying user's Gold ledger. `run` on each document reports what was read. Pinned
by `functions/Growth/growthModels.test.js`, `growthScoreboard.test.js` and
`utils/growth/signupAttribution.test.js`.

### Contact "Enrich profile" is an assistant run, not a scraper (replaces Apify)

**LinkedIn profile pages cannot be read without a login, and that is the whole reason the Apify
actor existed.** It sold proxies and logged-in sessions; from a Cloud Functions IP a profile URL
answers with a login redirect or a 999, and scraping it breaks LinkedIn's terms. Every field the
contact card actually stores (name, company, role, description, a photo) is also in search-engine
snippets, company team pages, personal sites, GitHub and Gravatar — free and legitimate to read — so
`functions/Apify/` and its two callables are gone, and the button on
`ContactProperties` now calls `enrichContactProfileSecondGen`
(`functions/Contacts/contactProfileEnrichment.js`). That callable hosts an ordinary assistant prompt
run **inside the contact's own chat** (`objectType: 'contacts'`), so it carries the prompt-run
timeout and the per-request run lock like every other host — it is in `ASSISTANT_RUN_HOSTS` and
`RUN_LOCK_HOSTS`, and the client-generated `requestId` doubles as the id of the request comment so a
replayed POST lands on the same comment and the same lock.

Three things are load-bearing. **The run's tools are passed twice, and both halves are needed.**
`aiSettings.allowedTools` (`CONTACT_ENRICHMENT_TOOLS`: `web_search`, `fetch_url`,
`find_profile_photo`, `update_contact`, `get_contacts`) only decides which SCHEMAS the model sees;
the execution gate in `storeChunks` authorises each call against the **assistant document's**
persisted `allowedTools`, which predates the two new tools. The first production run therefore
researched for twenty seconds and died on `Tool not permitted: fetch_url`. A server-authored run
passes the same list as `options.serverGrantedTools`, which `generatePreConfigTaskResult` copies
onto the runtime context and `runToolGrants.resolveRunAllowedTools` unions into the gate — only
Functions code builds that context, so a client cannot grant itself tools this way. An existing
assistant still needs the tools enabled in Tools Access for ordinary chats.

**`update_contact` used to work only on a warm instance.** `updateContactFields` calls the feed and
follower helpers, which read `admin`/`feedCreator`/`project` from the per-instance global state
(`GlobalState/globalState.js`) that every other caller loads first via `loadFeedsGlobalState` —
TaskService, NoteService, the cloud triggers. It never did, so on a cold instance `tryAddFollower`
threw `Cannot read properties of undefined (reading 'firestore')` after the model had done all its
research, and the batch was never committed. `loadFeedsStateForContactWrite` now loads it from the
project document before the write. If a feed helper ever throws that error, look for the missing
`loadFeedsGlobalState` call before suspecting the SDK. **The contact is switched to `isAssistantEnabled: true`**
before the run, because "ask the user which of these two people it is" only works if the user's reply
in the contact chat reaches the assistant, and `createObjectMessage` calls it only when the parent
object says so. And **`fetch_url` refuses LinkedIn and private/link-local addresses up front**
(`webPageFetcher.isFetchableUrl`): the first because a login redirect teaches the model to work
around a page it will never read (the prompt sends it to the search snippet instead — a LinkedIn
result title is literally `Name - Role - Company | LinkedIn`), the second because a model-authored
URL must not be able to point a fetch from inside the Functions network at the metadata server. A
plain fetch that is blocked or returns a JavaScript-only shell falls back to Tavily `extract` when
the key is configured.

`update_contact` widened from "email only" to name, company, role, phone, LinkedIn URL, description
and `photoUrl`; `required` is now `[]` and the executor rejects a call that changes nothing.
The field mapping is the pure `shared/contactEnrichmentFields.js` (description writes both
`description` and `extendedDescription`, as the app's own edit does; a LinkedIn URL must be an
`/in/` profile and is stripped of tracking parameters), and a photo is **copied into our storage**
(`shared/contactPhotoUpload.js`, the same `projectsContacts/…` path the app uses) rather than
hot-linked, since a Gravatar or GitHub avatar changes under the contact. `find_profile_photo` checks
Gravatar (SHA-256 of the lower-cased address, `d=404`), the GitHub API with the `.png` redirect as
a rate-limit fallback, and the `og:image` of pages the assistant already trusts; every miss is
reported in `checked`, never thrown.

Billing is the ordinary metered `assistant_usage` of the run and nothing else (a flat
`contact_enrichment` fee shipped for one afternoon and was removed; the Gold-history label stays for
the entries it wrote). The callable refuses a user with no Gold before touching the thread, matching
the run's own `userGold > 0` gate. The button lives beside the profile edit button at the top of the
card, not on the LinkedIn line. Pinned by
`functions/Contacts/contactProfileEnrichment.test.js`, `functions/Assistant/webPageFetcher.test.js`,
`functions/Assistant/profilePhotoFinder.test.js`, `functions/shared/contactEnrichmentFields.test.js`
and the contact-research block in `toolSchemas.test.js`. Known limits: LinkedIn's own picture and
the structured work history are not recoverable this way, and the follow-up in the chat runs with the
assistant's persisted tools, so an assistant without `fetch_url` enabled can confirm and update but
not read further pages.

### Gmail Follow-Up Tasks

- Gmail follow-up tasks created from labeling prompts use `task.gmailData.origin === 'gmail_label_follow_up'`.
- These tasks must stay in the normal task list, not the dedicated Gmail/email task bucket. Only inbox-summary Gmail tasks should be treated as email tasks.
- Do not rewrite or sanitize the task title text for Gmail follow-up tasks. If the assistant-created title contains a Gmail link, leave it as-is.
- In the task list row, the Gmail affordance should be rendered as an inline left tag/chip using `SocialText`'s `leftCustomElement`, not as an absolutely-positioned icon. This keeps wrapping correct so continuation lines align under the chip instead of under the first text token after it.
- Opening a Gmail follow-up task from the chip should target the specific Gmail message and should prefer an account-aware URL flow. Current helpers live in `utils/Gmail/gmailTaskUtils.js` and `functions/Gmail/serverSideGmailLabelingSync.js`.

### The email line summary is reused while the mailbox is unchanged (AT-2913)

`getEmailLineSummarySecondGen` runs on every app load, and the app asks for the same mailbox twice:
once under a project key (My Day, the task board) and once under a connection key (the email line),
and the client's 60-second cooldown is per key. Each request rebuilt the Gmail label summary: a thread
list and an unread count for up to 60 labels plus the `has:userlabels` scan, about 125 Gmail calls and
1,300 quota units against a per-user limit of 250 per second. Measured on 2026-10-29: p50 7.5s, p90
10.8s, and half of all calls came within 5 seconds of the previous one from the same device.
`gmailLabelSummaryCache.js` keeps the summary per user and mailbox address, tagged with the mailbox
`historyId` (`users.getProfile`, 1 quota unit), and `getGmailLabelSummary` reuses it while that id is
unchanged. Every mailbox change (new mail, read state, labels, archiving) moves the id, so a hit is exact;
`SUMMARY_MAX_AGE_MS` (10 min) only bounds a label renamed or created without one. Concurrent requests at
the same id share one computation, and a `getProfile` that fails for any reason but a rejected token
computes the summary uncached rather than failing it. `getEmailLineSummary` now also loads the label
configuration and the needs-reply state in parallel with the provider summary. Each summary logs
`[emailLine] label summary` with `cache` (`hit`, `miss`, `joined`, `uncached`) and `durationMs`.
Microsoft is unchanged. Pinned by `gmailLabelSummaryCache.test.js`, the reuse block of
`gmailEmailLine.test.js` and the mailbox-key case in `emailLineService.test.js`.

### An email handled in Gmail marks its Alldone email comment as read (AT-2376)

The unread state of a chat comment is not a field — it is the existence of
`chatNotifications/{projectId}/{userId}/{commentId}`, and clearing it is deleting that doc. Every
path that did so was an action taken **inside Alldone** (opening the topic, "Mark as read", or the
chat/email-line archive, which deliberately clears the comment while leaving the mailbox read state
alone — AT-2298). Nothing ever looked the other way, so an email the user read or archived **in
Gmail** kept its "Daily emails …" comment unread forever and had to be triaged twice.

`utils/backends/EmailLine/emailCommentReadSync.js` closes that loop by **asking the mailbox**.
There is no push channel for this: Gmail's `users.history.list` reports label changes against one
mailbox-wide cursor already owned by the labeling sync, while the messages behind unread email
comments are a small, exactly-known set — so the read-only `getMessageStates` action
(`emailLineService` → `gmailEmailLine`/`microsoftEmailLine`, `format: 'minimal'`, 200 ids max,
20 concurrent) reports `exists`/`unread`/`inInbox` per message and the client deletes the
notification docs of the ones already handled. **Archived counts as read even when Gmail still
flags the message UNREAD** — leaving the inbox is the user saying they are done — which is the
whole reason the lookup returns both flags instead of a single boolean.

Three rules keep it from clearing something the user has not seen. A state that could not be read
is **omitted** by the server rather than defaulted (`isEmailHandledInMailbox` only ever answers true
on positive evidence), every failure path — offline, `EMAIL_AUTH_EXPIRED`, a failed notification
write — leaves the unread state untouched and never alerts, and a failed lookup is not remembered,
so a reconnect takes effect immediately instead of waiting out the per-message cooldown
(`EMAIL_COMMENT_READ_SYNC_COOLDOWN_MS`, 60s).

It runs from `UnreadEmailArchiveProvider` (the chat list), which already holds the deduplicated set
of emails behind the unread previews — no new data model, no index, no extra Firestore reads — plus
a `visibilitychange` re-check, because "I archived it in Gmail and came back" changes nothing inside
the app that could trigger an effect. Note the rows publish **two** sets: `linkedEmails` is what
they preview and what the bulk archive buttons act on, `unreadLinkedEmails` is every unread email of
the row. The sync uses the second on purpose — a "Daily emails" topic holds a whole day in one row,
and reconciling only the previewed five would leave the older ones unread for good.

Everything here is `require`d lazily (the `linkedEmailActions` pattern): the module is reached from
a chat-list row, and a static import of `emailLineBackend` / `markChatCommentsAsRead` /
`connectionState` pulls the redux store and the Firebase client into every test that renders a row.
That is also why there is no `isBrowserOffline()` pre-check — the callable funnel already fails fast
offline, which is the same "could not ask" path as any other failure.

**The same reconciliation also runs server-side, inside the scheduled labeling sync**
(`functions/Gmail/emailCommentReadSync.js`, called from `syncGmailLabeling`), so it no longer
depends on anyone opening the chat list. It is a step of the existing 5-minute
`pollGmailLabelingSecondGen` tick rather than a new schedule, because that sync already holds an
authorized Gmail client for exactly the account whose comments it is reconciling — no second auth
path, no second client. It runs on every tick, including ticks with no new mail to label: it is
answering a question about OLD messages. It is wrapped in try/catch — labeling is that function's
job, and failing to reconcile read state must never fail a run that labeled mail correctly.

**Reconciling read state is not gated on `syncIntervalMinutes`, and must not be.** That interval
(minimum and default **30**) exists to bound how often the **classifier** runs, because
classification spends Gold per message; reconciliation spends none — one indexed Firestore query
plus at most a handful of `messages.get` at `format: 'minimal'` (1 quota unit each, capped at 50 per
run). Riding on the labeling interval therefore made a free, read-only operation wait up to half an
hour, which is indistinguishable from the feature being broken: production logs for the reporting
account show the reconciler firing correctly (`markedRead: 6`) **four minutes after** the user
reported that Gmail-read mail was still unread in Alldone. `processEnabledGmailLabelingConfigs`
therefore calls `reconcileEmailCommentReadStateOnPollTick` on the `interval_not_due` branch too, so
the worst case is the poller's own 5 minutes instead of the connection's 30. Three properties make
that affordable and safe, and all three are load-bearing: the Gmail client is passed as a **lazy
`getGmail` factory** rather than a client (an idle tick — which is the overwhelming majority — costs
one query and builds **no** authorized client, so no OAuth read/refresh per connection per tick);
the pass **never writes `lastSyncAt`**, or it would starve the labeling sync it is standing in for;
and it **stands down while the labeling lock is held** (respecting `GMAIL_LABELING_LOCK_TIMEOUT_MS`,
so a dead run cannot block it forever) so the two never reconcile the same candidates concurrently.

The mapping it needs (Gmail messageId → chat comment) is written by the sync itself: the post-label
prompt's `add_chat_comment` result is collected in `collectAssistantTextWithToolCalls` as
`createdChatCommentResults` and lands on the message's **audit record** as `emailComments` +
`emailCommentReadPending`, inside the audit write that already happens. That is what keeps this a
plain `where('emailCommentReadPending','==',true)` query on an existing per-user subcollection —
**no collection-group index, no new collection, no migration** (a collection-group query over
`chatComments` by `gmailData.messageId` would have needed an index deploy, which this repo does not
do from CI). Comments created before this shipped carry no stamp and stay with the client fallback.

Cost discipline, in order: one indexed query per run (capped at 50 candidates); then the
**notification docs are read first**, so a comment the user already read costs ZERO Gmail calls and
is retired on the spot; only what is still unread is looked up in Gmail (`format: 'minimal'`,
concurrency 10, capped per run). Every candidate is retired by a terminal
`emailCommentReadResolution` (`mailbox_handled` / `already_read` / `no_comment` / `expired`) so the
pending pool drains and nothing is re-checked forever; an unknown state keeps the flag and is
retried next tick. `expired` (30 days) stops the checking and **never** marks the comment read.

**"Not in the inbox" is not always the user's doing.** Two cases where it says nothing, and where
the server rule is stricter than the naive one: the labeling sync **auto-archived the mail itself**
(`autoArchive`, the starter Newsletter label ships with it on), so the mail was already out of the
inbox when the comment appeared; and an **outgoing (SENT)** message, which is never in the inbox at
all. For both, only "read" or "deleted" counts — otherwise every auto-archived comment would be
marked read the moment it appeared. The client half learns the same two facts from the comment's own
`gmailData` (`archivedByLabeling`, stamped by `buildPostLabelGmailContext`, and `direction`), so the
two rules match; `isEmailHandledInMailbox` exists once per side because Cloud Functions cannot import
app code — keep them in step.

### An email conversation gets its own private topic (decision 2026-11-09)

A first informational email nobody has answered stays one line in `Daily emails <project> <date>`.
Once a Gmail thread is a conversation, `functions/Email/emailThreadTopicStore.js` gives it a topic of
its own (`EmailThread_<key>`, `isPublicFor: [owner]`, so never a wiki source). It copies the earlier
digest lines into the topic, found through the audit records' `gmailThreadId` + `emailComments`. Later
incoming lines go there: the sync sets `gmailContext.topicChatId`/`topicProjectId`, and the
`add_chat_comment` override ignores the model's chat, title and project. The default prompt text is
unchanged on purpose, so the server copy and the client copy cannot drift.

Precedence in `executePostLabelPrompt`: a task for the thread (AT-2709 continuation), then the thread
topic, then the digest. Mail the owner sent is the owner's own silent comment in an existing topic, or
on the thread's task (`continueEmailThread({ sentByOwner })`: no summary model, no Gold, never reopens
or rewrites the task). Sent mail on its own never creates a topic or task. Replying to a digest email
does create one. The label's incoming-only prompt scope is therefore checked after continuation, not
before.

**"Conversation" is deliberately strict** (`isIncomingConversationMessage`): Gmail threads unrelated
mail by subject (order confirmations, digests), and notifications carry `In-Reply-To` (GitHub). So it
needs either an earlier outgoing message in the thread, or reply headers without `List-Unsubscribe`.

The topic is sticky to the project where the conversation started, like thread tasks. Comment ids
reuse `buildDeterministicGmailChatCommentId`'s formula, so a copy, a routed line and a sent line of
one email never duplicate. Client: `isOwnSentEmailComment` keeps sent mail out of archive, unsubscribe,
create-task and unread counts, and shows it as a "Sent email" Gmail chip. The topic header links the
whole thread (`getGmailThreadLinkData`). Pinned by `emailThreadTopicStore.test.js`, the "email
conversations get their own topic" block of `serverSideGmailLabelingSync.test.js`, the sent-mail case
in `emailThreadContinuation.test.js` and `linkedEmailActions.test.js`.

### One email address can belong to several accounts, and a connected mailbox has to prove itself (AT-2483)

**The inbound Anna email channel weighs two different kinds of ownership proof, and merging them
into one bag is what broke forwarding.** `findVerifiedUserByEmailIdentity` poured "this is the
account's Firebase-Auth-verified login email" and "this address is a mailbox the account has
OAuth-connected" into a single candidate map and then demanded `size === 1`. Both claims are
ordinary and they routinely name **different** accounts belonging to the same human — so the day a
second account was created by signing in with Google using an address another account had long had
connected, the lookup found two owners and returned `null`. The reply, _"I couldn't match this
sender to a verified Alldone account email"_, says the opposite of what happened: the address was
matched twice, not zero times. Nothing about the connection had changed, which is why it reads as a
broken integration. It also left **no trace at all** — the early return wrote no audit record and
logged nothing, so the only evidence in production was the absence of an
`annaEmailInboundAudit` document.

Evidence is now **ranked**, and only a genuine tie inside one rank is refused:
attested mailbox + verified login > Google-attested mailbox > verified login > Microsoft-attested
mailbox > unattested mailbox.
A connected mailbox outranks a login email because it is the deliberate per-address act — you
OAuth-connect a mailbox INTO the workspace whose Anna should read it, while a login email is merely
how you sign in. **A Microsoft-only attestation does not (NV-07).** It is Graph's
`mail || userPrincipalName`, and `mail` is a directory attribute an Entra tenant administrator sets.
Nothing checks that the tenant owns the address's domain, and sign-in uses the multi-tenant
`/common` authority, so an attacker's own tenant can name a victim's address. It therefore ranks
below a Firebase-verified login and above an unattested connection (`rankCandidate` in
`emailUserRouting.js`). A tenant verified-domain check (Graph `/organization` `verifiedDomains`) was
not added.

**That ordering is only safe because the connected claim is no longer forgeable.** It used to rest
on two pieces of client-writable Firestore data: the token document under the owner-writable
`users/{uid}/private/**` and the `apisConnected` / `emailConnections` entry on the user's own
document. Only Cloud Functions ever write them, but "in practice" is not a security boundary.
`emailIdentityAttestation.js` turns the claim into a proof by asking the **provider** — the only
party that can say which mailbox a refresh token actually belongs to — and recording the answer in
`verifiedEmailIdentities/{sha256(email)}/accounts/{userId}`, a collection no client can write (no
rule, default deny). It is written at OAuth connect time, where the handlers already learn the
address from Google's userinfo / Microsoft Graph, and **lazily** the first time an inbound message
needs to weigh a connection that has no attestation yet — which is what makes every pre-existing
connection work with **no migration**. Three verdicts, and the difference between the last two is
load-bearing: `verified`, `rejected` (the provider named a different address, or refused the
credentials — a fabricated token document lands here and stops counting as evidence at all), and
`unverifiable` (network, timeout, unknown shape), which keeps its pre-AT-2483 precedence so a Google
outage cannot silently revoke everybody's routing. Attestation alone is deliberately **not**
sufficient: the account must ALSO currently list the address, so disconnecting stops routing
immediately. `firestore.rules` closes the same hole at the source — `private/googleAuth_*` and
`private/microsoftAuth_*` are owner-**readable** but no longer owner-writable, while every other
private document (clockSync, gmailLabeling__, calendarProjectRouting__, taskPriorityLearning) keeps
owner read+write.

Three gaps in the same lookup went with it. The collection-group scan over `private` treated **any**
document carrying `email` + `service: 'gmail'` as a connection, so it now runs an allowlist on the
document **id** (`parseCredentialDocId`) — a hand-written `private/whatever` is not a connection
whatever it claims. Connection state was read straight off the legacy `apisConnected` map, so a
mailbox living only in the account-level `emailConnections` map was invisible and a **Microsoft/
Outlook** mailbox could never be a sender at all (`service === 'gmail'` was hard-coded); both now go
through `listEmailConnections`, unioned with the legacy map because that helper returns one shape or
the other, never both. And the scan's `limit(20)` was already at **14** for one address on the
dogfooding account — the OAuth documents of every account that ever connected it, including the
orphans left by deleted accounts — truncating silently in document-name order; the cap is raised and
reaching it is reported.

Two things worth knowing when reading this code. A `users/` document whose Firebase Auth record was
deleted is **not** an owner — `getUser` throws and the candidate is skipped, which is what the
production logs showed for one of the two duplicate accounts. And the attestation read is paid
**once per inbound message** no matter how many accounts claim the address, and not at all when
nothing claims a connected mailbox. Pinned by `functions/Email/emailIdentityAttestation.test.js`,
`functions/Email/emailUserRouting.test.js`, the AT-2483 blocks in
`functions/Email/emailIncomingHandler.test.js` and the credential-document cases in
`__tests__/Firestore/firestoreRules.emulator.test.js`.

### An OAuth connect is completed only by the browser that started it (NV-23)

The Google, Microsoft and MCP-client connect flows used to complete from `(code, state)` alone, and
the state was only a lookup key for the initiator's request. A consent URL that the initiator
forwarded to someone else therefore connected that person's mailbox (or MCP server) to the
initiator's account, with the tokens owner-readable in the initiator's user tree. Now the starting
browser (`utils/oauthBrowserBinding.js`) keeps a random nonce in a `__session` cookie scoped to the
callback path and sends only its SHA-256 (`browserNonceHash`). The initiate callables
(`googleOAuthInitiate`, `microsoftOAuthInitiate`, `beginMcpOAuth`) refuse to start without it and
store it with the state. The callback (`functions/Utils/oauthBrowserBinding.js`) exchanges the code
only for a request that carries the matching cookie, and spends the state either way. The cookie
must be named `__session`, because Firebase Hosting strips every other cookie before forwarding to a
function. The binding only works when the app runs on the callback's host (`my.alldone.app`,
`mystaging.alldone.app`; the cookie is per host). Starting a connect from `alldonestaging.web.app`
or a preview channel fails with "started in a different browser". `returnUrl` must be an Alldone
origin (the `openInBrowserTab` allowlist; localhost only in the emulator) at initiation and again
before the redirect. The callback page posts its result once per app origin instead of to `'*'`,
and the clients accept only same-origin messages. Microsoft connect was broken in production for
about 180 days because `firebase.json` had no rewrite for `/microsoftOAuthCallback`; the rewrite is
back (see the hosting-rewrite note below). Pinned by `functions/Utils/oauthBrowserBinding.test.js`,
`functions/GoogleOAuth/googleOAuthBrowserBinding.test.js`,
`functions/MCP/mcpClientOAuthBrowserBinding.test.js`, `functions/Utils/oauthCallbackPage.test.js`
and `utils/oauthBrowserBinding.test.js`.

### An Anna email names an account only when DKIM proves the sender (NV-06)

The inbound Anna channel routes mail by its SMTP envelope sender, which the sending server can set
to anything. Cloudflare does not give an Email Worker a dependable SPF/DKIM verdict:
`Authentication-Results` is reported missing in Worker headers (workerd#6740), and a sender can
write such a header itself. So the worker verifies the DKIM signatures on `message.raw` itself
(`cloudflare/email-worker/src/senderAuthentication.mjs`: rsa-sha256 and ed25519-sha256,
simple/relaxed, keys over DNS-over-HTTPS, an `l=` that does not cover the whole body is a fail) and
forwards `senderAuthentication: { version, dkim: [{ domain, result }], spf }`.
`functions/Email/emailSenderAuthentication.js` accepts the sender only for a verified signature
whose `d=` is aligned with the envelope domain (equal or parent/subdomain), or for an SPF pass for
exactly that domain. Anything else is answered as `unauthenticated_sender` before
`resolveEmailSenderIdentity` runs, so it never reaches an account or an assistant. SPF needs the
connecting IP, which a Worker does not get, so the worker forwards Cloudflare's own
`Authentication-Results` SPF stamp only with `TRUST_CLOUDFLARE_AUTH_RESULTS=true`. Set that only
after confirming on a live message that Cloudflare adds the header and strips a forged one.
Consequence worth knowing: a domain that signs with another domain's key (Google Workspace or
Microsoft 365 without custom DKIM: `d=…gappssmtp.com` / `…onmicrosoft.com`) can no longer use Anna
email until it enables DKIM for its own domain. A payload from a worker without the field is accepted
until `LEGACY_WORKER_GRACE_UNTIL_MS` (2026-11-23) and refused after it. Deploy the worker with
`wrangler deploy` before that date. The guest-meeting reply path (`tryHandleGuestMeetingReply`) is
unchanged: it needs the exact Anna Message-ID as well. Replayed genuinely signed mail still verifies;
that is a limit of DKIM. Pinned by `cloudflare/email-worker/tests/senderAuthentication.test.mjs` (an
independent signer), `emailSenderAuthentication.test.js` and the NV-06 cases in
`emailIncomingHandler.test.js`.

### `users/{uid}.email` is not an identity another system may trust (AT-2908)

alldone.team identifies an alldone.app account by the email address we hand it: embedded tools
key their data on it (`app:<email>`), and it names the same address again when it charges Gold
through `/api/menubar/gold`. That address used to come from `users/{uid}.email`, which the owner
could overwrite from the client (the users update rule only protected membership fields), so an
account could present somebody else's address to external tools, the menubar session and the Gold
webhook. Every address another system treats as an identity now comes from
`functions/shared/verifiedAccountEmail.js`: the Firebase Auth login email, only when verified
(`getVerifiedAccountEmail`), and the reverse lookup through `auth.getUserByEmail`
(`findUserIdByVerifiedEmail`), which holds one account per address. Never fall back to
`notificationEmail` or the document field. The rules additionally allow `users/{uid}.email` only to
be empty or the address in the writer's own token, because the client still forwards it
(`IframeModal`'s `GET_USER_DATA`). Pinned by `functions/shared/verifiedAccountEmail.test.js`
(including source checks of the call sites), `functions/MenubarApp/menubarIdentity.test.js` and the
`account email` block of `__tests__/Firestore/firestoreRules.emulator.test.js`.

**The Gold webhook has two dialects.** A request without `app` (the Anna menubar app, older
alldone.team tools) is booked as `menubar_app_usage` / `menubar_app_refund`, as always. alldone.team's
per-action billing sends `app: 'alldone-team'` plus `operationId`, `product` and `description`, and
is booked as `alldone_team_usage` / `alldone_team_refund` with the description as the Gold-history
subtitle. An `operationId` makes a request idempotent per type (`gold_webhook:<app>:<type>:<id>` in
`goldChangeClaims`), so the caller may retry a timeout. For `alldone-team` a refund must carry the
operationId of its charge and may give back at most what that charge took, once: without that, a
refund after a charge that never happened (an ambiguous timeout) would hand out Gold. Pinned by
`functions/MenubarApp/menubarGoldWebhook.test.js`.

**An assistant uses alldone.team as the person it answers (MCP auth type `alldone_app`).** An MCP server on `https://alldone.team` can be connected with "alldone.app account" instead of a token. Nothing is stored: each run calls `resolveMcpSecret` (`functions/MCP/mcpAssistantConnect.js`), which mints, through `getAlldoneTeamMcpToken` (`MenubarApp/menubarApp.js`), an hour-long `adapp_` token with app id `alldone-team-mcp` for the run's `requestUserId` (reused per instance while ten minutes remain). alldone.team checks it at `/api/menubar/session`, which now also answers `accountId` and `appId`, and acts as that person's own alldone.team account, linked to their alldone.app account and paying with their Gold (alldone_team `alldoneAppAccounts.ts`). These tokens expire (`expiresAt`), never count against the menubar app's ten devices and are not listed as devices. The auth type is refused for any other host, because the token speaks for the user's alldone.app account. A run without a requesting user gets no token. Pinned by `functions/MCP/mcpAlldoneAppAuth.test.js` and the `tokens for alldone.team/mcp` block of `functions/MenubarApp/menubarIdentity.test.js`.

### alldone.team pages in the IframeModal are billed by alldone.team's server

An alldone.team tool page opened in `IframeModal` used to get the person's email in `USER_DATA` and ask
the host to take the Gold (`DEDUCT_GOLD` → `deductGoldSecondGen`) before calling its own backend
with no token, which anyone could call directly and use for free. Now the host also hands an
`https://alldone.team` frame a short-lived alldone.app token (`USER_DATA.alldoneToken`, renewed by
`GET_ALLDONE_TOKEN`, minted by `getAlldoneTeamEmbedTokenSecondGen` through `getAlldoneTeamMcpToken`).
The page trades it for a session as the person's linked alldone.team account, and alldone.team charges
each action in Gold through the Gold webhook (`alldone_team_usage`). Once signed in, the page posts
`ALLDONE_SERVER_BILLING`, and from then on the host only acknowledges `DEDUCT_GOLD`/`REFUND_GOLD`
for that frame instead of charging twice. Before that message, the host still charges as before.
Pinned by `IframeModal.test.js`.

### Over email, Anna may change only the calendar events she created over email

The inbound email channel runs on a filtered tool set (`getEmailSafeAllowedTools`), because forwarded
mail is untrusted text and a reply can reach external recipients. `update_calendar_event` is in it, but
the bridge (`emailAssistantBridge.js`) executes it only for an eventId Anna created or changed over
email in the same conversation; any other id gets `calendar_event_not_editable_by_email` and nothing
is called. The record of those events is stored on her reply (`emailReplyMetadata.calendarEvents`,
id, calendar, title, start and end only) and read back by `getEmailCalendarEventsCreatedByAssistant`
from replies whose `creatorId` is the assistant, which the comment rules refuse to every client, so a
project member cannot plant an id. Search and delete stay unavailable by email. Before this, Anna
created an all-day event from a forwarded invitation, was told the start time, and answered that she
could not edit it: the tool was filtered out and the event id was gone with the previous run.
Changing an all-day event into a timed one also needs the replaced field cleared: Google's
`events.patch` merges `start`/`end` and answers 400 "Invalid start time" if `date` survives next to
`dateTime` (`clearReplacedEventTimeFields`), and Graph needs `isAllDay: false`. Pinned by the
calendar-event blocks of `emailAssistantBridge.test.js`, `emailDailyTopic.test.js`,
`emailChannelHelpers.test.js`, `assistantCalendarTools.test.js` and `microsoftCalendarProvider.test.js`.

### A meeting exists only after somebody's browser asked for it (AT-2480)

**A meeting is not a task until `syncCalendarEvents` has run for the user's local day.** Everything
downstream is ordinary: it writes `items/{projectId}/tasks` documents carrying `calendarData`, they
ride the normal open-tasks listeners, `getTaskTypeIndex` buckets them into `CALENDAR_TASK_INDEX`
and the Calendar section renders them. So a "the calendar section is missing" report is almost
always about the **pull**, not about the list, and the way to tell them apart is the task's own
`created` stamp: if it equals the first sync of the day, nothing was there to render before it.

Until AT-2480 the **only** caller was a browser (`checkIfCalendarConnected` →
`syncCalendarEventsSecondGen`, an `onCall` with no `onSchedule` and no trigger), so a day nobody
opened the app on had no meetings at all — including for heartbeats, push and the WhatsApp bridge,
which read the task list with no client in front of them. There are now **two** callers and they
do different jobs: the client keeps the day warm, and `syncActiveUsersCalendarsSecondGen`
(`functions/GoogleCalendar/scheduledCalendarSync.js`) makes sure the day _starts_ correct.

The board used to make that call from `OpenTasksByProjectHandler`, once per rendered project block
and gated on `inSelectedProject` — so **All Projects never pulled anything**, and the day's
meetings materialised only when the user selected the one project holding the connection. Two
quieter cases had the same shape: selecting a project that merely _receives_ routed meetings
(`calendarProjectRouting` routes an event to whichever project it classifies into, which is
frequently not the synced one) never synced either, and neither did selecting one of several
connected projects, which refreshed only that one's calendar. My Day never had the bug because
`MyDayView` loops `apisConnected` — and `showAllProjectsByTime` decides which of the two you get,
so whether the calendar syncs at all came down to a display toggle.

The connection is a property of the **user** (`loggedUser.apisConnected[projectId].calendar`), so
`useTaskBoardCalendarSync` (`components/TaskListView/taskBoardCalendarSync.js`) resolves it from
there and runs once for the whole board from `TasksByProjectSections` — the one component that
survives the All Projects ⇄ selected-project switch and the Open/In progress/Workflow/Done toggle.
It is deliberately **not** gated on `state.isLoadingData` the way the Email line is: the failure
being fixed is "the sync never ran", so a gate that can stay closed would reintroduce it. What
keeps it cheap is the one-minute per-project cooldown already inside `checkIfCalendarConnected`
plus a ref keyed on the connected-project list, so a re-render or a project switch cannot turn a
multi-second Cloud Function call into a storm. Pinned by `taskBoardCalendarSync.test.js` and
`TasksByProjectSectionsCalendarSync.test.js`.

**The scheduled half ticks hourly but syncs each user once per THEIR OWN local day.** The fetch
window is the user's local day (`getUserLocalDayStart`), so a single fixed UTC hour would fire
before local midnight for everyone west of it, sync the **wrong** day, and not fire again until
the next day's tick. The hourly `onSchedule` therefore just asks each user whether their local
date has moved past the one recorded in `users/{uid}/private/calendarScheduledSync` — one sync per
user per local day, shortly after their own midnight, per connected project. Eligibility is the
**heartbeat** definition of active: `ACTIVE_USER_WINDOW_MS` and `getTimestampMillis` are imported
from `assistantHeartbeatSchedule` rather than re-declared, so they cannot drift (`autoArchiveProjectsCloud`
and `assistantRecurringTasks` still carry their own 30-day copies — that is the drift being
avoided). On production that query returns **11** of 4381 users.

Two rules that keep it cheap and are easy to get backwards. The day marker is written **before**
the sync and **regardless of its outcome**, so a permanently broken connection (a revoked Google
token is the common one) costs one failed attempt a day instead of one an hour — recovery is the
client-side pull, which runs on every board mount. And a **failed marker read must not skip** the
sync: an unreadable state doc looks exactly like "already synced today", which would silently
disable the job for that user forever. No `firestore.rules` change, no new collection, no index —
the marker sits under the existing owner-writable `users/{userId}/{userSubcollection}/{document=**}`
rule.

Because the marker and the fetched window are answers to the same question, the timezone
resolution lives in **one** place, `functions/GoogleCalendar/calendarUserDay.js`. Note `timezone`
on the user doc is normally an **integer number of hours** (2 for Berlin), not an IANA name — a
small number is multiplied by 60, a large one is already minutes — and `preferredTimezone` (which
_is_ a real IANA name) is deliberately never consulted, because the sync never read it and
starting to would silently move every existing user's day boundary.

Worth knowing when reading a sync log: `daysAhead: 30` is passed by the client and **ignored** —
the window is one local day — and per-event LLM project routing makes a cold first sync of the day
slow (32s for 7 events on the reporting account), so the meetings land a beat after the board
paints. Deploying this adds a Cloud Scheduler job; per the runtime note above, confirm the
function actually exists after the deploy rather than trusting the deploy summary.

### Task reminders and the channel they come back on (AT-2211)

A "reminder" is not its own entity — it is `dueDate` + `alertEnabled` + the `alertTriggered`
de-dupe latch on the task. `checkTaskAlertsSecondGen` (every 5 min,
`functions/Tasks/taskAlertsCloud.js`) scans `alertEnabled == true && dueDate <= now && done == false`,
writes the in-app feed, sets `alertTriggered: true`, and fans out to push / email / WhatsApp
according to the user's **global** Notification Settings (`pushNotificationsStatus`,
`receiveEmails`, `receiveWhatsApp` + `phone`). Each channel drains through its own 1–5 min
scheduled queue; WhatsApp goes via a `whatsAppNotifications` doc and an **approved Twilio
content template**, so it is not bound by the 24-hour session window.

**A reminder asked for inside WhatsApp is delivered back over WhatsApp regardless of the
global toggle.** Purely global routing was wrong here: "Erinnere mich morgen um 10 Uhr" plainly
means "send me a WhatsApp at 10", and with `receiveWhatsApp: false` (the default) it silently
became a push notification — the feature looked broken while every stage was in fact working.
The origin channel is therefore stamped on the task as `alertChannels` (e.g. `['whatsapp']`)
and `shouldSendWhatsAppReminder` in `functions/Tasks/reminderChannels.js` treats it as an
**additional** reason to deliver. It is strictly additive — it can only turn a channel on for
a task that explicitly requested it, and never disables or reroutes push/email/in-app. Both
`sourceChannel: 'whatsapp'` (text bridge) and `'whatsapp_call'` (realtime voice) count, since
from the user's side they are one conversation on one phone.

The stamp is written in `setTaskAlertCloud` (`functions/shared/AlertService.js`), the single
funnel both `create_task` and `update_task` reach, rather than at each call site. Omitting the
option leaves any existing routing alone (so an unrelated `update_task` cannot clobber it),
while an explicit **disable** clears it — otherwise re-enabling the alert from the web UI would
silently inherit a channel the user never asked for. The frontend `setTaskAlert` deliberately
does not touch `alertChannels`, so moving a WhatsApp-set reminder's time in the app preserves
the original intent.

**Do not add a second WhatsApp send in the push path.** `taskAlertsCloud` writes _both_ a
`whatsAppNotifications` doc and a `pushNotifications` doc, and `getChatPushNotifications` reads
that collection **unfiltered** while `processPushNotifications` calls `sendWhatsAppForNotifications`
on everything in it. The alert doc carries no `initiatorId`, so the `userId !== initiatorId`
guard does not suppress it, and `parsePushBody` happily parses the alert's 3-line body — the
result was two near-identical WhatsApp messages per reminder the moment the toggle was on.
`sendWhatsAppForNotifications` now skips docs whose `type` is `ALERT_NOTIFICATION_TYPE`, a
constant shared with the producer via `reminderChannels.js` so the two cannot drift on a string
literal.

### A phone number routes WhatsApp and calls only when exactly one account claims it (NV-44)

`users/{uid}.phone` is written by its owner (`setUserPhone`) with no proof of possession; no
verification flow exists. `resolveUserByPhone` (`functions/WhatsApp/whatsAppIncomingHandler.js`)
therefore looks the number up in both stored formats (with and without `+`) and refuses to route
when more than one account claims it. It logs the claimant ids at ERROR, replies to a WhatsApp
message with a neutral "linked to more than one account" note, and rejects a call as unlinked.
`findUserByPhone` keeps its old contract (an id or null). Before this, `limit(1)` silently picked
whichever document sorted first, so anyone could take over the owner's WhatsApp channel by saving
the same number. The real fix is a verified claim: a server-owned `phone` set by a Cloud Function
after a WhatsApp one-time-code challenge, a unique `phoneClaims/{e164}` document written in a
transaction, and a rules change refusing client writes to `phone`. Until that exists, ambiguity
refusal is the only protection.

### WhatsApp replies must finish or report failure before their worker expires

`WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS` in `assistantRunLimits.js` bounds the whole queue drain
to four minutes; its derived transport timeout is 540 seconds. `whatsAppRunGuard` races context
assembly and response collection against that shared deadline and aborts the provider request.
Check the guard before tools and response writes, including delegated calls: merely racing a
Promise does not stop its continuation. A timeout marks the queue batch failed and sends a localized
WhatsApp error. Do not retry the entire assistant after a tool has started, even for a transient error.

`recoverWhatsAppInboundQueues` scans every two minutes, rotates a bounded user cursor and uses
`listDocuments()` because historical queue parents have subcollections without a parent document.
The existing per-user lock serializes recovery with normal processing. Pending requests resume;
processing requests older than the full worker timeout plus two minutes are marked failed and
reported without replaying their possibly completed actions. Keep this schedule in the assistant
run-host timeout tests. No new Firestore indexes are needed.

### An assistant result sent over WhatsApp must also land in the Daily WhatsApp Topic (AT-2387)

**A WhatsApp follow-up is answered out of exactly one thread**, the daily topic
`BotChat<userLocalDate><userId>` in the user's `defaultProjectId`: `whatsAppIncomingHandler`
resolves it, `whatsAppInboundQueueProcessor` stores the user turn there, and
`whatsAppAssistantBridge` builds the model context from `getConversationHistory` of that single
chat. Nothing else is read. So an assistant result pushed to WhatsApp from **anywhere else** is
invisible to the next message: a recurring / pre-configured task writes its answer into its own
generated task thread (`generatePreConfigTaskResult` with `objectType: 'tasks'`, often in a
different project than the WhatsApp one), and a VM job writes into its host task. The user reads
the answer on their phone, replies "and the second point?", and the assistant has never seen it.
The failure is silent and reads as amnesia, not as a bug — the message was delivered, the answer
is in the app, and every stage logged success.

The heartbeat never had the problem because it is the one producer that already **runs inside**
the daily topic (`assistantHeartbeat` picks `getOrCreateWhatsAppDailyTopic` over its own
`Heartbeat…` topic whenever it will send WhatsApp). `functions/WhatsApp/whatsAppResultMirror.js`
makes the other producers behave the same way: after a **successful** send it writes the result
verbatim into the daily topic via the canonical `getOrCreateWhatsAppDailyTopic` +
`storeAssistantMessageInTopicOnce`. There is no separate context store and no second record —
one comment, the same shape a live WhatsApp reply writes, which is why `getConversationHistory`
picks it up with no change.

**The comment leads with a source header the model never sees.** A mirrored result lands in a
thread the user never opened, so it needs to say where it came from: one line naming the task
(`📋 From your recurring task "Daily Market Analysis"`) plus a link back to its own thread, in the
plain-text-and-emoji house style of the other server-authored notices. But a recognisable prefix
on a **previous assistant turn** is exactly the pattern the next answer copies — the AT-2241
mimicry that is already why `getConversationHistory` refuses to timestamp assistant turns — and
here the user would read that mimicry on WhatsApp. So the mirror stores the bare result alongside
the headed text as `contextCommentText`, and `getConversationHistory` prefers that field for
assistant turns. Nothing is lost: the header describes where the answer came from, not what it
says. The Chats-list preview (`previewText`) also stays on the answer rather than the header's
URL, which reads badly in one line. A mirror written without a `sourceLabel` gets neither field —
`contextCommentText` is only set when there is a header to strip.

Four things are load-bearing. **The destination project is the user's `defaultProjectId`, not the
project the task ran in** — mirroring into the task's project would recreate the bug in a topic
nobody reads. **The mirror is silent**: it never touches `lastAssistantCommentData` and creates no
`chatNotifications` doc, so the originating thread keeps the MyDay AssistantLine pointer and
notification behaviour is unchanged (the chat-list preview does move, which is correct — the daily
topic should show what the assistant last said on WhatsApp). **Comment IDs are deterministic**
(`wa-mirror-<sha256(destination|source delivery)>`, the `whatsAppCallTranscript` convention) and
written in a transaction that returns early if the doc exists, because the producers are all
retryable — a rerun scheduled task, a Cloud Tasks redelivery, `vmJobReconciliation` — and
`storeAssistantMessageInTopic`'s random UUID would duplicate the message _and_ double-count
`commentsData.amount`. **It never throws**: the WhatsApp message has already gone out, so a failed
mirror must not fail or retry the delivery.

Two deliberate skips. A source thread that already **is** today's daily topic (the heartbeat) is a
no-op, and a VM job whose `postVmOriginConversationNote` is about to post into that same topic is
skipped via `alreadyDeliveredTo` — otherwise a WhatsApp-triggered delegated job would post both the
full result and its 600-char origin note. Deliberately **out of scope**: `pushNotifications.js`'s
`sendWhatsAppForNotifications`, which mirrors FCM pushes as templated `project / object / update`
summaries with a link. Those are notification summaries of arbitrary threads, not an assistant
delivering its result, and folding them in would fill the daily topic with truncated noise.

### A server-side fetch of a URL somebody else chose goes through `shared/outboundUrlGuard.js`

Functions run inside the Google network with the Admin service account, so a fetched URL that a
member, a model or a fetched document picked can name the metadata server, loopback or a VPC host.
`assertPublicUrl` (http(s) only, no credentials, no private NAMES and no private DNS ANSWERS) and
`fetchPublicUrl` (the same check, then `redirect: 'manual'` with every hop re-checked) are the one
gate, and they use the browser allowlist's classifier (`isPrivateHostname` / `isPrivateIpAddress` in
`Assistant/browser/browserAllowlist.js`) so the two cannot disagree. Two things that classifier must
keep doing: strip the trailing root dot before matching (`localhost.`, `metadata.google.internal.`
and `intranet.` are the same names to a resolver, NV-19), and parse IPv6 properly, because WHATWG
URL rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, which a dotted-only regex never matched.
Users today: `fetch_url` (`webPageFetcher.js`, NV-21), contact photos (`contactPhotoUpload.js`,
NV-29: the stored type comes from the image's magic bytes, never the URL extension, and SVG is
refused because the copy is made public), the MCP client OAuth flow (`mcpClientOAuth.js`, NV-25:
https only, guarded `fetchFn` for discovery, registration, exchange and refresh, token and
registration endpoints bound to the authorization server's origin, SDK error text — which contains
the remote response body — never returned) and webhook tasks (`webhookDestination.js`). Known limit:
the address is checked at lookup time and fetch resolves again (DNS rebinding). `browserAllowlist.js`
is copied into the browser-worker image on its own, so it may only depend on
`browserToolContract.js`; a change to it needs a worker rebuild (`browser-worker/deploy.sh`).
Pinned by `shared/outboundUrlGuard.test.js`, `shared/contactPhotoUpload.test.js`,
`MCP/mcpClientOAuth.test.js`, the NV-19 block of `browserAllowlist.test.js` and the address-policy
block of `webPageFetcher.test.js`.

### Video conversion only ever reads an object the app uploaded (NV-30)

`convertVideosSecondGen` (`functions/videosHelper.js`) used to pass the caller's `videoUri` string
straight to ffmpeg, which opens whatever protocol it names (http to any host, `file:`, `concat:`,
HLS) inside the Admin-SA function, and wrote under a caller-chosen prefix. It now takes
`{ videoUri, projectId }`: the caller must be in `projects/{projectId}.userIds`; `videoUri` must be a
Firebase download URL of the default bucket for `notesAttachments/{DDMMYYYY}/{hash}/{name}` whose
`token` is one of the object's own `firebaseStorageDownloadTokens` (a wrong token answers like a
missing file); the object is downloaded with the Admin SDK; ffmpeg reads that one local file with
`-protocol_whitelist file` and a demuxer chosen from its magic bytes (WebM/Matroska or MP4/MOV only,
so an uploaded HLS or concat playlist cannot pull in other files); the output goes next to the input
and the callable returns a download-token URL (the old `getSignedUrl` had an expiry date in the past
and hung every call until the 540s timeout). 30 conversions per user per hour via
`shared/callableRateLimit.js` (`callableRateLimits/{name}__{uid}`, server-only by default deny).
Pinned by `functions/videosHelper.test.js`.

### `ipRegistryLookup` looks up the caller and nobody else (NV-24)

It used to put a caller-supplied `data.ip` into the ipregistry URL path (any address, or 1024 of them
comma-separated, on our paid key), and the app's own call without `ip` geolocated the Functions
egress address rather than the user. It now ignores `request.data` and looks up one address: the
rightmost public `X-Forwarded-For` entry (Google's front end appends what it saw; `req.ip` under the
framework's `trust proxy` is the leftmost, client-controlled one), encoded, 10 lookups per user per
day (`shared/callableRateLimit.js`). Any failure returns the United States fallback the client
already handles. Pinned by `functions/IpRegistry/ipRegistryLookup.test.js`.

### A deleted project's id is tombstoned and its every root removed (NV-26)

`onDeleteProject` (`functions/Projects/onDeleteProjectFunctions.js`) first writes the server-only
`deletedProjects/{projectId}`, and the `projects` create rule refuses an id that has one. Before,
the create rule accepted any client-chosen id, so whoever knew a deleted project's id (a removed
member, a viewer of a link-shared project) could register it and become the only member of
everything the cleanup had missed: the wiki tree with its document texts, OKRs, VM sessions, the
upload index. The cleanup list now also covers `knowledgeBases`, `okrs`, `vmGoldens`,
`artifactUploadIndex`, `assistantSkills`, `assistantSkillImports`, `projectHappiness`,
`chatFollowers`, `oldFeeds`, `workstreams`, `notesCollab`, `firestoreAccessProjectionJobs`, the
project's `vmSessions` (queried by `projectId`) and, best effort, the note bodies under
`notesData/{projectId}/` in the notes bucket. **A new root keyed by project id belongs in that
list.** Not covered: the E2B sandboxes and golden snapshot of a deleted project (their documents
go, the E2B objects stay until E2B expires them) and skill bundle bytes in Storage. Pinned by
`Projects/onDeleteProjectFunctions.test.js` and the NV-26 block of the rules emulator suite.

### Project skill catalogs authorize on the project document (NV-18)

`requireSkillWriteAccess` (`functions/Assistant/assistantSkills.js`), the gate of
`uploadAssistantSkillFile` and `importAssistantSkillsFromRepo` for a project catalog, used to read the
caller's `users/{uid}` membership arrays, which the owner can write. It now reads
`projects/{projectId}.userIds` through `isProjectMemberData`, the authority the rules and
`assertProjectAccess` use. Any new Admin SDK gate must do the same: the user arrays may only nominate
candidate projects (`filterMemberProjectIds`). Pinned by `assistantSkillsProjectScope.test.js`.

### IAM for firebase-admin GCP calls — use the Firebase Admin SDK SA, not the compute SA

This is a repo-wide gotcha, learned the hard way. Gen2 Functions are configured through `setGlobalOptions` to run as the environment's `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` service account, and `functions/firebaseConfig*.js` uses application-default credentials in that managed runtime. Therefore **every firebase-admin call that hits a Google Cloud API authenticates as the firebase-adminsdk service account — NOT the `<projectNumber>-compute@developer.gserviceaccount.com` default runtime SA**. So when a function needs a new GCP IAM permission (Cloud Tasks, Pub/Sub, etc.), grant the role to the **firebase-adminsdk SA**. Granting the compute SA looks right but does nothing. The old CI service-account JSON files may still be prepared for legacy tooling, but Functions no longer depend on baking that long-lived key into Cloud Run revisions. IAM changes also take up to ~7 min to propagate — wait before re-testing.

### Assistant VM Tool (`execute_task_in_vm`) & Cloud Tasks worker

- **Live VM tabs in the assistant workspace**: `AnnaShell` discovers the signed-in user’s queued/running/awaiting-input VMs through `listActiveVmJobsSecondGen` (`functions/Assistant/vmWorkspace.js`). Discovery reuses the existing `pendingWebhooks` user/kind/status index, checks current project and host-object access, and returns only display metadata plus the existing status-comment reference. The selected pane subscribes to that comment for the runner’s existing three-second recent-activity feed; it is a terminal-style activity view, not a PTY or raw stdout stream. It reuses VM approval/cancellation controls and the final-message renderer. Discovery pauses while the page is hidden or assistant mode is closed; inactive VM panes release listeners but retain approval drafts. Deploy the new callable with the web client; no Firestore rules/index changes or sandbox restarts are needed. **Since AT-2916 the overview shows one card per thread, like the task list's VM badge**: the callable returns `threads` (the legacy per-run `jobs` stay for older clients). A thread with several live runs is represented by the one holding it, with queued follow-ups only counted ("+N in Warteschlange"). The user's paused VMs on **open** tasks are listed too, with the last run's result and the app link. They are found through three session fields written at admission: `lastRequestUserId`, `lastRunCorrelationId` and `taskDone`. `onUpdateTaskSecondGen` keeps `taskDone` in step, writing only when a VM task's `done` flips. Without that flag every poll would read each paused session's task: on the reporting account all 33 paused sessions were on done tasks. Sessions from before the deploy need `node migration/backfillVmSessionOverviewFields.js --firebase-project-id=<project> --execute` once, or they appear only after their next run. **A stop pressed during sandbox start-up used to leave the job in `cancel_requested` forever.** `cancelAssistantRunSecondGen` also kills the Cloud Run execution, and only the runner ever settled a cancel, so the overview kept a "Wird gestoppt…" card next to the newer run on that thread and the base reserve was never refunded. `reconcileVmWorkerTerminations` now settles such a cancel the way the runner would, but only on proof the execution is over. An expired lease is not proof: the heartbeat stops renewing once status leaves `initiated`. The reconciler also advances a thread's queue only when the settled job still held the thread, because `advanceVmThreadQueue` does not check ownership.

VM agent templates and CLI updates: the runner always uses E2B's managed `claude` / `codex` prebuilt templates. Before every invocation, including resumed sessions, it checks the active CLI against the matching npm `latest` version and prepends `/home/user/.local/bin` to `PATH`. A current, working CLI is reused; missing, stale, or older launchers are replaced under a per-agent process lock. Custom E2B template overrides are intentionally ignored.

- The tool hands long-running, open-ended work to a Claude Code agent in an ephemeral **E2B** sandbox and posts the result back into the chat. Flow: `assistantHelper.js` dispatch → `functions/Assistant/vmJob.js` (`startVmJob`: validate, gold charge, write `pendingWebhooks` + `vmJobs` docs, post status comment, enqueue) → `runVmJob` (`onTaskDispatched` in `index.js`) → `functions/Assistant/vmJobRunner.js` (E2B sandbox + headless `claude -p`, streams progress, posts result, refunds gold on failure). Reuses the existing `pendingWebhooks` async-job collection.
- **Concurrency and provider rate safety**: `functions/Assistant/vmJobConfig.js` is the shared source of truth for the ten per-user admission slots and the ten concurrent Cloud Tasks worker dispatches. An eleventh in-flight job for the same user is rejected before Gold is charged or a task is enqueued; jobs waiting behind the ten-worker global limit remain queued by Cloud Tasks. Worker starts are throttled to one per second so cold sandbox creation also stays within [E2B Hobby's documented limits](https://e2b.dev/docs/billing) (`1/sec` creation, 20 concurrent sandboxes). Deploy `runVmJob` after changing these values so Firebase updates the managed task queue.
- It is **enabled by default** — it is part of `DEFAULT_ALLOWED_TOOLS` (`toolOptions.js`), so a new assistant can spend Gold on a VM run without the owner opting in. It was opt-in originally; commit `f9a1e20b0` ("Enable VM tasks by default") moved it into the default set. It can still be switched off per assistant in the Tools Access UI. Only `mcp_servers` is currently in `OPT_IN_ONLY_TOOLS`.
- **Host thread (auto-create when contextless)**: a VM job must be anchored to a task/topic thread — the worker posts the status comment + live progress + result there, bills Gold against it, and keys the resumable VM session by `${projectId}__${objectId}`. When `execute_task_in_vm` is invoked from within a conversation it uses that thread. When it's invoked **outside** any conversation (a contextless assistant trigger with no `objectId`), the dispatcher (`executeToolNatively` → `ensureVmJobThread` in `assistantHelper.js`) creates a **fresh task** in the assistant's project (reusing `create_task`'s `resolveCreateTaskTargetProject` + `TaskService.createAndPersistTask`) to host the job. Each contextless call gets its own task/thread — and therefore its own (cold) VM session; the work is continued later by talking to the assistant inside that created task, which then resumes normally. The per-user concurrency cap is pre-checked in the dispatcher before the host task is created (so a capped user gets no stray empty task); `startVmJob` re-checks it as the authoritative gate. The `!projectId || !objectId` guard in `startVmJob` is now a defensive fallback rather than the primary path.
- **Following + visibility of the auto-created task**: `ensureVmJobThread` calls `ensureChatExists` (exported from `assistantStatusHelper.js`) right after persisting the task to create its chat object with the requesting user in `usersFollowing`/`followerIds`, `stickyData.days=0`, and `isPublicFor=[FEED_PUBLIC_FOR_ALL, creatorId]`. This guarantees following — so the user gets in-app + push + email chat notifications when the VM posts its result, and the task appears in their chat list — instead of relying on the later best-effort status-comment write (`createInitialStatusMessage`) to be the first chat-object writer. The `isPublicFor` is set public-for-all so the chat matches the task doc's visibility (the task is created with `isPrivate:false`, so `createTaskObject` already sets `isPublicFor=[FEED_PUBLIC_FOR_ALL, userId]`) — both the task and its chat are visible to all project members. The worker's completion path notifies `userIdsToNotify` (always includes the requester) for in-app notifications and `getObjectFollowersIds` (= `usersFollowing`) for push/email (`vmJobRunner.js` `applyVmCompletionMetadata`).
- **Context for the auto-created task** (`vmHostTaskHelper.js`): a fresh task has no thread conversation for `buildVmThreadContext` to read, so `ensureVmJobThread` posts the **full prompt as the task's first chat entry** (the title from `buildVmJobTaskName` is necessarily abbreviated, and the description is left empty). `postUserRequestComment` (shared with workflow AI steps) writes a user-authored comment (`fromAssistant: false`, `STAYWARD_COMMENT`) whose text is `buildVmJobTaskDescription` (objective + `**Deliverable:**` + `**Original request:**`, the request line omitted when it equals the objective) with any attached images embedded as image tokens (`mergeTaskDescriptionWithImages`) and set on `mediaContext`. Because it's a real comment, the user reads exactly what the VM was asked, and the VM agent is grounded through `buildVmThreadContext`'s normal conversation/attachment slices — i.e. the contextless job now behaves like a normal in-thread one (no special `originatingRequest` path). Everything else in the bundle (user/project descriptions, user memory, assistant persona, date/time, language) resolves from docs and works for a brand-new task unchanged.
- **Result delivery across channels (incl. delegation)**: a settled VM job (completed/failed/cancelled/gold-exhausted) always posts its result into the host task thread, but it also fans out to the channels the request actually came through via `notifyVmResultChannels` (`vmJobRunner.js`): (1) **WhatsApp** — when the job is WhatsApp-triggered (`triggerChannel === 'whatsapp'` + `whatsappTo`), `sendWhatsAppVmResultNotification` texts the result + a deep link back via Twilio; (2) **origin conversation** — when the job was delegated from another thread, `postVmOriginConversationNote` posts a short completion note (authored by the origin assistant, with a link to the host task) back into the conversation the user is actually in. The hard part is the **delegation chain** (WhatsApp → Anna → `talk_to_assistant` → CTO in project X → `execute_task_in_vm`): `executeDelegatedAssistantRequest` used to build a delegated runtime context with only `projectId`/`assistantId`/`requestUserId`, dropping the channel — so the VM had no way to notify the WhatsApp user. It now forwards `sourceChannel` + `whatsappFromNumber` (so the WhatsApp completion text fires) and the **origin conversation** (`originProjectId`/`originObjectType`/`originObjectId`/`originAssistantId`, persisted on the job by `startVmJob` only when distinct from the host thread) plus `language`/`userTimezoneOffset`. It deliberately does **not** forward `objectType`/`objectId`, so the delegate still hosts the job in its own fresh task (the contextless path) rather than the caller's thread. The requester also follows the host task (in-app/push/email) as the in-app fallback.
- **A run that ends without doing the work lands back on a human (AT-2196)**: an agent question and a failure share one mechanism, the _reviewer hold_ in `functions/Assistant/vmWorkflowHold.js` (field `vmInteractionWorkflowStep` on the task, `reason: 'interaction' | 'failure'`). Open task lists are keyed by `currentReviewerId`, so a failed run that left the task on its assistant reviewer simply **disappeared from every human's list** — nothing else was ever going to move it, and the only trace was an unread comment in a thread nobody was watching. Now any settled-unfinished run (`failed` **or** `cancelled`, including timeout, gold exhaustion, missing credentials, a Cloud Run launch that failed or could never be confirmed, a queued job skipped for insufficient Gold, and an expired interaction) hands `currentReviewerId` to the requesting user and records the displaced reviewer. **The workflow step is deliberately untouched** — no `stepHistory` growth, no `done`/`completed` stamps, no subtask moves — for exactly the reasons in the `vmWorkflowHold.js` header comment; `finalizeWorkflowAiRun` already declines to advance a run that carries a `failureReason`, so a failed VM keeps its step and only changes hands. Applied through the single funnel in `writeStatusComment` → `applyVmCompletionMetadata` (same transaction as the comment metadata), so every failure branch is covered without duplicating logic. A hold is **never stolen** from another live job, is a no-op if the task is already the user's, and — because a run has five hours to fail and a question a full day to expire — is only taken when the task is **still parked where the job left it** (`claimableReviewerIds`: the reviewer observed at run start, or the invoking assistant). A human who took the task over meanwhile keeps it; it is visible to a person already, which is the whole point. Release is on **retry**: the next run gives the step back to the displaced reviewer right after it claims its lease (`prepareVmFailureHoldForRun`, which returns that reviewer in the same read), re-applying the hold if that run fails too. Only the hold's own user releases it, so a colleague's run in the same thread cannot clear a failure they never saw, and the thread-busy deferral — which re-queues with no comment and no settlement — puts back what it released (`restoreVmFailureWorkflowHold`). Successful and in-progress runs never touch the reviewer.
- **VM output identity boundary**: the host runner is the only component that publishes VM progress, questions, and final output into the task thread; `writeStatusComment` stamps the frozen invoking `assistantId`. A personal Codex subscription can otherwise expose the user's connected ChatGPT apps inside the sandbox. Calling Alldone's `update_task(comment=...)` through that user-scoped MCP connection has no assistant context and therefore correctly looks like a human MCP comment — but it duplicates VM output under the wrong actor. Codex VM runs disable `features.apps` in both automatic and app-server/interactive modes, and the agent prompt explicitly forbids self-posting through Alldone MCP/API tools. Normal user MCP calls outside a VM remain user-authored.
- **Interactive approval strictness (`strict` | `balanced` | `permissive`, AT-2199)**: only interactive Claude runs pause for approval, and `functions/Assistant/vmAgentApprovalPolicy.js` decides what pauses. It is copied verbatim into the sandbox as `approval-policy.cjs` by `prepareVmAgentBridge` and evaluated in the Agent SDK's `canUseTool` hook (`vm-agent-bridge/claude-agent-sdk.mjs`) — **there is no `~/.claude/settings.json` in the sandbox, so `permissions.allow` rules are not the lever here**; editing that file would change nothing. Resolution mirrors agent choice: an explicit `approvalPolicy` tool argument wins, then `users/{uid}.defaultVmApprovalPolicy` (Settings → Integrations, via `setDefaultVmApprovalPolicy`), then the system default **`balanced`**. The original policy was effectively `strict` and was noisy for two structural reasons worth remembering: it matched HTTP _mutation flags_, so the Firestore/Cloud-Logging reads **Alldone's own VM prompt instructs the agent to perform** looked like writes (they are reads that must be `POST`ed with a body — hence `READ_ONLY_ENDPOINT_PATTERNS`); and it matched `git push` as a raw substring with no target analysis, so the feature-branch push the platform prompt _mandates_ paused too (hence `analyzeGitPush`, which resolves `HEAD` against the live branch read from `GIT_DIR`/`.git/HEAD` on every call, because the agent creates its branch mid-run). `balanced` therefore auto-approves read-shaped HTTP and the push + MR/PR-create flow, while still pausing on the base branch, force/delete pushes, merges, deployments, secrets and destructive Git. `permissive` adds MR/PR merge and arbitrary outbound HTTP. **Regardless of level, `curl … | bash` (remote code execution) always pauses and can never be allowlisted.** **What counts as remote code execution is decided structurally, not by the pipe shape (AT-2235).** The rule used to match `curl|wget … | <interpreter>` as a substring, which condemned two things that are not RCE: piping a download into an interpreter that was handed **its own inline program** (`curl "…/pipelines/123" | python3 -c "…json.load(sys.stdin)…"` — the fetched bytes are stdin _data_, the program is local), and any command that merely _contained_ that text (a `grep` for it, a `node -e` diagnostic). Because the rule is always-escalate, `permissive` could not override it — a `permissive` production run paused on exactly that GitLab pipeline-status curl. `detectRemoteScriptExecution` now walks the pipeline and escalates only when the interpreter would actually read its program from stdin (bare `bash`/`python3`/`node`, `bash -s`, `python3 -`, an inline program that `exec`s stdin), following the data through pass-through stages (`… | tee x | bash`) and resetting at non-pipe separators (`… || bash`). It also now catches the substitution forms the pipe-only pattern never saw — `bash -c "$(curl …)"`, `eval $(curl …)`, `bash <(curl …)` — and classifies `… | sudo bash` as remote execution rather than the weaker (allowlistable) elevated-shell rule. The "Allow for this run" button is run-scoped only: the policy returns a stable `signature` for the operation _shape_ (e.g. `bash:http_write:api.example.com`), `answerVmInteractionRequest` appends it to `approvalAllowlist` on the job's `pendingWebhooks` doc (capped at 50, computed in-transaction rather than via `arrayUnion`), and nothing survives the job — a new job starts empty. An operation that must always pause reports an empty signature, which is how the UI hides the button — `assessClaudeToolApproval` enforces that at the exit, because the always-escalate branch used to return a real signature and the UI therefore offered a button whose grant the policy then refused to honour (the incident job's `approvalAllowlist` literally contains `bash:remote_execution`). Two deliberate limits: **Codex is unaffected** (it uses its own native `on-request` + `auto_review` in `codex-app-server.mjs`), and the levels are a **UX guardrail, not a sandbox boundary** — `node x.js` is auto-approved at `balanced` and can do anything, so the real containment stays the isolated E2B sandbox, the read-only GCP token and the repo-scoped git token.
- **`permissive` is Auto-Mode, and the level actually has to reach the rules (AT-2343)**: for a long time only three rules consulted the level at all (`analyzeGitPush`, MR/PR merge, outbound HTTP) — every other escalation was level-independent, so picking `permissive` changed almost nothing and interactive runs kept pausing on their own housekeeping. Two things were wrong. First, **the risky-pattern matching ran over the raw command string**, so a heredoc body or a quoted argument was scanned as if it were code: production interaction records are full of `git commit -F - <<'EOF' …` escalating as `bash:secrets` because the commit MESSAGE mentioned `.env`, a `python3 - <<'PY'` block escalating because the documentation it wrote contains the word "secrets", and `git check-ignore -v .env` escalating for the same reason — `splitCommandPipeline` even chopped those bodies into fake command segments at every `|` and `;` they contained. A heredoc body is now stdin **data** unless the reader would execute stdin as a program (`bash <<'EOF'`, `python3 - <<'PY'`), which is the same structural test AT-2235 introduced for pipes, and quoted argument content is blanked before the risky-command rules run — except for interpreters given inline code (`bash -c "…"`) and for programs whose quoted argument IS the operation (`psql -c "delete …"`, `ssh host "…"`). Secret detection matches real **path operands** (`classifySecretPathAccess`) instead of any occurrence of the word anywhere on the line, so `grep -rn secrets functions/` is a search again while `cat "$HOME/.ssh/id_rsa"` is still caught. Second, every rule now carries an **`allowedFrom` level** and the whole product decision sits in one table of named constants at the top of the module. `permissive` therefore auto-approves everything that only touches the ephemeral sandbox: `rm -r` anywhere in the VM, force-pushing a **feature** branch, `sudo`, workspace env files (the repo's own suite needs `node ci/writeTestEnv.js` to write one), writes outside the checkout, MR/PR merge and close, and unrecognised or MCP tools. `balanced` additionally got local Git housekeeping (`reset --hard`, `clean -fd`, `branch -D`) — local-only, and the remote is still governed by the push rules. What pauses at **every** level is the hard-danger list: base-branch push/force/delete, deployments and cloud mutation, package publishing, external DB mutation, `mkfs`/`dd of=`, `ssh`/`scp`/`sftp` to another machine, `curl … | bash`, real credential stores (`~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.codex/auth.json`, service-account keys, `*.pem`), deleting a protected root or the checkout itself, and writing into a system directory. Two smaller fixes ride along: the modern Claude Code tool surface (`BashOutput`, `KillShell`, `SlashCommand`, `Skill`, `NotebookRead`) was missing from `SAFE_CLAUDE_TOOLS` and therefore escalated on **every single call**, and the bridge now passes `additionalDirectories` as `writableRoots` so the relocated Git metadata does not read as a write "outside the working directory". `strict` is unchanged: it keeps its blanket wording for Git publishing and for any recursive delete. **`HEAD` is resolved after the branch steps of the same tool call (AT-2876).** The live branch is read when the call is reviewed, i.e. before any of it runs, and the agent's delivery flow is ONE call — `git checkout -b ai/x && git add … && git commit -F - <<'EOF' … EOF` and then `git push -u origin HEAD` on the next line — so `HEAD` resolved to the base branch it had not left yet and every such run paused at `permissive` as "a push to the base branch". `assessBashCommand` now walks the command line in order (`analyzeGitBranchChange` + `createBranchTracker`, honouring `&&`/`||`/`;`) and judges a push against every branch it could run on. By product decision a branch CREATION (`checkout -b/-B`, `switch -c/-C`, `--track`) counts as done for everything after it, even behind a newline, because a failed creation is the only way that push lands on the base branch and the remote's protection rejects it; a push reachable only through a failed creation (`checkout -b x || git push …`), a plain `git checkout x` (may be a file restore), an explicit `master`/`HEAD:master` refspec and switching BACK to the base branch before pushing `HEAD` (previously auto-approved) all still pause. Remember this module ships in the **`vm-job-runner` Cloud Run image**, so the change is live only after `deploy:cloud:runner:*` rebuilds it.
- **A per-run override only counts when the user asked for it (AT-2224)**: `agent`, `agentModel`, `agentReasoningEffort` and `approvalPolicy` outrank the saved Settings → Integrations defaults, and the assistant fills them in **on its own** — production workflow-step tool calls carried `agent: 'codex'` and `approvalPolicy: 'balanced'` for a user whose saved defaults were `claude` / `permissive`, with nothing in the request asking for either. It reads as "my default is ignored, sometimes", because it is a sampling decision. `functions/Assistant/vmRunOverrideGuard.js` therefore drops any of those four that the user's own words do not corroborate, before `startVmJob` resolves anything; the dropped value simply resolves from the saved preference instead. Evidence is deliberately **user-authored text only** (`userContext.message`, the workflow step prompt, recent user turns of the thread threaded through `toolRuntimeContext.userRequestText`) — the tool arguments, including `objective` and `deliverable`, are model-authored and can never corroborate themselves. Naming a model names its agent ("use opus" ⇒ Claude); an effort level needs effort/reasoning context next to it, because "high" is ordinary prose; an invalid value passes through untouched so `startVmJob`'s validation still rejects it normally. The schema descriptions in `toolSchemas.js` carry the other half of the fix and must stay agent-neutral — the original text said "consider codex for heavy coding / repository work", which is what generated the bug. Failure is safe by construction: an unrecognised phrasing costs the user their explicit override, never their saved default.
- **Agent choice**: the tool takes optional `agent` (`claude` | `codex`) and `agentReasoningEffort` (`low` | `medium` | `high` | `xhigh`) params. Resolution happens once in `startVmJob`: a **corroborated** explicit tool argument wins (see above), otherwise `users/{uid}.defaultVmAgent` / `defaultVmAgentReasoningEffort` is used. Users without saved preferences receive the system defaults (`codex` + `medium`). Settings → Integrations persists the validated preferences through `getVmAgentSettings`, `setDefaultVmAgent`, and `setDefaultVmAgentReasoningEffort`; an explicit `null` effort preserves the user's "No default" choice and uses the selected provider's fallback. You can additionally pass `agentModel` (defaults: Claude → moving `opus` alias, Codex → `gpt-5.6-sol`); `opus` is persisted and passed unchanged so Claude Code automatically follows the latest Opus release. The minimum effort is `low`; legacy Codex `minimal` requests are still clamped to `low` because current Codex Responses requests may include tools that OpenAI rejects with minimal effort. Claude uses `--effort`; Codex uses `model_reasoning_effort`. Before Claude starts, status text says that the alias version is resolving; the worker then reads the concrete model ID from Claude CLI / Agent SDK's `system/init.model` event (and confirms/falls back via the primary assistant message's `message.model`), persists it as `resolvedAgentModel`, and force-refreshes the live header with a friendly version such as `Opus 4.8` or `Opus 5.0`. If Claude fails before emitting either event, no concrete runtime version is available. `vmJobRunner.js`'s `AGENT_CONFIGS` maps the agent to the matching E2B prebuilt template, credentials, and per-agent runtime: automatic Claude jobs call `claude -p … --model <id> --effort <level> --output-format stream-json`, interactive Claude jobs pass the same model ID to the Agent SDK bridge, and Codex calls `codex exec --model <id> -c model_reasoning_effort=medium --json`. Before each invocation the runner validates the active CLI against npm `latest`; only a missing, invalid, or older version is installed into `/home/user/.local`. Custom E2B template overrides are ignored.
- **Default model family (AT-2221)**: the user picks a _family_ — "Opus"/"Sonnet"/"Haiku"/"Fable" for Claude, "Sol"/"Terra"/"Luna" for Codex — never a concrete version, and it is stored **per agent** at `users/{uid}.defaultVmAgentModel = { claude, codex }` (written with a dotted field path so saving one agent cannot clobber the other's choice). Precedence matches `agent`/`agentReasoningEffort`: a **corroborated** explicit `agentModel` tool argument wins (AT-2224 — an uncorroborated one is dropped and resolves from the saved family), then the saved family, then the per-agent constant — so a user who never chose one behaves exactly as before. **The family is resolved to a model id at launch, not at save time** (`resolveAgentModelForRun` in `vmJob.js`), which is what makes "always the latest version of that family" true. `functions/Assistant/vmAgentModelCatalog.js` discovers families live from the providers' own `GET /v1/models` endpoints with the platform keys, parsing `claude-<family>-<major>[-<minor>]` and `gpt-<gen>-<tier>`, and caches the result in `vmAgentModelCatalog/{provider}` for 12h shared across all users (server-write/no client read — the default-deny rule already covers it, no `firestore.rules` change). **The two providers resolve differently on purpose**: Claude Code accepts `opus`/`sonnet`/`haiku` as _moving aliases_, so those are passed through unchanged and the CLI picks the newest release itself (the concrete id still comes back via `resolvedAgentModel`); families with no alias (`fable`, `mythos`, anything new) and every Codex tier are pinned to the newest discovered id. Codex additionally keeps only tiers present at the **newest generation** (major _and_ minor — matching the major alone would resurrect the retired `gpt-5.4` `mini`/`nano` next to `gpt-5.6`); Claude deliberately does not filter this way, since Haiku 4.5 is a whole major behind Opus 5 and still current. Degradation is total and silent: live → cached → **stale cache** (a real-but-old catalog beats a hardcoded one) → static fallback, and every failure path falls back to the previous default rather than blocking Settings or a VM run. `formatAgentModelLabel` is family-aware for every tier now (`Sonnet 4.6`, `Sol 5.6`), not just Opus.
- **OpenRouter models for the Codex harness (AT-2230)**: Codex speaks a plain OpenAI-compatible wire protocol, so it can drive any tool-calling OpenRouter model — the latest DeepSeek releases among them. Settings → Integrations therefore shows an **OpenAI / OpenRouter source toggle** under Codex (Claude has none: it cannot run one). **The source is encoded into the model string, not carried beside it**: `openrouter:deepseek/deepseek-chat` vs `gpt-5.6-sol`, decoded by `functions/Assistant/vmModelRouting.js` (`resolveModelRoute`). That is the whole design decision — a parallel `modelSource` field would have to be threaded through the tool argument, the `vmJobs`/`pendingWebhooks` docs, the settings map, `resolveAgentRunDetails` and the bridge input, and any one of them could drift out of sync with `agentModel`; one prefixed string cannot. It also means an old job doc still means exactly what it meant before. The selection shares the **Codex slot** of `users/{uid}.defaultVmAgentModel` (same question, one answer), and `resolveModelRoute` hands the CLI the **bare** id — the prefix is an Alldone marker and Codex would 404 on it. Three things differ from the OpenAI route and all three are load-bearing: the proxy route is `/openrouter/v1` (`vmLlmProxy` swaps in `OPENROUTER_API_KEY`, so the key never enters the sandbox exactly as for the other two); `wire_api` is **`chat`**, because Responses is OpenAI's own API and OpenRouter exposes the OpenAI-_compatible_ Chat Completions surface (asking it for `responses` fails at the first request with an error that reads like a proxy bug); and the proxy **injects `stream_options.include_usage`** into streaming requests, because Chat Completions omits `usage` from a stream unless asked — without it every streamed OpenRouter run would bill **zero** Gold, a silent revenue hole rather than a visible failure. Discovery is live from `GET https://openrouter.ai/api/v1/models` (public endpoint, cached in `vmAgentModelCatalog/openrouter` on the same 12h/degrade machinery), keeping only models whose `supported_parameters` include `tools` — a model without tool calling cannot run an agent loop at all — and excluding `openai/*`, which is already offered natively. **An OpenRouter run resolves its own credential slot** (BYOK, AT-2230): the user picks between **Alldone Gold** (the platform `OPENROUTER_API_KEY`) and **their own OpenRouter API key** in Settings → Integrations, exactly as for Claude/Codex, and a BYOK run pays no model-token Gold while still paying the 20-Gold base and 10-Gold-per-minute infra charges. What it must NOT do is inherit the Codex route: a ChatGPT subscription and a personal OpenAI key both authenticate against OpenAI and neither can serve DeepSeek, which is why credentials are keyed on a **credential provider** (`claude` | `codex` | `openrouter`, `resolveCredentialProvider` in `vmModelRouting.js`) rather than on the agent — the OpenAI and OpenRouter proxy routes share `expectedAgent: 'codex'` and are otherwise indistinguishable. OpenRouter is BYOK-or-Gold only; it sells no subscription to connect, so `providerSupportsSubscription` is false for it and the Settings card renders two routes, not three. The slot is persisted as `credentialProvider` on both job docs and encoded as `cp` inside the signed proxy token, and `vmLlmProxy` **rejects (403)** a BYOK request whose token provider does not match the route it arrived on. That check is load-bearing rather than defensive: before it, a Codex-BYOK job could call `/openrouter` — the token was valid (same agent), the job was flagged `tokenBillingExempt`, and `supportsByok: false` made the request fall back to the **platform** OpenRouter key, i.e. Alldone paying for tokens it charged no Gold for. **Gold is priced per model as a researched multiple of Sol**, which is the baseline and keeps the historical 100 tokens/Gold: `functions/Assistant/vmTokenPricing.js` is the single authority, and every other rate is `BASE * (blendedUsdPerMillion(Sol) / blendedUsdPerMillion(model))`, scaled as a divisor rather than a discounted price so the relationships survive any reprice of the base. Current rates (tokens per Gold): Sol 100, **Terra 250**, **Luna 2500**, DeepSeek V4 Pro 1800, V4 Flash 2800, V4 Flash 0731 4900, V3.2 820, deepseek-chat 490, **R1 180**, qwen3-coder 960, GLM-4.6 770, Kimi K2 Thinking 560. Two findings drive that table and both are counter-intuitive. First, **OpenAI's 2026-07-30 cut (Luna −80%, Terra −20%) made Luna 25x cheaper than Sol**, which overtook DeepSeek — so the previous "DeepSeek is 1/5 of Luna" rule billed every DeepSeek run below upstream cost, and Luna, not DeepSeek, is now the cheap tier. Terra (2.5x) and Luna (25x) are **exact and mix-independent**, because every Terra rate is 0.4x and every Luna rate 0.04x the matching Sol rate on input, cached input _and_ output alike. Second, the proxy meters one undifferentiated total-token number, so collapsing a three-part price list into one rate needs an input/output mix — and `OBSERVED_TOKEN_MIX` is **measured from production** (27 runs, 111.9M tokens), not assumed: **output is 0.4% of metered tokens and 85% are cache reads.** Prompt caching, not list price, therefore decides the real cost of an agentic run, which is why rates are **per model line, not per vendor**: `deepseek-r1` publishes no cache-read price, so it bills those 85% at full input price and lands at only 1.8x cheaper than Sol, while `deepseek-v4-pro` — dearer per output token — is 18x cheaper because its cache reads cost $0.003625/1M. A single vendor-wide DeepSeek rate would under-bill R1 by an order of magnitude. Two traps in that code, both of which silently make an uncached model look like the cheapest in the table: `Number(null)` is `0`, so a missing `input_cache_read` must be tested with `== null` **before** the numeric conversion (otherwise 85% of tokens price as free), and Luna's exact 0.04x arrives as `24.999999999999996` in binary, so quantizing to two significant figures needs a relative epsilon or it publishes 2400 instead of 2500. Prices come from **live** OpenRouter discovery first (`getOpenRouterUpstreamPrice`; the catalog now caches a `pricing` list covering every compatible model, not just the picker's top 40, and it is stripped from the client payload unless `includePricing` is set), then a **researched static table**, then the Sol base rate — never "assume it is cheap", because under-billing is a silent revenue hole while over-billing is visible and correctable. `startVmJob` resolves the rate **once** and freezes it as `tokensPerGold` on both the `vmJobs` and `pendingWebhooks` docs, so a catalog refresh mid-run cannot move what the user pays and neither charge site needs an async read inside its transaction. That single-authority module exists because the token charge is applied in **two** places that must agree exactly: `vmLlmProxy.chargeProxyTokenGold` bills incrementally against the run's cumulative token total while it streams, and `vmJobRunner.calculateCompletionGoldCharges` settles `round(total / rate) - alreadyCharged` at the end. Before it, the rate was a `const VM_TOKENS_PER_GOLD = 100` duplicated in `vmJob.js` and `vmLlmProxy.js` — and a drift between the two mis-bills invisibly in both directions: a higher settlement rate silently overcharges, a lower one clamps the subtraction to zero and hides the discrepancy. Both now call `resolveEffectiveTokensPerGold` on the same persisted job state (reading the rate from job state rather than the sandbox's request body also means a compromised agent cannot talk its own tokens down). **Native Anthropic models now use the same Sol-relative pricing path**, with version-specific official prices as detailed in the Anthropic Gold pricing note below. Only the **token** line moves: the 20-Gold base reserve and the 10-Gold-per-minute compute charge pay for the E2B sandbox, which costs the same whichever model the agent talks to. The hazard a bigger divisor introduces is rounding: at 4900 tokens/Gold a small request rounds to **zero** Gold 49x more often than at the Sol rate — safe only because both charge sites round against the run's _cumulative_ total, so dust is deferred and banked, never discarded. `formatVmBillingStatus` names the rate in the status comment (quoting the persisted rate, so the number shown is the number billed), since otherwise the only way to notice it is to compare Gold-history entries after the fact. **`OPENROUTER_API_KEY` needs THREE things, and two of them are easy to miss.** (1) It goes into the `GOOGLE_FUNCTIONS_ENV_DEV`/`_PROD` JSON blobs — a _key inside that JSON object_, not a standalone GitLab CI variable, which is what CI writes to `env_functions.json`. (2) It must also be listed in **`functions/envFunctionsHelper.js`**, which is an explicit **allowlist, not a passthrough**: a key present in the blob but absent from that map is silently `undefined` for every caller, with no warning and nothing failing at deploy time. This is precisely how AT-2230 shipped — the CI variable was set and `isOpenRouterConfigured()` still answered false, so the source toggle stayed hidden and every OpenRouter run was refused. `functions/envFunctionsHelper.test.js` pins it now. (3) The **Cloud Run runner image** needs it too, because `vmJobRunner` checks the key's presence before starting a sandbox — it comes from the same variable (`deploy:cloud:runner:*` writes the same blob into the image), but the image must be **rebuilt**, which CI does on any `functions/**` change. Without the platform key, Alldone Gold is unavailable for OpenRouter but **BYOK still works** — the platform key is only consulted on the Gold route. `startVmJob` refuses before charging any Gold in either direction (no platform key on the Gold route; no stored key on the BYOK route), naming the fix in both messages, because otherwise the proxy's rejection of the first request surfaces as a mid-run 503 after the base reserve and per-minute Gold have already been taken.
- **OpenRouter featured models + search**: the default OpenRouter picker is intentionally compact. For every major vendor in `OPENROUTER_VENDOR_ORDER`, discovery features the newest canonical model and the highest OpenRouter `agentic_index` model when that is different. Variants such as `:free` and `:batch` remain searchable but do not displace canonical recommendations. A client-safe `searchModels` index contains every compatible model for instant local Settings search; it deliberately omits pricing, while the server-only `pricing` index still covers the same full catalog. Saved non-featured models stay visible beside the featured choices. `setDefaultVmAgentModel` and `resolveFamilyToModel` validate/resolve against both lists, so a searched selection is a first-class persisted default rather than a UI-only escape hatch.
- **Model picker Gold rates use the billing authority**: every Claude, OpenAI and OpenRouter model entry returned to Settings carries a derived `tokensPerGold`, rendered as `1 Gold = N tokens`. `decorateCatalogGoldPricing` calls `vmTokenPricing.resolveTokensPerGold`, including the live OpenRouter price lookup already present in the cached catalog, so the picker cannot drift from launch-time billing. The raw OpenRouter `pricing` list remains server-only. Claude, OpenAI and OpenRouter therefore all display the model-specific rate used by launch-time billing.
- **Anthropic Gold pricing (2026-08-13, refreshed 2026-09-23 for AT-2625)**: native Anthropic models use official Claude API input/cache-read/output prices through the same measured token mix and 100-token Sol baseline as every other platform-billed model. Prices are version-specific because Opus 4.1 is $15/$1.50/$75, Opus 4.5–5 are $5/$0.50/$25 and Opus 5.5 is $4/$0.20/$20 (its cache reads are 0.05x input, not 0.1x), while Sonnet 5 is $2/$0.20/$10 against Sonnet 4.6's $3/$0.30/$15. Current moving-alias rates (tokens per Gold) are Opus 120 (Opus 5.5 — the saving is passed through, and pinned `claude-opus-5`/`4-8` keep 80), Sonnet 200 and Haiku 400; Fable/Mythos 5.1 are 53. Concrete retired ids keep their own rate rather than inheriting the latest family price. **A new Claude id with no entry in `CLAUDE_MODEL_REFERENCE_PRICES` is billed at the most expensive known Claude rate** (currently 26, the Opus 4.1 price), so a release like Opus 5.5 must be added the day Claude Code starts resolving the alias to it — pinned `claude-opus-5-5` runs were over-billed ~4.6x until AT-2625. Batch and fast-mode prices do not apply to VM runs.
- **Optional personal subscription auth**: Settings → Integrations lets a user connect Claude (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) or Codex (`codex login` with `cli_auth_credentials_store = "file"`, then paste `~/.codex/auth.json`). Credentials live in `users/{uid}/private/vmAgentSubscriptions`; callable responses expose status only, never the secret. The job records whether subscription or Alldone API billing was selected and says so in both initial and live VM status text. API-billed runs use `vmLlmProxy` so platform API keys never enter the sandbox. Subscription runs bypass the proxy: Claude receives the OAuth token only in the process environment; Codex receives a mode-600 auth cache in `/home/user/.codex/auth.json`. The worker persists a refreshed Codex cache and removes it before pausing the reusable sandbox.
- **Detached Cloud Run Job + runtime errors**: `startVmJob` always launches one `vm-job-runner` Cloud Run Job execution through the Cloud Run v2 API instead of putting work behind Cloud Tasks' HTTP dispatch ceiling; there is no rollout feature flag. `vmJobConfig.js` sets an exact **five-hour agent runtime** split into **55-minute E2B leases**. At each boundary the runner disconnects the command stream, pauses and resumes the same sandbox, reconnects to the same PID, and reloads durable stdout/stderr from the VM. E2B's independent command-connection timeout is disabled (`timeoutMs: 0`) so it cannot kill the process after one hour; the runner supervisor is the authoritative limit. The Cloud Run task is deployed with a **5h45m timeout** for lease handoffs, artifacts, Gold settlement, result fan-out, refunds and sandbox cleanup. The runner claims a Firestore job lease and writes heartbeats so a duplicate/stale execution does not supervise the same paid run concurrently. It also transactionally leases each per-chat `vmSessions` sandbox before resuming it; overlapping work on the same thread is **queued** rather than run on a throwaway isolated sandbox (see the per-thread job queue section below), and command-channel timeouts or forced `-1` exits discard the unhealthy sandbox instead of preserving orphaned processes. Its typed timer maps timeout-shaped E2B errors to `The VM task exceeded its allowed execution time of 5 hours...` with `failureReason: runtime_timeout`. Build/deploy/IAM instructions are in `functions/Assistant/cloud-run-job/README.md`.
- **Persistent per-thread session (resume)**: each chat thread keeps one VM session. After a run the worker **pauses** the sandbox (snapshotting filesystem + the agent's session store) and records its id on `vmSessions/{projectId}__{objectId}`; the next `execute_task_in_vm` in that thread **resumes** it (`Sandbox.connect`) and runs the agent with `--continue` (Claude) / `codex exec resume --last` so it keeps prior files + conversation. `e2b@1.x` has no `pause()` — we POST the pause REST endpoint (`api.e2b.dev/sandboxes/{id}/pause`, `X-API-KEY`) directly; resume is `Sandbox.connect`, cleanup is `Sandbox.kill`. After a run the sandbox is **kept running for a ~10-min keep-alive window** (so back-to-back tasks in a thread hit a live VM with no resume latency); the `pauseIdleVmSessions` schedule (every 2 min) pauses sessions idle past that window, and `cleanupIdleVmSessions` deletes them after 7 days. The sandbox self-kill timeout (15 min) sits above the grace window + pauser interval so the pauser always pauses (preserving state) before E2B would kill the idle VM. `collectArtifacts` filters by `modifiedTime` so a resume only re-attaches files written in that run. Caveat: persistence is an E2B beta — validate across multiple resumes ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)).
- **Paused VM cleanup (AT-2962)**: E2B's `409 already paused` is an idempotent success. The scheduled pauser clears a sandbox pointer only after a confirmed 404; transient/network/auth errors preserve it for retry. Paused status writes recheck the sandbox ID, last use and lease transactionally. Expired session deletion and a server-only `vmSandboxDeletions/{sandboxId}` outbox entry are committed atomically; cleanup attempts up to 20 due entries per run with bounded E2B calls, retaining failed kills for retry. An optional `notBefore` timestamp tracks a recent legacy orphan until its seven-day retention deadline; future entries do not consume the attempt budget. The outbox also tracks sandboxes discarded during resume/agent replacement or unhealthy-run recovery. Never delete an outbox target still referenced by a session. Deploy the Functions package **and** the `vm-job-runner` image. Legacy sandboxes without a session reference require a fresh E2B inventory comparison against both production and staging, a paused-state check, and a last-runtime timestamp older than seven days before one-time deletion. Completing a task does not shorten the seven-day idle retention policy.
- **A reused sandbox does NOT get a fresh hour, and `setTimeout()` will not give it one (PT-4747).** E2B grants a sandbox's hour at the **start of a session** — the `Sandbox.create` call, or a `POST /sandboxes/{id}/resume` — and a later `sandbox.setTimeout()` does not move that expiry. The call returns success and changes nothing, which is what made this invisible. Measured on **7/7** production sandbox deaths: every one landed 3598.7–3599.4s after that sandbox's last resume, never after its creation, while both the keep-alive `setTimeout(15min)` and the reuse `setTimeout(60min)` issued in between left no trace. So a sandbox reused inside the 10-minute keep-alive window (`status: 'idle_running'`, `wasPaused: false`) used to inherit only the **remainder** of that hour, while `runAgentInSandbox` recorded `sandboxLeaseDeadlineMs = Date.now() + E2B_SANDBOX_TIMEOUT_MS` — so `superviseVmCommand` budgeted a 55-minute slice and scheduled its protective rotation up to an hour **after** E2B had already killed the VM. The agent died mid-run and every following command 404'd — 10 times in the 7 days before the fix, and three at once on 2026-08-25 when three merge follow-ups were each approved into a warm sandbox already ~40 minutes into its hour (that clustering is why it looked like contention between "three simultaneously merging VMs"; it was three independent late reuses, not resource pressure). **The rule now is that a sandbox is only ever handed to a run through a fresh session**: `resumeVmSessionWithFreshLease` pauses a still-running keep-alive sandbox — pausing is what ENDS the running session — and then resumes it, while an already-paused one gets its new session from the resume it needs anyway. Both paths end in the same REST resume, so every run starts on the same predictable 60 minutes and there is no remaining-lease threshold to tune or get wrong. The cost is a few seconds of startup latency on a warm reuse, which is the deliberate trade against a run that starts instantly and then dies. Three things worth knowing: `readSandboxLeaseDeadlineMs` still **measures** the granted lease (`sandbox.getInfo().endAt`, bounded, falling back to the assumed value) so a lost pause race or a change in E2B's semantics surfaces as a shorter budgeted run rather than a sandbox dying under a running agent; a failed pause is deliberately **not** fatal, because the resume is what decides; and a vanished sandbox is recognised (`isE2bSandboxMissing`, keyed on E2B's quoted-id shape rather than a bare "not found", since an agent-exit error carries the model's own narration) so the session is discarded deterministically instead of via the `keep-alive failed — pausing instead` → pause-fails → kill cascade. Note the keep-alive window no longer buys instant reuse, only a warm sandbox to resume into; pausing at teardown instead would remove the reuse-time pause and the idle compute, and is the obvious follow-up.
- **A continued run keeps the agent its session was started with (AT-2240)**: the agent used to be re-resolved from scratch on every dispatch — corroborated tool override, then `users/{uid}.defaultVmAgent`, then the system default — with nothing consulting what the thread was actually running. Changing the Settings → Integrations default therefore switched a _live conversation_ to the other agent, and that switch is **destructive, not cosmetic**: the runner cannot hand a Codex sandbox to Claude (their session stores are not interchangeable), so `runVmJob` kills the sandbox (`discarding incompatible session`), drops the repo checkout and the whole agent conversation, and starts cold — the user asked to continue, read "🖥️ Spinning up Codex…", and lost what the thread was built on. `functions/Assistant/vmThreadAgentContinuity.js` inserts the thread's own agent into the precedence chain, so it is now **corroborated per-run request (AT-2224) > the thread's existing agent > saved default > system default**; `startVmJob` passes the pinned agent where it used to pass only the override. An explicit "use Codex" still switches — that is the deliberate cold restart, and it is the documented way to change a thread's agent. Three deliberate boundaries: (1) **only the agent is pinned** — model family, reasoning effort and the credential route (Gold/BYOK/subscription) are still re-resolved per run, because none of them invalidates a session (the same CLI resumes the same store) and freezing them would mean a thread could never pick up a model upgrade or a re-connected key; (2) **continuation is a state, not a time window** — the pin applies while there is something to continue (a `paused`/`idle_running` sandbox, or a run in flight/queued/blocked-on-interaction whose sandbox this job inherits), and **not** once the sandbox is gone, because the session doc outlives it by up to 7 days and a cold start is by definition a new run; (3) a corroborated **model** request belonging to the other agent ("continue, with opus" on a Codex thread) **steps the pin aside** rather than failing `normalizeAgentModel`. Legacy/partial session docs with no recorded `agent` fall through to the saved default, i.e. the old behaviour. When the pin overrides a changed default the status comment and the tool result both say so — otherwise it reads as the setting being ignored, which is the same complaint in reverse. The module is pure (the caller passes the already-read session doc, via `readVmThreadSession`, which now also feeds the occupancy peek — one read, two decisions).
- **Per-thread job queue (FIFO, one run at a time)**: a thread runs **one** VM job at a time. When `execute_task_in_vm` is dispatched for a thread whose VM is still actively running, the new job is **queued** (not run on a throwaway isolated sandbox) and runs on the **same** sandbox — resuming prior files + conversation — when the current job finishes (whether it succeeded or failed). Jobs run sequentially in dispatch order; the queue is unbounded (each queued job still reserves the 20-Gold base up-front, refunded on cancel/failure). Core logic is in `functions/Assistant/vmThreadQueue.js`, all keyed on the thread's `vmSessions/{projectId}__{objectId}` doc.
    - **State**: the session doc carries a `queue` array of correlationIds (+ `queueLength` for the sweeper's single-field query). Occupancy uses the **existing** runtime-lease fields (`activeLeaseOwner`/`activeLeaseExpiresAt`/`activeCorrelationId`); at dispatch a job takes a short **dispatch lease** (owner `dispatch:<correlationId>`, `VM_DISPATCH_LEASE_MS` = 5 min) that covers the launch→Cloud-Run-boot window until the runner claims its real runtime lease. **Dispatch/queue writes never touch `status`**, so a paused/idle sandbox stays flagged reusable and the incoming runner still resumes it. `claimVmSessionLease` was extended to take over a job's own dispatch lease (matched by `activeCorrelationId`), while still refusing a lease held by any **other** live job.
    - **Dispatch** (`vmJob.js` `startVmJob` → `admitVmJobToThread`): a read-only `isVmThreadOccupied` peek decides whether to **skip the cross-thread concurrency cap** — a same-thread follow-up is queued, not run, so it must not be rejected by the 10-job cap (the cap still rejects a _new_ job on a _different_ thread). The authoritative launch-vs-queue decision is the admission transaction. A queued job's `pendingWebhooks` doc is written with `status: 'queued'` (excluded from `countActiveVmJobsForUser`, so it never blocks other threads), and its status comment reads "⏳ Queued behind the current VM task…".
    - **Drain** (`vmJobRunner.js`): after a run settles — success, normal failure, unhealthy exit, or the pre-run cancel/credential early-returns — the owning runner calls `advanceVmThreadQueue` and, if a job was waiting, `launchQueuedVmJob` (flips `queued`→`pending`, launches its Cloud Run execution). Normal-failure keeps the sandbox (next job resumes it); unhealthy exit clears `sandboxId` but **preserves the queue** (next job starts cold) instead of deleting the session doc.
    - **Gold short-circuit** (`launchQueuedVmJob`): before launching a queued job it reads the user's live Gold balance; if it's below one VM minute's worth (`VM_MIN_GOLD_TO_LAUNCH_QUEUED = VM_GOLD_PER_MINUTE`) it does **not** burn a sandbox on a run that would immediately hit gold-exhaustion — it refunds the job's base reserve, settles it `failed`/`insufficient_gold` (in-app status comment updated), and drains to the next (same user → the rest of the queue cascades to the same outcome). The balance read fails open (a transient read error launches anyway and relies on the in-run gold-exhausted path). A Gold top-up between jobs is respected because the check is a live read at each launch. Note: the short-circuit updates the in-app comment only; it does not re-fan-out to WhatsApp/origin channels (the in-app follower notification still fires).
    - **Race + crash safety**: if a runner ever starts on a thread already held by another live job (the rare dispatch/claim race), it re-queues itself to the **front** and throws `VmThreadBusyError` — a clean deferral (no failure comment, no refund), relaunched by the current owner's drain. `drainStalledVmThreadQueues` (`onSchedule` every 2 min, `index.js`) is the crash backstop: it advances any thread with `queueLength > 0` whose lease has expired (owner died without draining) and relaunches the next job. A launch that fails definitively (or an ambiguous launch the reconciler later fails) also advances the queue so a follow-up is never wedged behind a job that never started.
    - **Cancellation**: cancelling a **queued** job (`cancelAssistantRunSecondGen` in `index.js`) settles it as `cancelled`, refunds the base Gold, removes it from the thread queue, and finalizes its status comment — it never sets `cancel_requested` (no runner would process it).
- **File/artifact return**: the agent saves deliverables to `/home/user/output/` only when the user requested a file or the work produces an artifact; normal chat answers stay in the final message. The host publishes deliverables once as project artifacts and adds their in-app links. The agent returns findings without repeating output paths or attachment listings. Only files whose artifact publication fails are uploaded to `attachments/{commentId}/{file}` as a downloadable chat fallback. These fallback downloads require an attachment token in the comment text (`${ATTACHMENT_TRIGGER}{url}${ATTACHMENT_TRIGGER}{name}${ATTACHMENT_TRIGGER}false`, trigger `EbDsQTD14ahtSR5`); `mediaContext` alone does not render an inline download. Fallback caps: 10 files, 20 MB/file, 40 MB total. Uses the existing `roles/storage.admin` on the firebase-adminsdk SA.
- **Project artifact publication** (`Artifacts/vmArtifactPublisher.js`): a top-level folder in `/home/user/output/` holding an `index.html` is one web bundle, an `index.html` at the top makes the whole output one site, and every other file is its own artifact. Each artifact carries the server-owned `vmOutputKey` (`{objectType}/{objectId}/{outputPath}`), so a later run on the same path updates the existing artifact. Identical file paths and SHA-256 hashes reuse its current version; changed content saves a new version. Only groups the run touched are published, and touched bundles are published whole. Bytes are read while the sandbox is alive (`collectOutputArtifactGroups`, reusing previously collected bytes) and committed after the run. Owner is the requesting user, privacy follows the thread, and links are appended under the answer and to WhatsApp/origin notifications. Publication is best effort: a failure is logged and falls back to chat attachments. Lives in the `vm-job-runner` image and requires a runner rebuild.
- **Gold pricing is hybrid + metered** (`VM_JOB_BASE_GOLD` + `VM_GOLD_PER_MINUTE` + `VM_TOKENS_PER_GOLD` in `vmJob.js`): 20 Gold is charged up-front in `startVmJob` (refunded on failure), then the worker charges 10 Gold per started execution minute plus `round(totalTokens / tokensPerGold)` on completion. Tokens come from the agent's actual reported `usage` (Claude `result` event incl. `total_cost_usd`; Codex `turn.completed`), captured in the stream parser and stored on the `vmJobs` doc. When a personal Claude/Codex subscription is used, `tokenGoldTotal` is forced to zero; the 20 Gold base + 10 Gold per started VM minute still applies. API-billed token usage matches in-app assistant usage (100 tokens/Gold).
- **Cloud Tasks IAM (three grants, NOT auto-configured by `firebase deploy`)** — all on the firebase-adminsdk SA (see gotcha above): (1) `roles/cloudtasks.enqueuer` at the **project level** (queue-scoped was observed not to be honored for firebase-admin's `enqueue()`), (2) `roles/iam.serviceAccountUser` on the SA itself (`actAs`, to mint the task's OIDC token), and (3) `roles/run.invoker` on the **`runvmjob`** Cloud Run service (gen2 lowercases the function name) so Cloud Tasks can invoke the worker. The denials surface one at a time as you fix them (`cloudtasks.tasks.create` → `iam.serviceAccounts.actAs` → `run.invoker`). Run `functions/e2b-template/grant-enqueuer.sh <projectId>` once per environment after deploy; it auto-detects the SA and applies all three.
- **E2B SDK is pinned to `e2b@^1.x`** in `functions/package.json` — v2 cannot load under the CommonJS functions runtime (`ERR_REQUIRE_ESM` from its CJS bundle; `Dynamic require of node:url` from its ESM bundle under raw `node`). The Docker-free v2 **template build** tooling lives isolated in `functions/e2b-template/` (its own ESM package, run via `tsx`) and is excluded from the functions deploy via `firebase.json` `functions.ignore`.
- **Templates and CLI versions**: the worker always starts from E2B's managed `claude` or `codex` template, queries the selected package's npm `latest` version, and validates the active CLI before every run (including resumed sandboxes). Current CLIs are reused without calling `npm install`. For an install or upgrade, the runner takes a per-agent `flock`, temporarily moves only `/home/user/.local/bin/{claude,codex}` out of npm's link path, installs the exact resolved version, validates it, and restores the prior launcher if npm or validation fails. This avoids the managed-template `EEXIST` collision without `npm --force`. Bootstrap output is retained in bounded buffers; failures include sanitized npm stdout and stderr in logs and the job result. The legacy `functions/e2b-template` builder remains in the repository for reference but is not selected by the runner.
- Secrets `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `VM_PROXY_SIGNING_SECRET` are read via `getEnvFunctions()` (so they come from the `GOOGLE_FUNCTIONS_ENV_DEV` / `_PROD` GitLab variables that build `env_functions.json` in CI — add new keys into those JSON blobs, not as standalone CI variables).
- **LLM key never enters the sandbox (proxy)**: the real Anthropic/OpenAI key is NOT injected into the VM. The worker mints a short-lived, per-job, HMAC-signed token (`functions/Assistant/vmLlmProxy.js`, `mintProxyToken`) and points the agent at the `vmLlmProxy` `onRequest` function, passing the token in place of the key. Claude uses `ANTHROPIC_BASE_URL=<proxy>/anthropic`. Codex is configured per command with an explicit custom Responses provider whose `base_url` is `<proxy>/openai/v1` and whose `supports_websockets=false`; this is required because current Codex CLIs may otherwise open `wss://api.openai.com/v1/responses`, bypass the HTTP-only proxy, and send the proxy token to OpenAI. `OPENAI_BASE_URL` remains only as compatibility for older Codex CLIs. `vmLlmProxy` verifies the token (signature + expiry + agent-match), checks that the job can continue, swaps in the real key server-side, streams the upstream response, and accounts token usage. This means a compromised/prompt-injected agent (which runs with `--dangerously-skip-permissions` + internet) can at most leak a per-job token usable only against the proxy for its short TTL — not the permanent platform key. **`VM_PROXY_SIGNING_SECRET` is required**; if it or the upstream key/base URL is unavailable, VM execution fails closed. Rotating the secret instantly revokes all outstanding tokens. The proxy base URL defaults to the deployed function URL; override with `VM_LLM_PROXY_BASE_URL` if needed.
- **GitLab / GitHub coding flow (clone → code → optional Merge/Pull Request)**: a `prototype` VM task can run inside a checkout of the project's connected GitLab **or** GitHub repo and open an MR/PR only when it actually changed repository files. Wiring is per-provider but symmetric: per-project repo config (`gitlabRepoUrl`/`gitlabBaseBranch`/`gitlabHost`, or `githubRepoUrl`/`githubBaseBranch`/`githubHost`/`githubApiBase`) lives on the `projects/{projectId}` doc (non-secret, member-readable); the **per-user** token lives at `users/{uid}/private/{provider}Auth_{projectId}` (`gitlabAuth_…` / `githubAuth_…`, owner+server read only — never on the project doc). The `connect{Gitlab,Github}Repo` / `disconnect{Gitlab,Github}Repo` callables (`functions/Gitlab/gitlabConnect.js`, `functions/Github/githubConnect.js`, registered in `index.js`) validate the token + repo against the provider REST API and persist it; the UI is `components/ProjectDetailedView/ProjectProperties/ConnectGitLab/` + `ConnectGitHub/` (mirror ConnectGmail, but a simple paste-token form). In `vmJobRunner.js`, `loadRepoContext()` reads the repo + the **requesting user's** token (GitHub preferred if both are connected), and `setupGitRepo()` clones (fresh) or fetches (resume) into `/home/user/repo`. The runner does **not** install repository dependencies before starting the agent; the agent installs them lazily with the repository's package manager only when the requested change or necessary validation requires them. `buildAgentPrompt()` branches on provider: **GitLab** → branch/commit/push with **push options** (`-o merge_request.create …`, no `glab`/API needed); **GitHub** → push then `gh pr create` (gh baked into the E2B template; falls back to the REST API via curl). The E2B sandbox is created/connected with internet access enabled, and Codex is invoked with `sandbox_workspace_write.network_access=true` because Codex has its own inner command sandbox; GitHub is normal outbound HTTPS traffic, not a special E2B permission, though transient DNS/network errors should be retried. The agent returns the MR/PR URL in its final message when one is opened, or explains that no MR/PR was opened because no code change was needed. For task threads, the newest VM run that returns an MR/PR becomes the canonical `vmMergeRequest`; thread-run ordering plus transactional status writes prevent delayed older runs or refreshes from restoring a previous link. **Security**: the token is injected ONLY as a per-command env var (`GIT_TOKEN`, plus `GH_TOKEN`/`GITHUB_TOKEN` for GitHub) and a git credential helper that resolves `$GIT_TOKEN` at push time (username `oauth2` for GitLab, `x-access-token` for GitHub) — never written to `.git/config`, `prompt.txt`, logs, or the paused-session snapshot. Recommend users supply a repo-scoped token (GitLab **Project Access Token** `api` + `write_repository`, Developer+; GitHub **fine-grained PAT** with Contents + Pull requests read/write) and keep the base branch protected so the agent can only open MRs/PRs, not push to it or merge (in this repository `master` is protected since 2026-11-08: Maintainers only, no force push; before that it was not, whatever this note assumed).
- **Codex Git metadata and sandboxing**: Codex's `workspace-write` mode deliberately protects `.git` recursively even when the checkout is writable, so branch/ref/index updates against a conventional checkout fail with `cannot lock ref`. This is an inner Codex policy, not an E2B mount, Unix ownership, or worktree-permission problem. `setupGitRepo()` therefore moves mutable metadata to `/home/user/git-metadata/repo`, injects `GIT_DIR` + `GIT_WORK_TREE` into setup and agent commands, and grants only `/home/user/git-metadata` as an additional Codex `writable_root`. Resumed pre-fix sessions with `/home/user/repo/.git` are migrated automatically. Do not replace this with `danger-full-access` or try to add `.git` itself as a writable root: the former broadens the sandbox unnecessarily and the latter remains blocked by Codex's protected-path policy.
- **Google Cloud read access (clone the GitHub/GitLab connect pattern, but for GCP)**: any project member can connect **their own** Google Cloud project so their VM tasks can **read** its Firestore + Cloud Logging (e.g. inspect `goldStats`, tail Cloud Functions logs). It is per-user and self-limiting — you can only grant read access to a project you already have a service-account key for. The secret lives at `users/{uid}/private/gcpAuth_{projectId}` (owner+server read only; `serviceAccountKey` = the pasted SA JSON, plus `gcpProjectId`/`clientEmail`/`capabilities`); **nothing GCP-related is written to the project doc** (unlike git — the connection is purely per-user, so the per-user doc is self-contained). `connectGcpProject`/`disconnectGcpProject` (`functions/Gcp/gcpConnect.js`, registered in `index.js`) validate the key by minting a token from it and probing Firestore `:listCollectionIds` + Logging `entries:list`, storing which reads succeeded as `capabilities` and rejecting a key that can read neither. UI mirrors ConnectGitHub: `components/ProjectDetailedView/ProjectProperties/ConnectGCP/` (a paste-the-SA-JSON form). **The raw SA key never enters the sandbox.** In `vmJobRunner.js`, `loadGcpContext()` runs for **every** task type (not just `prototype`), reads the requesting user's key, and — because we hold the private key — mints a **short-lived OAuth access token** directly (`mintGcpAccessToken`: JWT→token exchange with scopes `datastore` + `logging.read`; no `iam.serviceAccountTokenCreator` / no Alldone-side IAM grant needed). **Scope gotcha**: the Firestore API rejects `cloud-platform.read-only` (403 "insufficient authentication scopes") and there is no read-only Firestore/Datastore scope, so the read/write `datastore` scope is used and **Firestore read-only is enforced by the SA's IAM role** (`datastore.viewer`), not the scope; Logging keeps its read-only `logging.read` scope. `buildGcpEnv()` injects it per-command as `GCP_ACCESS_TOKEN` (+ `CLOUDSDK_AUTH_ACCESS_TOKEN`, `GOOGLE_CLOUD_PROJECT`) merged into `runEnvs` alongside the git env — minted fresh each run, never written to disk or the paused snapshot. `buildAgentPrompt()` adds a "Connected Google Cloud project (read-only)" section pointing the agent at the Firestore/Logging **REST APIs via curl** (no `gcloud` in the E2B template by default; functions logs = filter `resource.type="cloud_run_revision"` for gen2). **Trust model** (chosen trade-off vs. the `vmLlmProxy` approach): the token is read-only (Firestore via the SA's viewer role, Logging via both scope and role), ~1h TTL, and only reaches the user's own project, so a prompt-injected agent can at most do read-only calls the user already authorized for the token's lifetime — accepted in exchange for far less code than a full proxy. Read-only ultimately rests on the SA's IAM roles, so users MUST connect a read-only SA (recommend `datastore.viewer` + `logging.viewer`, or `roles/viewer`). No Gold changes — GCP reads happen inside the run and are billed via the existing LLM-token metering. Optional future hardening: KMS-encrypt the stored SA key at rest (higher-value than a repo token), or Workload Identity Federation to avoid storing a long-lived key at all.

### Per-project golden VM template (skip the dependency install)

- **Problem it solves**: a cold `prototype` VM job (new thread / contextless trigger) otherwise starts from E2B's bare managed template and re-clones + re-installs the connected repo's dependencies every run. The **golden** is one warm E2B snapshot per project that already has the repo checked out with `node_modules` + the package-manager cache baked in. Cold repo-backed jobs seed their sandbox from it, so the expensive install is skipped. It only applies to jobs with a **connected repo** (GitHub/GitLab) — a non-repo task has no deps to bake and always uses the managed base.
- **Mechanism (all in the pinned `e2b@1.x` runtime, no v2 build tooling)**: the golden is an E2B **snapshot**, created via the REST endpoint `POST https://api.e2b.dev/sandboxes/{id}/snapshots` (a `fetch` shaped exactly like `pauseE2bSandbox`) with a stable `name` = `alldone-golden-<projectId>` — reusing the name assigns a new build under the same snapshot template. The returned `snapshotID` is used directly in `Sandbox.create(snapshotID)`, which **forks a fresh VM per create**, so concurrency is free (no "fork a paused sandbox" problem). Core logic lives in `functions/Assistant/vmGolden.js`.
- **Cold-start seeding** (`vmJobRunner.js`, the `if (!sandbox)` fresh-create branch): `resolveGoldenTemplate()` returns the snapshot when `project.vmGolden.status === 'ready'`; the create uses it instead of the managed template, with a **try/catch fallback** to the managed template if the snapshot is unusable (deleted/expired). The per-thread session is still recorded under the managed `template` string, so resume matching stays stable across golden rebuilds (a golden-seeded session sandbox resumes normally — resume connects by `sandboxId`). `setupGitRepo` is already idempotent (clone-if-absent / fetch-if-present) and `node_modules` sits in the work-tree excluded from git, so a seeded sandbox just fetches and keeps its baked modules — no change to `setupGitRepo` was needed.
- **Refresh is event-driven, never on a clock** — mirrors how you only reinstall locally when the lockfile changes. Two triggers, both coalesced by a CAS debounce lease on `projects/{projectId}.vmGolden` (`rebuildState:'building'` + `rebuildLeaseExpiresAt` + owner, same shape as `claimVmJobLease`): **#2 self-healing** — after `setupGitRepo`, the cold job hashes the repo lockfile and calls `maybeTriggerGoldenRebuild()`; if it differs from `vmGolden.lockfileHash` (or no golden exists) it claims the lease and enqueues **exactly one** rebuild. The job itself is never blocked (it runs on whatever it has; the agent reconciles deps with an incremental `npm install`); the **next** cold job lands on the fresh golden. **#1 on-demand** — the `rebuildProjectVmGolden` callable (`functions/Assistant/vmGoldenRebuild.js`) claims the same lease and enqueues. A "Rebuild VM environment" row is in project settings (`components/ProjectDetailedView/ProjectProperties/VmGolden/VmGoldenProperty.js`, shown only when a repo is connected; live status via the `vmGolden` field added to `mapProjectData`).
- **The build worker** (`runGoldenBuild`, `onTaskDispatched` in `index.js`, 30-min ceiling): create sandbox from the managed base → `setupGitRepo` (reused from the runner) → detect package manager + install (`npm ci`/`yarn`/`pnpm`, or a per-project `vmGolden.setupCommand` override — that override is how a repo carries a bespoke post-install step such as alldone_app's `replacement_node_modules/quill` swap) → hash the lockfile → `POST …/snapshots` → write `projects/{projectId}.vmGolden` → `Sandbox.kill`. It runs **no agent and spends no Gold** — it is platform infra. Only the current lease owner writes the result; a superseded build no-ops. On failure the lease is released preserving any prior snapshot (a failed rebuild leaves the old golden usable). The golden is built agent-agnostic from the `claude` managed base; a Codex job seeding from it still installs the Codex CLI on top via `ensureAgentCliAvailable` exactly as on a cold managed start (no regression).
- **Agent prompt**: `buildAgentPrompt` now tells the agent deps may be pre-installed at `/home/user/repo/node_modules`; skip install if the lockfile is unchanged, and when installing with modules already present use the **incremental** installer (`npm install`) — **never `npm ci`** (it deletes `node_modules` and discards the baked cache).
- **Storage & cleanup**: golden snapshots live in the **E2B team account** (tied to `E2B_API_KEY`) as persistent template images — one named `alldone-golden-<projectId>` per project, each rebuild a new build under that name. They persist indefinitely and cost E2B storage, so `cleanupUnusedVmGoldenSnapshots` (`onSchedule` daily, `index.js`) deletes any whose `vmGolden.lastUsedAt` is older than `GOLDEN_UNUSED_TTL_MS` (30 days) via `DELETE /templates/{snapshotId}` and resets the project pointer (the next cold job rebuilds). `lastUsedAt` is stamped by `touchGoldenUsage` whenever a cold job actually seeds from the golden (and initialized at build time so the cleanup query always matches a ready golden). A cold job that finds its golden snapshot **unusable** at create time force-triggers a rebuild (`maybeTriggerGoldenRebuild({ force: true })`).
- **Deploy**: `firebase deploy --only functions:runGoldenBuild,functions:rebuildProjectVmGolden,functions:cleanupUnusedVmGoldenSnapshots` (use the repo-pinned `firebase-tools@13.29.3` — newer CLIs reject pre-existing 3600s scheduled-function timeouts elsewhere in `index.js`); **also rebuild the `vm-job-runner` Cloud Run Job** because the golden **seeding + drift + prompt** changes live in `vmJobRunner.js`, which runs in that image, not the Functions runtime. **CI now does this automatically**: `deploy:cloud:runner:{staging,production}` in `.gitlab-ci.yml` runs `deploy.sh` with `CI_MODE=1` (skips one-time project setup) on any `functions/**` change, authenticating as the `firebase-adminsdk` SA — which therefore also needs `roles/cloudbuild.builds.editor` + `roles/run.developer` + `roles/artifactregistry.writer` (granted alongside the golden Cloud Tasks roles). For a manual rebuild: `functions/Assistant/cloud-run-job/deploy.sh <projectId>`. Then run `functions/Assistant/grant-golden-builder-task-worker.sh <projectId>` once per env (grants the three Cloud Tasks roles to the **firebase-adminsdk SA** — enqueuer at project level, self `actAs`, `run.invoker` on the `rungoldenbuild` service; IAM propagates in ~7 min). **Gotcha — staging has TWO `firebase-adminsdk` SAs** (`-5wi3r` and `-9idaq`); the script auto-picks the first alphabetically, which may not be the cert SA the runtime authenticates as, so grant to **both** (`grant-golden-builder-task-worker.sh <projectId> <sa-email>` for the second). **The golden state is server-only (security audit 2026-11)**: the pointer, lease, lockfile hash and `setupCommand` live in `vmGoldens/{projectId}` (no client rule, default deny); `projects/{projectId}.vmGolden` is only a display mirror (`status`, `builtAt`, `hasSnapshot`, … — `buildGoldenMirrorUpdate`) that nothing on the server reads, and the `projects` update rule refuses client changes to it. Every member's cold coding job boots from the golden with that member's credentials and the build `eval`s `setupCommand`, so a member-writable copy was code execution in other members' sandboxes. Wherever this section says `projects/{projectId}.vmGolden` below, read `vmGoldens/{projectId}`. `setupCommand` is administered with the Admin SDK only; `migration/moveVmGoldenSetupCommands.js` lists the old project-doc commands for review and moves the reviewed ones (`--only=… --execute`).
- **Caveat**: E2B snapshot persistence is beta ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)). **Validation checklist (run against your E2B account — cannot be unit-tested):** (1) trigger a build (connect a repo, run a VM task or press Rebuild) and confirm `projects/{projectId}.vmGolden.status` flips `building → ready` with a `snapshotId`; (2) run a fresh cold job and confirm the log line `creating sandbox … fromGolden:true` and that `node_modules` is present without an install; (3) change the lockfile and confirm the next cold job enqueues a rebuild while still running; (4) delete the snapshot in the E2B dashboard and confirm a cold job falls back to the managed template and re-enqueues a build.

**VM dispatch and dependent steps (AT-2896):** `execute_task_in_vm` starts asynchronous work;
`continue_in_object_id` queues a new job on the existing sandbox. `vmDispatchGuard.js` reuses one
dispatch per host thread and user request, including model-authored retries after completion. The
state belongs to the invocation, so a later user request can still start a follow-up. `get_vm_job`
comes with the VM capability and waits at most 30 seconds without starting work; it checks job
ownership and current thread access. The runner stores versioned artifact references in
`pendingWebhooks.resultArtifacts`. Gmail draft attachment items accept `artifactId`, `projectId`,
`versionNumber` and optional `path`, in place of base64; `resolveArtifactDraftAttachments` checks
project membership/privacy, reads that immutable version and enforces the 10 MB limit. Binary bytes
stay on the server. After waiting for a settled in-thread VM, the assistant's final dependent
result raises a notification normally instead of being treated as a handoff acknowledgement.
`handoff_message` is saved before the VM starts as a finished Anna introduction. Waiting for a
settled result opens a separate Anna follow-up comment, timestamped after the VM answer; progress
and result text must not overwrite the introduction. The dispatch scope stays stable across these
comments. Published output files appear only through their artifact links; legacy chat attachments
are a fallback for publication failures. Matching paths and SHA-256 hashes reuse the current
artifact version, avoiding a second upload/version for unchanged output. VM agents return findings
without repeating output paths, attachment listings or artifact links that the host adds itself.
Ship both the Functions package (assistant entry points and MCP) and the rebuilt `vm-job-runner`.

### Assistant heartbeat scheduler

- Heartbeats are registered per assistant/user in the server-only `assistantHeartbeatSchedules` collection. `checkAssistantHeartbeats` only dispatches schedules due in the next five minutes; `runAssistantHeartbeat` performs one at-most-once occurrence through Cloud Tasks with five concurrent workers.
- Run `node migration/backfillAssistantHeartbeatSchedules.js --firebase-project-id=<project> --execute` after deploying the worker and indexes. Without `--execute` the script is a dry run.
- Cloud Tasks IAM must be granted to the **firebase-adminsdk SA** after deploying `runAssistantHeartbeat`. Run `functions/Assistant/grant-heartbeat-task-worker.sh <projectId>`; it grants project-level enqueue, self `actAs`, and `run.invoker` on the worker.
- Rollback requires pausing or purging the `runassistantheartbeat` task queue before restoring the legacy scanner. Legacy assistant heartbeat status maps are intentionally retained.
- **A heartbeat runs as a member only after that member confirmed it (security audit NV-17).** A heartbeat runs unattended with the member's identity, Gold and connected accounts (`search_gmail` reads their mailbox), while its prompt, tools and instructions sit on the shared assistant document that every member may edit. `functions/Assistant/heartbeatOptIn.js` therefore requires `users/{uid}.heartbeatOptIns["<projectId>__<assistantId>"].configHash` to equal the hash of the assistant's current heartbeat prompt, `allowedTools`, `instructions` and `mcpServers`. Chance, interval, awake window, model and WhatsApp delivery are not hashed. `buildHeartbeatScheduleData`, the worker and the legacy scanner all check it, so any other member's change to one of those fields stops the heartbeat for everyone who confirmed the old version. Members confirm, re-confirm or revoke through the `assistantHeartbeatOptIn` callable (row "Run heartbeat for me" in the heartbeat settings; the client never computes the hash). The client calls `refresh` after the member's own edit to instructions, heartbeat prompt or tools, which re-confirms only for a member who had already confirmed. The server confirms for a project's **only** member at the moments nobody else can have written the configuration: assistant created, hashed field changed, project created (`confirmHeartbeatsForSoleMember`, before the schedule sync). Being alone is not trust in itself: someone who changes the prompt and then leaves must not have it run as the member left behind. MCP-server changes made through the server-side connect flow need a fresh confirmation in shared projects. A heartbeat topic (`Heartbeat<date><uid>`) is now `isPublicFor: [uid]`, and an existing project-visible one is made private on reuse. The WhatsApp daily topic stays project-visible by design. One-time migration: `node migration/confirmAssistantHeartbeats.js --firebase-project-id=<project>` (dry run; `--execute`). Run it right before and again right after the functions deploy. The default `--scope=owner` confirms the only member of a one-member project and the assistant's `creatorId` in shared projects; `--scope=all` keeps today's fan-out.

### Code Style

- Prettier 3 enforces formatting (4-space indent, single quotes, trailing commas);
  `.prettierignore` deliberately shields email/invoice HTML templates, the build-injected
  index.html files, and the quill-derived editor CSS — do not format those
- PascalCase for components (`ProjectDetailedView.js`)
- camelCase for hooks/helpers (`useComments.js`, `taskActions.js`)
- Husky 9 (`.husky/pre-commit`) runs `pretty-quick --staged` on commit

### Testing

- Jest 30 on Node 22, jsdom environment (pinned explicitly in the config — jest 25's
  default, which suites depend on), babel-jest through the root `babel.config.js`
- Tests in `__tests__/` mirror component structure; newer tests sit next to their code
- Firebase mocks in `__mocks__/`
- Maintain 10% coverage thresholds
- **Transforms are allowlisted, not blanket** (Stage 5): `transformIgnorePatterns` in
  package.json names the only node_modules that go through babel — the ESM chain
  (`quill*`, `parchment`, `react-quill-new`, `lodash-es`, `lib0`, `y-*`, `yjs`) and the
  RN-era untranspiled dialect (`react-native*`, `expo*`, `@react-native*`…). A new dep
  that throws `SyntaxError: Unexpected token 'export'` in tests belongs in that allowlist.
  The old transform-everything hack died with jest 30 (jest loads its own runner through
  the transforming runtime). Root `babel.config.js` is an explicit web config on modern
  @babel/core mirroring web-bundler's shipped semantics — sloppy-mode CJS, block-scoping
  to var, set-semantics class fields, flow without pragma, classic JSX — plus
  transform-runtime with the real runtime version so `import * as X` namespace objects are
  shared across modules (suites that mutate a mock through a namespace import rely on it).
- **`setImmediate` in tests is guarded against outliving its file** (`ci/jestPolyfills.js`).
  jest's jsdom environment has no `setImmediate`, so the polyfill hands tests Node's real one —
  which, unlike jsdom's own timers, is not cancelled when a file's environment is torn down.
  React's scheduler prefers it, so a passive effect queued at the end of a test could run after
  jsdom was gone on a busy runner, throw without `window`, and crash the whole `--runInBand`
  `test:web:full` run with "The `document` global was defined when React was initialized, but is
  not defined anymore" — in whichever unrelated file ran next, which is why no two occurrences
  (seven failed master pipelines, August–September 2026) pointed at the same suite. The
  `afterEach` `act()` flush in `ci/jestSetup.js` cannot catch it: `act` drains only work queued
  inside it. The guard drops an immediate whose environment is gone, the way jsdom drops its
  timers. A retry always passed, which is what made it look like a flaky test. Pinned by
  `__tests__/JestPolyfills.test.js`.
- **Functions suites**: `npx jest --config ci/jest.functions.config.js` (same Node 22).
  That config skips Babel for `functions/node_modules` (modern CJS runs natively) and
  resolves exports maps with the **node** conditions — under jsdom's default browser
  condition, jest 30 would resolve e.g. jwks-rsa's `jose` to its browser ESM build and
  fail at require time. CI's `test:web:changed` excludes `functions/` entirely, so the
  functions suite is a local check — drift CAN land on master unnoticed, and it does.
  **Run `npx jest --config ci/jest.functions.config.js functions` before pushing anything
  under `functions/`**; as of 2026-09-01 it is fully green (236 suites / 3247 tests), so a
  failure there is yours. The drift is rarely a broken behaviour — it is a stale test
  DOUBLE. `vmTargetTask.test.js` sat red for four days because "Harden Firestore access
  rollout" (`6009eabd85`) moved project membership from the user document's `projectIds`
  to the project document's `userIds`, and the double only seeded the user side; two of
  its cases then went on passing while asserting nothing, because everything failed at the
  project gate before reaching the check under test. When a double stops matching what the
  code reads, fix the double AND confirm the still-green cases are not green for the wrong
  reason. Three
  web-located "bridge" suites that require functions code
  (`__tests__/TwilioWhatsAppService.test.js`, `__tests__/Chats/copyChatToOtherProject.test.js`,
  `__tests__/Feeds/copyInnerFeedsToOtherProject.test.js`) run in the functions config
  instead (`BRIDGE_SUITES` in `ci/jest.functions.config.js`).
- **firebase-admin is pinned to ^13 — do NOT bump to 14 casually.** v14's top-level
  `require('firebase-admin')` export is only the `app` module: the entire legacy namespace
  API (`admin.firestore()`, `admin.auth()`, `admin.messaging()`, `admin.database()`,
  `admin.storage()`, `admin.credential.cert`, `admin.apps`) is gone, and this codebase has
  hundreds of those call sites (an attempted v14 deploy failed at source analysis on
  `admin.credential.cert`; tests did not catch it because they mock `firebase-admin`).
  Moving to 14 requires the full modular migration (`getFirestore()` etc.) as its own
  project. Convention going forward regardless: statics come from the modular subpath —
  `const { FieldValue, Timestamp } = require('firebase-admin/firestore')` — and tests that
  stub them must mock `'firebase-admin/firestore'`, not just `'firebase-admin'`.

### Verifying Code Changes

To verify syntax and compilation without running the full test suite, compile through
the shipped pipeline:

```bash
# Webpack 5 production build — catches syntax errors and unresolvable imports
npm run build-web-webpack
```

A clean compile ends with `webpack compiled with 3 warnings` (the three known RNGH
DrawerLayoutAndroid warnings are expected; anything else is a real finding). Remember the
Stage 0 lesson: a clean compile proves little about runtime — boot the artifact in a
browser before trusting a bigger change.

### Environment Configuration

- `.env` - Current environment variables (local development only)
- `envs/env.develop`, `envs/env.master` - Environment-specific configs
- `env_functions.json`, `env_functions_dev.json`, `env_functions_master.json` - Function configs
- Service accounts: `serviceAccountKey.json`, `serv_account_key_develop.json`, `serv_account_key_master.json`
- Cloudflare worker deployment should be run from `cloudflare/email-worker/` under the patched Node 22 release selected by `nvm use`.

### CI/CD & Deployment

- **GitLab CI/CD**: All deployments are handled via GitLab pipelines (`.gitlab-ci.yml`)
- **Environment secrets**: Stored in GitLab CI/CD variables, not in the repository
- **Branches**: `develop` deploys to staging, `master` deploys to production.
- **Staging deploys only from `develop` (2026-11-09).** `develop` is a protected branch
  (push and merge Maintainers only, no force push), and the staging secrets
  (`GOOGLE_FUNCTIONS_ENV_DEV`, `GOOGLE_SERVICE_ACCOUNT_DEVELOP`,
  `FIREBASE_DEPLOY_SA_STAGING`) are protected variables like their production
  counterparts, so feature-branch pipelines cannot read them. They were readable by every
  branch pipeline before, including those of the VM agents' project token, and the staging
  functions blob shares many values with production (among them the Typesense admin key
  for the search collections both environments use). The manual feature-branch staging
  jobs (`deploy:web-webpack-preview`, `deploy:web-staging-live` and the manual variants of
  `deploy:cloud:functions:staging` / `deploy:cloud:runner:staging`) are gone with it.
  To QA a branch on https://alldonestaging.web.app, a Maintainer brings it to `develop`
  (fast-forward `develop` to master first if it has fallen behind); the develop pipeline
  deploys web, functions and runner. Staging live is last-writer-wins, so say so if others
  are testing. Preview channels are gone too; they never supported Google sign-in anyway
  (their random origin is not an authorized JavaScript origin of the OAuth client).
  `__tests__/CiDeployCredentials.test.js` fails the build if a job reading a staging secret
  can run anywhere but `develop`.
- **Build process**: `ci/replace-envs.sh` injects environment variables during build
- **Firebase projects**: `alldonestaging` (staging) and `alldonealeph` (production)
- **`resource_group` serializes deploys but does NOT order them — production deploy jobs
  run `ci/assertNewestCommit.sh` first.** `workflow.auto_cancel.on_new_commit: interruptible`
  deliberately never cancels a deploy (`interruptible: false`), so a superseded pipeline keeps
  a live deploy job queued; `resource_group` then only guarantees it runs _alone_, not _first_.
  An older pipeline that runs last wins, and every deploy here is last-writer-wins over the
  whole environment. This is not theoretical: `firebase deploy --only functions --force` treats
  the deployed source as the desired state and **prunes functions absent from it**, so on
  2026-08-10 a stale master pipeline deleted two just-shipped callables
  (`getVmAgentModelOptions`, `setDefaultVmAgentModel`) and reverted `getVmAgentSettings` to
  pre-feature code seventeen minutes after a newer pipeline created them — with every Cloud
  audit entry reading `ok`, because nothing failed from Firebase's point of view. The guard
  compares `CI_COMMIT_SHA` against the live branch tip **at deploy time** (not pipeline start —
  a newer commit routinely lands while an earlier stage is still building) and exits `75` when
  superseded. Each guarded job declares `allow_failure: exit_codes: 75`, so a correctly-skipped
  deploy is visible in the pipeline graph without turning the pipeline red — it deliberately
  does not exit 0, because a deploy job reporting success without deploying is the same trap as
  the old `xargs -r` no-op in `test:web:changed`. It fails **closed** (exit 1) when the tip
  cannot be read: a skipped deploy is fixed by retrying the job, an out-of-order one silently
  reverts production. `ALLOW_STALE_DEPLOY=1` forces a deliberate rollback through.
  `__tests__/CiDeployGuard.test.js` fails the build if a job that deploys on the default branch
  lacks the guard, the allowed exit code, `interruptible: false` or a `resource_group`, so a new
  production deploy job cannot quietly opt out.
- **Production deploy scope comes from what SHIPPED, not from what the push touched
  (`ci/deployScope.sh`).** Scoping a deploy with `rules: changes:` asks "did _this_ push
  touch `functions/`", which stops being the right question the moment the guard above starts
  skipping superseded pipelines — the two combine into a hole that loses a release and closes
  silently. Push A touches only `functions/`; push B lands three minutes later touching only
  `components/`; A's pipeline is superseded and skips its functions deploy, and B's pipeline
  **never contained a functions deploy job at all**, because B's own diff has no `functions/`
  path. Nobody deploys A. Every job in both pipelines is green and the only symptom is
  production running one merge behind. Master takes ~11 pushes/day with a median gap of 26
  minutes and **28% landing within 10 minutes of another**, so this is the ordinary case: 45
  days of history contain ~34 functions-side and ~30 web-side occurrences. Each target now
  keeps a marker — a git tag `deployed/<target>` moved **only after a successful deploy** — and
  its scope uses `git diff <marker> <HEAD>` against `ci/deploy-scope/<target>.paths`
  (Functions use the dependency graph described below). That is
  inherently catch-up: whatever a skipped pipeline left behind is still missing from the
  marker, so the next pipeline ships it alongside its own change, and a target whose paths
  have not moved is still skipped, so the steady-state deploy count is unchanged. `compute`
  runs once per pipeline (`deploy_scope`) and publishes `deploy-scope.env`, so a web build, its
  tests and its deploy can never disagree about whether they are shipping — which is why
  `build_web_production` and `test:web:full` are no longer `changes:`-scoped on master either
  (they feed `deploy:web` through `needs`, so being absent from the catch-up pipeline would
  make `needs` unresolvable). Exit `76` means "already up to date" and the CI wrapper exits successfully;
  only superseded exit `75` is an allowed warning. **Every uncertain path resolves to deploying**, never to
  skipping: a redundant deploy is visible and cheap, a silently skipped one ships nothing.
  Note a job with an explicit `needs` list loses the default "artifacts from all earlier
  stages", so it must name `deploy_scope` or it silently falls back to deploying always.
  Markers are pushed with `CI_JOB_TOKEN` ("Allow Git push requests to the repository" is on),
  `DEPLOY_MARKER_TOKEN` remaining an explicit override. Tag pushes cannot trigger pipelines
  here — the `workflow` rules only admit pipelines that have `$CI_COMMIT_BRANCH`. Pinned by
  `__tests__/CiDeployScope.test.js`, which also fails the build if
  `ci/deploy-scope/web-production.paths` drifts from the `*web-relevant-paths` anchor.
- **A production marker is only believed when a default-branch pipeline signed it
  (security audit 2026-11, NV-01).** A marker can only make a deploy smaller, so a forged
  one holds back a reviewed fix: `deployed/firestore-rules-production` pointed at any
  commit with master's rules (the MR source commit is one) made the rules release report
  "already deployed", and an old `deployed/github-mirror` would have replayed pre-cutoff
  history onto the public mirror. The tags cannot be GitLab-protected, because a protected
  tag can never be moved again and CI moves them on every deploy, and anyone with Developer
  access (the VM-agent bot token included) or a branch job token can push them. So
  `record` writes an annotated tag whose message (target, commit, ref, pipeline, job) is
  HMAC-SHA256-signed with the protected, masked variable `DEPLOY_MARKER_SIGNING_KEY`, and
  only from a protected default-branch pipeline; `verified_marker` rejects a lightweight
  tag, a bad signature, another target's marker and a commit that is not an ancestor of the
  one under test (deepening the shallow clone as needed). Changes are read from every commit
  in `marker..HEAD` as well as the tree diff, so replaying an older genuine marker after a
  revert still deploys (for Functions those files go to the selector as `rangeChanged`). A
  rejected or missing production marker means **deploy**; the old push-range fallback is
  gone for production, since deleting a tag would have reopened the hole. Without the key,
  `compute` and `functions-plan` fail on master naming the variable, instead of deploying
  everything (Functions in full) on every push. `functions-staging*` markers stay unsigned:
  feature branches write them and staging is branch-reachable anyway. The first master
  pipeline after this shipped found only unsigned markers and deployed every target once.
  `ci/github-push.sh` additionally appends only when the cutoff commit is an ancestor of
  the last mirrored one and the mirror tip carries that commit's tree; otherwise it rebuilds.
  `fetch_marker` no longer uses `--depth=1` in a complete clone, where it grafted a shallow
  boundary at the marker and cut off the mirror's cutoff commit. Pinned by
  `__tests__/CiDeployMarkers.test.js` (real git: replay, forgery, copied and non-ancestor
  markers, shallow clones, HMAC tools agreeing) and the marker case in
  `__tests__/CiFunctionSelection.test.js`.
- **Firebase deploys use one service account per environment, never a login token
  (security audit 2026-11, NV-32).** Everything used to authenticate with one
  `firebase login:ci` token (`GOOGLE_FIREBASE_DEPLOY_TOKEN`) that could deploy both projects
  and that every feature-branch pipeline could read. Every job that runs firebase-tools now sources
  `ci/useFirebaseDeployCredentials.sh production|staging`, which sets
  `GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_DEPLOY_PROJECT` and unsets
  `FIREBASE_TOKEN` / `GOOGLE_FIREBASE_DEPLOY_TOKEN` (firebase-tools prefers a token over
  ADC). `FIREBASE_DEPLOY_SA_PROD` (protected, File variable) is a key for a deploy account
  with roles on `alldonealeph` only, and the helper also refuses it outside a protected
  default-branch pipeline; `FIREBASE_DEPLOY_SA_STAGING` (protected since 2026-11-09, see above) is a key
  for an account with roles on `alldonestaging` only. There is no fallback to the old token: a
  missing variable fails the job with its name. The helper checks the key's `project_id`
  and `client_email` domain, so a production key in the staging variable is refused.
  `__tests__/CiDeployCredentials.test.js` fails the build if a job running firebase-tools
  on a non-default branch selects production (or vice versa), if `--token` or the old
  variable comes back, or if a job other than `deploy:cloud:runner:production` touches
  `GOOGLE_SERVICE_ACCOUNT_MASTER`. The runner jobs still authenticate gcloud with the
  runtime keys (`GOOGLE_SERVICE_ACCOUNT_MASTER` protected, `_DEVELOP` staging-only).
- **No service-account key is written into `functions/` any more (NV-08).** Both functions
  deploy jobs wrote `GOOGLE_SERVICE_ACCOUNT_DEVELOP` and `_MASTER` into
  `functions/service_accounts/`, and firebase-tools zips the whole functions directory
  minus `firebase.json` `functions.ignore` (it does NOT read `functions/.gcloudignore`), so
  every deploy uploaded both keys into the target project's function source, the staging
  one included. The deployed runtime never used them (`firebaseConfig.master.js` /
  `.develop.js` use ADC). The jobs write no key now, and `functions.ignore` excludes
  `service_accounts/`, key-shaped file names and `tmp_project_name` as well, so a local
  `firebase deploy` from a machine with keys in that folder is covered too.
- **GitLab protection state (2026-11-08).** `master` is protected: push and merge
  Maintainers only, no force push. `GOOGLE_SERVICE_ACCOUNT_MASTER`,
  `GOOGLE_FUNCTIONS_ENV_PROD`, `GITHUB_TOKEN`, `GITHUB_TOKEN_ALLDONEAPP` (and the new
  `FIREBASE_DEPLOY_SA_PROD`, `DEPLOY_MARKER_SIGNING_KEY`) are protected variables, so only
  master pipelines see them; staging variables stay unprotected because feature-branch QA
  jobs use them. The container registry lets only Maintainers push or delete tag
  `^latest$`. `deployed/*` tags are deliberately NOT protected (see the marker note).
  Earlier notes in this repo that said there were no protected branches (for example in
  `TYPESENSE_MIGRATION.md`) describe the state before that date.
- **Functions deploy only affected exports.** `ci/selectFunctionsDeployment.js` parses
  committed `functions/index.js`, follows entrypoint helpers and transitive local imports,
  and compares both trees against `deployed/functions-production` (or `functions-staging`).
  Shared modules select every importing export, including imports outside `functions/`.
  Unreferenced tests/docs and unrelated frontend changes do not select backend functions.
  `functions-deploy-scope.json` records names and reasons; partial selections deploy in
  batches of at most ten via `ci/runFunctionsDeployment.js`. The isolated, pinned parser
  dependencies live in `ci/function-scope-tools/`.
  Selection refreshes inside the serialized Functions job, since an earlier deployment
  can finish after the pipeline's initial scope calculation. Before Firebase starts,
  `functions-begin` must successfully record `deployed/<target>-attempt`. If that attempt
  differs from the last verified deployment, the next run reconciles all functions,
  including a revert after a partially completed deployment. Success advances the normal
  marker only after per-selected-function completion and the full live export inventory
  are verified. Thus a failed batch never advances the successful marker.
  Missing baselines/artifacts, removed exports, package/runtime/configuration changes,
  unmapped runtime assets and `FUNCTIONS_DEPLOY_ALL=1` use full deployment. Unresolved
  dynamic imports conservatively include their callers on possible source changes;
  unsupported export syntax fails analysis instead of silently omitting a function.
  CI stamps `functions/ci-deployment.json` into the uploaded package so runtime-only
  changes cannot be skipped by Firebase's source hash. This file and the scope manifest
  are generated and ignored by git. Environment changes outside git require
  `FUNCTIONS_DEPLOY_ALL=1`; repository analysis cannot detect changed CI secret values.
  **A deploy that exits 0 can still have skipped a whole group of functions, so
  `ci/runFunctionsDeployment.js` redeploys once.** firebase-tools 13.29.3 deploys in
  parallel groups keyed by region and memory, and an exception escaping one group is only
  written to its debug log (`fabricator.applyPlan`, "This should never happen"). On
  2026-11-09 a full deploy lost the 1, 2 and 4 GiB groups (the same 67 functions on
  production and staging) and reported success. The script streams Firebase's output live
  and keeps a copy. It then reads the completed results with the verification's own parser
  (`completedFunctionNames`) and reruns, once, only the batches that hold a function without
  a result. On a full deploy that is a second `--only functions`, which skips every function
  already current by its source hash. More than `MAX_REDEPLOY_NAMES` missing is not this
  failure and is left to the verification step, which still fails the job for anything
  missing after the retry. Pinned by `__tests__/CiFunctionSelection.test.js` and a
  real-process case in `__tests__/CiFirebaseFunctionsDeployment.test.js`.
- **`resource_group` process mode is an API-only setting and defaults to `unordered`.** With
  the guard and the markers in place the default is safe (an out-of-order job skips and the
  next pipeline catches up), but `newest_first` gets the current commit live sooner and wastes
  fewer queued slots:
  `curl --request PUT --header "PRIVATE-TOKEN: <token>" "$CI_API_V4_URL/projects/<id>/ci/resource_groups/functions-production-deploy" --data "process_mode=newest_first"`
  — repeat per resource group (`web-production-deploy`, `runner-production-deploy`,
  `github-mirror`). It cannot be set from `.gitlab-ci.yml`.
- **The GitHub mirror is its own job (`mirror:github`), not part of the production build.**
  It used to run in `build_web_production`'s `before_script`, which gave that ~9-minute build
  an external side effect and therefore `interruptible: false` — so **every** superseded master
  push paid for a full production build purely to reach the mirror. Splitting it out is the
  single biggest CI-capacity win available here, since 28% of pushes are superseded within ten
  minutes. It also now runs on every master push rather than only web-relevant ones: the mirror
  is a copy of the repository, so the old scoping meant a functions-only push never reached
  GitHub until some later commit happened to touch web paths. `ci/github-push.sh` appends only
  new commits (keyed on the `github-mirror` marker) using `git commit-tree`, instead of
  replaying all 2,524 post-cutoff commits through an orphan branch on every deploy; it falls
  back to a full rebuild and force-push whenever the mirror is not where the marker claims, so
  it is self-correcting. `commit-tree` also fixed a latent bug: the old
  `git checkout <c> -- . && git add -A` loop restored files but never removed them, so the
  public mirror had been accumulating files master had deleted.
- **CI images bake `node_modules`, so a branch that changes dependencies needs its own
  image.** `build_base` (node:12, `npm ci` on the v1 lockfile) and `build_web_bundler`
  (node:22 tooling + the app tree copied from the base image) are built by the
  `modules_cache` / `web_bundler_cache` kaniko jobs. `build_web_webpack_check` and
  `test:web:changed` do **not** install anything — they `ln -s /app/node_modules` from
  the image. Before 2026-08-05 the cache jobs only ran on develop/master, so any branch
  bumping a dependency compiled and tested against the _previous_ lockfile's tree and
  failed with unresolvable imports (the firebase 8 → 12 branch: `Can't resolve 'firebase/compat/app'`) while being green locally. Now a feature branch whose
  dependency manifests differ from master builds its own images tagged
  `:branch-$CI_COMMIT_REF_SLUG`, selected by the consuming jobs through a rules-level
  `APP_IMAGE_TAG` (default `latest`); `:latest` is still only ever written from
  develop/master, because master builds from it. The `branch-` prefix is a security
  boundary (NV-31): with the bare slug, a branch named `latest` (or anything GitLab slugs to
  it, like `LATEST`) pushed its own `node_modules` over the images master's production
  build and gates run in. `__tests__/CiImageTags.test.js` holds it. Two consequences: the branch's first
  pipeline is slow (full `npm ci` + two image pushes), and each such branch leaves an
  image in the registry — bound that with a tag cleanup policy.
- **`test:web:changed` runs only what a branch changed, so read the selection line
  before trusting a green tick.** `ci/selectTargetedJestFiles.js` diffs
  `origin/master...HEAD` and prints a `Targeted Jest selection: N file(s) …` summary to
  stderr; `N` is the honest measure of what the job covered, not the green tick. Two
  ways it legitimately selects nothing: a branch that changed no web-relevant JavaScript,
  and a branch **already merged into master** — the pipeline for the last branch commit
  often starts before the merge and fetches master after it, at which point the branch
  diff is empty by definition and nothing is tested (`test:web:changed` never runs on
  master, so no other job covers those commits either; re-run the job before merging, not
  after). Every other outcome is a failure: the selector exits non-zero on an unresolvable
  base ref (3), a missing merge base (4) or a failed diff (5), and the job fails on it.
  Keep it that way — the original bug was `selector | xargs -0 -r npm test`, where
  `xargs -r` skipped the run on empty input and the pipeline reported only xargs' status,
  so a crashed selector and a clean run were indistinguishable. Check exit statuses
  explicitly rather than through `set -e`; the runner's shell is busybox `sh`.
- **`ci/ensureMergeBase.sh` exists because the CI clone is shallow.** GitLab clones with
  `git depth 50` and a plain fetch of the default branch inherits that boundary, so a
  branch whose fork point is older has no common ancestor locally and the whole selection
  collapses. The script fetches the default branch and the branch under test, then deepens
  (250 → 1000 → `--unshallow`) only until `git merge-base` resolves, so the usual recent
  branch pays nothing.
- **The registry cleanup policy must always keep `latest`.** Branch-scoped images
  (`build_base:branch-<ref-slug>`, `build_web_bundler:branch-<ref-slug>`) accumulate one per
  dependency-changing branch, so a cleanup policy is needed — but the policy this project
  had was `name_regex: ".*"` with `name_regex_keep: null`, i.e. **nothing protected**,
  including `latest`. That is a live hazard rather than a theoretical one: GitLab reports
  a tag's `created_at` from the _image config_, not the push time, so `build_base:latest`
  read as 2022-04-29 and counted as far "older than" the threshold; only `keep_n`
  ordering against other equally-stale tags was keeping it. Deleting `build_base:latest`
  would break every job that pulls it, and **it would not self-heal** — `modules_cache`
  only rebuilds when `package.json`, `package-lock.json` or `ci/Dockerfile_base` changes.
  The policy is now `name_regex_keep: ^latest$`, `older_than: 14d`, `keep_n: 5`. Delete a
  merged branch's tags by hand (`DELETE /projects/:id/registry/repositories/:repo/tags/:tag`)
  rather than loosening that. All four image repos now hold only `latest`: the commit-SHA
  tags left behind by a retired CI convention (builds of November 2021 commits, present in
  both `build_base` and `build_functions`) were deleted, having been checked for distinct
  manifest digests and zero references. The `<repo>/cache` sub-repositories are kaniko's
  layer cache and are meant to churn — the policy prunes them, and they simply rebuild.
- **Never fix a missing dependency by copying packages into `node_modules`.** Install
  through the lockfile. Example of why: firebase 12 keeps root `tslib` at 1.11.1 while
  nesting `tslib` 2.8.1 inside 29 of its 44 `@firebase/*` packages; a flat copy hoists
  2.8.1 to the root and breaks the 1.x consumers (Stage 0 hit the inverse of this, where
  root tslib 1.11.1 shadowed the nested 2.x and threw `__spreadArray is not a function`).
- **The runner image jobs run on the floating upstream `google/cloud-sdk:slim`, which has
  no `python3` on PATH since SDK 592.0.0 (2026-11-03).** Its Dockerfile asserts
  `! command -v python3`, and gcloud uses its own bundled Python. The old inline check
  `python3 -c … 2>/dev/null || echo "not valid JSON"` therefore turned "python3: not found"
  into "env_functions.json is not valid JSON", and `deploy:cloud:runner:production` failed
  on a valid secret while the Functions deploy in the same pipeline read it fine.
  `ci/validateJsonFile.sh` uses `python3`, `$CLOUDSDK_PYTHON`, the bundled Python and then
  `node`, in that order. A missing interpreter exits `2` with that diagnosis, and invalid
  content exits `1` with only a position. It never prints content, because V8's
  `JSON.parse` message quotes it. Never hide a check's stderr when the checker itself may
  be missing. Pinned by `__tests__/CiValidateJsonFile.test.js`.

### A project shared "With link" may be opened by id, never listed (incident 2026-11-08)

New projects default to `isShared: PROJECT_PUBLIC` ("With link"). The `projects` rule used to grant
`read` (get **and** list) on any such project to everyone, even signed out, so a single query
`where('isShared', 'in', [0, 1])` returned every With-link project of every account. Together with
`canReadSharedObject` (project-wide objects of a With-link project are readable by anyone who
names the project), that made those projects and their notes enumerable. An external host did
exactly that from 2026-11-06 and fed the harvested note ids to the then-unauthenticated collab
server. The non-member path is now `allow get` only. Every client query on `projects` filters on
`userIds`, so none relied on the list; keep it that way, and never add a rule or index that lets a
non-member query projects by sharing level. Object lists inside a known With-link project stay
open on purpose (that is what "With link" means). Ids already harvested keep working until the
project is made private. Pinned by the incident case in the `project membership authority` block of
`__tests__/Firestore/firestoreRules.emulator.test.js`.

### A member-written link only ever opens as a web link (security audit 2026-11)

`window.open('javascript:…')` and `<a href="javascript:…">` run in the app's own origin, and the CSP
allows inline script, so any field another member, an assistant or an email can write and that the
app opens on click was a stored cross-member XSS: a task's `calendarData.link`, a contact's
`linkedInUrl`, an attachment or image token in comment text, a pre-configured task's `link`
(NV-03, NV-05, NV-36). `utils/safeUrl.js` is the one place that decides: `getSafeNavigationUrl`
allows http(s), mailto, tel, blob and relative paths, parsed with `new URL` so case, whitespace and
control characters cannot hide the scheme; `getSafeFrameUrl` allows https only. `installWindowOpenGuard`
(from `AppNavigator`) wraps `window.open` for the whole app, which also covers react-native-web's
`Linking.openURL`; the known sinks check explicitly as well. Use the helper for every new `href`,
`window.open` or `<iframe src>` that takes data, and never assign `location` from data.
`firestore.rules` keeps the same values out of the data: `calendarData.link` and an assistant task's
`link` must be http(s) or empty when they change (`isWebLinkOrEmpty`; an unchanged legacy value
stays writable around it).

The MCP login page on my.alldone.app ends in `window.location.href = redirect_to`, so an OAuth
redirect URI is the same kind of sink (NV-34): `functions/MCP/auth/redirectUriPolicy.js` allows https,
http on loopback and private-use app schemes (`cursor://`), and refuses any scheme the browser
evaluates, at registration, at authorization (which also stops clients registered earlier) and before
the login redirect is built. Assistant output may carry image/video tokens, which every viewer's
browser fetches on render; `sanitizeAssistantResponseText` turns a token whose URL is not on the
project's own storage bucket back into its plain URL (NV-04, `assistantTextSafety.js`). Pinned by
`utils/safeUrl.test.js`, `functions/MCP/auth/redirectUriPolicy.test.js`,
`functions/Assistant/assistantTextSafety.test.js` and the `must be web links` block of the rules
emulator suite.

### What a Firestore trigger reads from a client document must be bound by the rules (security audit 2026-11)

Several documents are written by any member (or any signed-in account) and then acted on by the
server with the Admin SDK, which trusts what it reads. Anonymous sign-in is enabled in production, so
"signed in" means "anyone". The rules now bind each of these at write time:

- **Projects** (`newProjectBoundToCreator`, `projectMembersAddedOnlyToGuide`): a client creates a
  project only with `userIds == [itself]` and `creatorId == itself`, and `creatorId`, `isTemplate`
  and `parentTemplateId` never change afterwards. `creatorId` listed in `userIds` is who pays for the
  default project wiki (`knowledgeBaseDefaults.js`), so before this any account could create a
  project naming another user as creator and member and spend that user's Gold. The one exception is
  a guide: it is created in the name of its template's `templateCreatorId` (the parent must really be
  a template), and a guide member may add exactly that creator and the administrator. Members are
  otherwise never added by a member; `templateCreatorId` may only be set to oneself on create or
  handed to the administrator by a kick. Accepting an invitation to a plain project (the invitee
  adding itself) was already refused by the `isProjectMember` update rule before this change and
  still is: it goes through `joinProjectSecondGen` (see below), not a wider rule.
- **Global assistant catalog** (`globalAssistantTaskActivationOnly`): every field of
  `assistantTasks/globalProject/preConfigTasks/*` outside the activation keys is copied into every
  tenant's derived assistant. A non-administrator may change only `activatedUserIds`,
  `recurrenceByUser`, `activatedInProjectIdByUser`, `lastExecutedByUser`, `completedOneOffUserIds`,
  `activatorUserId` and a missing `creatorUserId`, each only in its own entry. The activation dialog
  therefore sends only that entry for a global task (`buildGlobalTaskActivationUpdate` in
  `assistantsFirestore.js`, a transaction without the admin-only assistant bump). The triggers ignore
  anything under `globalProject` that is not in `preConfigTasks` (`globalCatalogTaskPath.js`), and the
  update trigger propagates nothing when the template state (`getTaskTemplateState`) is unchanged, so
  switching an activation no longer rewrites every tenant's copy and posts a sync activity.
- **Invitations** (`isValidProjectInvitation`): `inviterId` must be the writer, only the four fields
  the app writes are allowed, and no client updates one. `onCreateProjectInvitation` ignores the
  stored `url`, builds the answer link from `app_url` + project id + address (refusing an address that
  could break out of the path), sends nothing when the inviter is not a member, and caps mails at 50
  per inviter per UTC day (`projectInvitationEmailQuota`, server-only).
- **Forced reloads** (`userForceReloads/{uid}`): a teammate write must name a project that both the
  writer and the target belong to, before or after the write (deleting a project and kicking a member
  reload people on their way out).
- **Sticky note markers** (`stickyNotesData`): never readable or listable by a client, writable only
  by members of the project the marker names (old and new), and deleting a marker that does not exist
  stays allowed because the app untracks on every unstick. `checkStickyNotes` re-reads the note's own
  `stickyData.stickyEndDate` and re-arms the marker instead of demoting a note that is still sticky.
- **`info/**`** is server-only; `increaseVersionSecondGen` is the only writer of `info/version`.
- **Invitation membership mutations** (`onlyInvitationFieldsChange`): `invitation-add` and
  `invitation-remove` may touch only `invitedProjectIds` and the proof, not the invitee's
  `assistantId`, `lastEditorId` or assistant comment maps.

Pinned by the `security audit 2026-11: rules package` block of
`__tests__/Firestore/firestoreRules.emulator.test.js` (each case fails against the previous rules),
`functions/AssistantTasks/globalCatalogTaskTriggers.test.js`, `functions/StickyNotesHelper.test.js`,
`functions/Utils/projectInvitation.test.js` and `utils/backends/Assistants/globalTaskActivation.test.js`.

### Joining a project is a server operation (`joinProjectSecondGen`)

`firestore.rules` let only an existing member update `projects/{id}` (and vouch for a membership
change on a user document), so the browser can never add itself to a project. The invitation
popup's "Join", a template link (which places the visitor in a guide) and joining a guide used to
batch-write `userIds` and the joiner's `projectIds` from the client and were all refused (pinned by
"never lets an invitee or a link visitor add itself" in the rules emulator suite). Now
`functions/Projects/joinProject.js` decides and writes, in one transaction, what the client wrote:
project `userIds`, every added user's `projectIds` + `guideProjectIds`/`templateProjectIds`, the
default workstream (not for guides), a new guide document plus the template's `guideProjectIds`, and
it consumes the caller's invitation. Who may join: an invitation naming the caller's uid or
**Firebase-Auth-verified** email (never `users/{uid}.email`); a project shared "With link"
(`isShared === 0`; restricted is copy-only unless invited); a guide directly only by its template's
creator or the administrator; a template with `startGuide: true` by anyone who may open it (last guide
with room, else a new guide with the creator and administrator), the administrator joining the
template itself. `preview: true` returns the project summary and `access` (an invitee of a private
project cannot read it before joining), `decline: true` removes the caller's invitation. Feeds,
followers, welcome chats and `copyTemplateObjectsSecondGen` stay on the client and run after the
callable returns, as a member (`joinProjectAsLoggedUser`, `createProjectJoinFeeds` in
`usersFirestore.js`, `addUserToTemplate` in `guidesFirestore.js`). The template's "guide added" feed
is no longer written: the joiner is not a template member. Never reintroduce a client write of
another project's membership; `__tests__/Projects/JoinProjectClientGuardrails.test.js` ratchets it.
Pinned by `functions/Projects/joinProject.test.js` and `utils/backends/Projects/guidesJoin.test.js`.

### Every `<origin>/<name>Callback` a function builds needs a hosting rewrite

OAuth redirect URIs are built on the app origin (`https://my.alldone.app/googleOAuthCallback`,
`/microsoftOAuthCallback`, `/mcpClientOAuthCallback`, `/mcpOAuthCallback`). Without a rewrite in
`firebase.json` the provider's redirect falls through to `** -> /index.html` and the code lands in the
SPA: `/microsoftOAuthCallback` did exactly that in production until it got its rewrite. Add the
rewrite (above `**`) and the service worker's `NAVIGATION_DENYLIST` entry with the function;
`__tests__/OAuthCallbackHostingRewrites.test.js` scans `functions/` and fails otherwise. The redirect
URI must also be registered with the provider (Google Cloud console / Microsoft Entra app).

### Storage rules (`storage.rules`, `storage.notes.rules`)

**Before these files, both buckets let any signed-in account read, list and write every object**
(`allow read, write: if request.auth != null`, console-managed since 2021/2024): every note body in
`notescontentprod`, every contact/assistant avatar, invoice logo and artifact in the default bucket,
across all workspaces. `storage.rules` (default bucket `<project>.appspot.com`) and
`storage.notes.rules` (the notes bucket) are now the source of truth and mirror `firestore.rules`:
per-project folders require `projects/{projectId}.userIds` membership via cross-service
`firestore.get()`, a note body or note copy additionally requires that the note itself grants the
caller access, a non-member of a public project (`isShared != 2`) may read only a note whose
`readerIds` holds `0` (exactly `canReadSharedObject`), `artifacts/` and `attachments/` are
server-only, and nothing may be listed outside the member-scoped avatar folders.

Four things are load-bearing. **The Admin SDK and token download URLs bypass these rules**, so they
only decide what a browser may do through the Storage SDK (`put`, `getDownloadURL`, `listAll`,
`delete`) — inventory those call sites (`utils/backends/firestore.js`, `notesFirestore.js`,
`NotesOfflineCatchUp.js`) before adding a folder. **A note body follows the note's own access
exactly as `canAccessObjectWhileProjectionIsPending` does**: the projected fields (`readerIds` and
its siblings) when they exist, `isPublicFor` while none exist yet — the browser writes the empty body
right after creating the note document, before the server trigger has projected `readerIds` — and
membership alone while the note document does not exist at all, because `setNoteProject` writes the
body into the new project BEFORE the note document lands there. That fallback is for the live body
in the notes bucket ONLY: the version copies (`noteVersionsData`, `noteDailyVersionsData`) outlive a
deleted or moved note by up to a week, so they require the note document to exist and grant access
(NV-39); every client flow on them runs on an existing note, and `onDeleteNote` deletes the daily
copy at once. **Cross-service rules may read at most
two Firestore documents per evaluation**; every note path reads exactly two (the project and the
note), so a third lookup (a user doc, a role doc) on those paths would push every note access over
the limit and deny it. **Cross-service `firestore.get()` needs the Storage service agent
(`service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com`) to hold
`roles/firebaserules.firestoreServiceAgent`**; without it every lookup is an evaluation error, an
error is a denial, and every note stops loading. The console grants it when it publishes such rules;
the Rules API does not.

Neither file is in `firebase.json`, so neither CI nor `firebase deploy` publishes them: publish with
the Rules API (create a ruleset, PATCH `releases/firebase.storage/<bucket>`) and note the previous
ruleset for rollback. Test first with `node ci/test-storage-rules.js <projectId>`, which runs ~120
cases through the Rules API test endpoint (real compiler, mocked `firestore.get`/`exists`) and
treats any compile warning as a failure — a type error such as `allPaths.matches(...)` (`allPaths`
is a path, not a string) evaluates to an error and therefore to "deny" for everyone, while every
DENY case still passes.

**There is no catch-all: an unmatched folder is denied (security audit 2026-11, NV-37).** The old
last rule let any signed-in account `get` any server-written object whose path it knew, which held
only for random names: `Invoice/{uid}/{year} - {counter}.pdf` (Mollie invoices) is enumerable, and
`anna-email-inbound/`, `browserEvidence/` and `whatsapp-images/` sat behind the same rule. No client
code reads a server folder through the SDK; those objects reach people as token or signed URLs. A
new folder the browser must touch needs its own `match`. **`feedAttachments/` and `notesAttachments/`
are bound to their uploader (NV-38)**: their paths carry no project and appear in every shared URL,
so a put must carry `customMetadata.uploaderId == auth.uid` (`allow create` only ever fires for an
object that does not exist yet), and only that uploader may `get`, `update` or `delete` it. Every
client put goes through `putAttachmentAsUploader` (`utils/backends/attachmentUploads.js`, ratcheted
by its test). Objects uploaded before carry no `uploaderId` and are therefore frozen for clients,
which is harmless: no client flow ever re-resolves, replaces or deletes one, and their token URLs
keep working. Publish these rules only once the client that sets the metadata is live and old tabs
have reloaded, or an upload from a stale tab is refused. `attachments/` (VM fallback files, written
by the Admin SDK) has no client access at all; the client code that listed and wrote it was dead and
is removed.

### Firestore indexes (`firestore.indexes.json`)

- **Never deploy indexes with `--force`.** `firebase deploy --only firestore:indexes` treats the file as the _desired state_: `--force` deletes every live composite index **and field override** the file omits. The file drifted to 25 indexes / 2 field overrides while production held 228 / 71, so a forced deploy would have dropped ~200 indexes plus 69 single-field **index exemptions** — the exemptions are the sharper hazard, since removing one makes Firestore _start_ indexing a large text field (`comments.comment`, `notes`, `entries`), causing write amplification and possible "index entry too large" write failures.
- **There is no safe automated deploy, so CI only checks.** Dropping `--force` does _not_ give you a create-only deploy in CI: with `--non-interactive`, firebase-tools' `confirm()` helper **throws** ("Pass the --force flag to use this command in non-interactive mode") as soon as any live index is missing from the file, and it throws _before_ creating anything. Production permanently has at least one such index (the `tasks` index on `__name__` alone, which the file format cannot express), so a non-interactive deploy can only ever fail — an earlier version of `check:firestore:indexes:production` did exactly that. The jobs in `.gitlab-ci.yml` are therefore **read-only drift checks**.
- **To actually create missing indexes, deploy interactively** and answer **no** when it offers to delete the undeclared ones: `firebase deploy --only firestore:indexes --project <projectId>`. Interactively the confirm defaults to false, so it creates what is missing and then skips the deletions. That is the supported way to give staging the indexes it lacks.
- The file **mirrors production** (218 indexes + all 71 field overrides), verified to require zero creates and zero field-override patches under both firebase-tools 13.29.3 and 15.11.0.
- **Check before deploying**: `node ci/check-firestore-indexes.js <projectId>` diffs the file against a project's live state and prints what a deploy would create, patch, or (with `--force`) delete. `--warn-only` reports without failing; `--strict` also reports the deliberately-excluded junk. Regenerate the file with `firebase firestore:indexes --project alldonealeph`.
- **Strip `__name__`, and never blindly.** The API returns a trailing `__name__` field the file format does not list. Both CLIs expect it absent, but for opposite reasons: the pinned **13.29.3 strips it from the live side**, while **15.x re-appends an implicit one to the file spec**, ordered like the last _ordered_ field. So `__name__` may only be dropped when its direction equals that implied value — otherwise 15.x sees a mismatch and delete+recreates the index. Also strip `density` (13.29.3 has no support for it; `SPARSE_ALL` is the default anyway).
- **Two live indexes are unrepresentable and intentionally omitted**: 9 on collections named with Firebase push IDs (a path-templating bug; those collections hold 0 documents) and one `tasks` index whose only field is `__name__ DESCENDING` — 13.29.3 renders it as zero fields, and it is redundant because Firestore indexes `__name__` implicitly. `check-firestore-indexes.js` ignores both shapes unless `--strict`.
- **`--only firestore:indexes` does not publish rules.** It compiles `firestore.rules` to validate them, but `release` is gated on `context.firestoreRules`, which that flag clears. `--dry-run` runs only the prepare phase, so it validates the file without any API writes — but it does _not_ print a create/delete plan; use the check script for that.
- **Staging is not a superset of production.** It holds ~30 indexes production lacks, including 15 with hardcoded user IDs baked into field paths (`dueDateByObserversIds.<uid>`, plus malformed dot-less variants) created ad hoc from the console. Never fold those into the file — they would be created for two arbitrary users in production.
- `.firebaserc` defaults to **`alldonestaging`**, so an index command without `--project` targets staging. Always pass `--project` explicitly.
- **Swapping the access field of a query silently orphans every composite index it had (the
  `readerIds` rollout, 2026-08-28).** A composite index is keyed on its exact field set, so when
  "Harden Firestore access rollout" rewrote every list query from `isPublicFor array-contains-any`
  to `readerIds array-contains`, each rewritten query needed a brand-new index and the ~55 `isPublicFor`
  ones covered nothing. Only the views exercised during the work got theirs; the Done tab shipped
  without its four and was **empty in production for five days** — `failed-precondition` in the
  console, nothing in CI, because the drift check only compares this file against the live set and
  the missing ones were absent from both. Two facts decide which queries need one, both verified
  against production with a read-only `runQuery`: Firestore **merges `array-contains` with any
  number of equality filters on its own**, so `readerIds` + `==` clauses need no composite; a
  **range, a `!=`, or an `orderBy`** on top of it does, and direction counts (`completed ASC` does
  not serve `orderBy('completed','desc')`, and an inequality with no explicit order needs ASC).
  When rewriting a query's filter field, derive the new index list from the old one before
  shipping; `__tests__/Firestore/firestoreRequiredIndexes.test.js` pins the fifteen `readerIds`
  shapes the client uses. Note the per-user access keys (`roleIdsVisibleTo.<readerId>`,
  `followedByVisibleTo.<readerId>`, `backlinkIdsVisibleTo.<readerId>`) can **only ever be the
  sole clause** of a query: a composite index on a map key is one index per user, which is not a
  thing. The observed-tasks branch of `getOpenTasksQuery` (`utils/backends/openTasks.js`) keeps
  its `dueDate` filters inside the assigned-tasks `else` branch for exactly that reason and
  buckets observed tasks by date in memory — do not "tidy" the date filters out of the `else`.

### Cloud cost (reviewed 2026-09-02, August invoice EUR 334.79, ~EUR 306 of it Alldone)

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

### External Services

- **Algolia**: Search and user mentions
- **Mollie**: Premium payments
- **Google Calendar**: Task calendar sync
- **Sentry**: Error monitoring
- **SendinBlue/Brevo**: Transactional emails
- **OpenAI/Perplexity**: AI Assistant features
