# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alldone is a React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. Runs on iOS, Android, and web with shared codebase.

## Development Commands

```bash
# Git worktree setup (run once per new worktree, before anything else)
sh setup-worktree.sh         # Links node_modules, functions/, web-bundler/, .env

# Development
npm run web-webpack          # Dev server on the webpack pipeline (port 19006)

# Firebase Functions (local)
firebase emulators:start --only functions --inspect-functions

# Testing
npm test                     # Run Jest tests
npm test -- --testPathPatterns="TaskList"  # Run single test file (jest 30: plural flag)
npm run coverage             # Generate test coverage
npm run update-snapshots     # Update Jest snapshots

# Build & Deploy
npm run build-web-webpack    # Build for web production (webpack 5 — see web-bundler/)
npm run format-code          # Format with Prettier
```

**Required versions**: Node 22 (repo-wide, `.nvmrc`), npm 10, firebase-tools 13.29.3.
Since migration Stage 5 the whole repo — installs (lockfile v3, `.npmrc` with
legacy-peer-deps), Jest, the web-bundler build, and Cloud Functions work — runs on
Node 22; the Node 14 / npm 6 / expo-cli era is over. The RN-era scripts still in
package.json (`start`, `web`, `android`, `ios`, `build-web`, `start-clean`) are dead:
they need the retired expo/metro toolchain and cannot run under Node 22.

**web-bundler (migration Stage 0)**: `web-bundler/` is the standalone webpack 5
replacement for `expo build:web` (own lockfile, its own babel config). Since Stage 5 it is
no longer a Node-version carve-out — the whole repo is Node 22 — and it builds the app
source against the root `node_modules` (now also installed under Node 22 / npm 10) while
reproducing the exact `web-build/` output contract. Env injection stays sed-based outside
the bundler; the `replacement_node_modules` swap still applies before building. **Since
2026-08-04 this IS the deployed pipeline**: `build_web_production` (master) and `build_web_staging` (develop)
build through web-bundler on the Node 22 tooling image; `build_web_webpack_check` gives
feature branches compile signal + a manual preview-channel deploy
(`deploy:web-webpack-preview`, channel `webpack-<ref>` on the staging project). The expo
build jobs are deleted; `npm run build-web` (expo) remains only as a local legacy script.
See `web-bundler/README.md`. **Strict-mode gotcha**: the
RN-era sloppy idiom `export default Name = (...)` (assignment to an undeclared identifier)
crashes under real ES modules with a `ReferenceError` that aborts the whole main chunk with
zero console errors — write `const Name = (...); export default Name` instead. Four
components were fixed for this during Stage 0; grep before assuming a blank page is a
bundler problem.

**Cloudflare worker exception**: `cloudflare/email-worker/` pins Node 20 for Wrangler via its own `.nvmrc`; use `nvm use 20` inside that directory, then `nvm use` (Node 22 from the root `.nvmrc`) back at the repo root.

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

### Assistant Tool Checklist

When adding a new assistant tool, wire every layer, not just the backend schema:

- Define the schema in `functions/Assistant/toolSchemas.js` and add/adjust `functions/Assistant/toolSchemas.test.js`.
- Implement native execution in `functions/Assistant/assistantHelper.js`, including permission/runtime-context checks, conversation-safe results, and focused tests in `functions/Assistant/assistantHelper.test.js`.
- Add the tool to the assistant settings UI in `components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js` so it can be enabled per assistant. Decide deliberately whether it belongs in `DEFAULT_ALLOWED_TOOLS` or `OPT_IN_ONLY_TOOLS`, then cover that in `toolOptions.test.js`.
- Add local strings for the tool label in `i18n/translations/en.json`, `de.json`, and `es.json`.
- Check channel-specific allowlists before assuming the tool is available everywhere. Gmail labeling follow-up uses the normal assistant `allowedTools`, while email replies and realtime/WhatsApp flows may have separate safe-tool filters or schema adapters.
- If prompts mention the tool, ensure the responsible assistant can actually enable it in Tools Access; otherwise the prompt can ask for an action the runtime will block.

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
  cache). Skipped under the emulator, whose IndexedDB is wiped each boot. Consequences to
  respect: `watchForceReload` only honors a **server** snapshot (a cached `{reload: true}`
  would reload-loop offline — the guard is `doc.metadata.fromCache`), and
  `bootIntegrityHealer` stands down while `connectionState === 'offline'` (cached-only
  data is not an anomaly, and the bounded `disableNetwork`/`enableNetwork` cycles must
  not be burned offline). A doc "missing" in a cache-only snapshot is **unknown, not
  deleted** — the `firestoreDirectRead` verification paths already treat a failed direct
  read as retryable, keep it that way.
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

**The mask goes on the row; the particles go beside it.** `ProjectHeader` owns the run
(`useProjectCompletedSweepMotion` + `useProjectLineExit`) because a child cannot mask its parent, and
`ProjectCompletedSweep` became presentational. `ProjectLineDisintegration` is a SIBLING of the masked
node — a child would be erased by the very front it is shedding — inside a wrapper `View` so its
absolute placement resolves against that row and nothing else. Two failure modes are guarded
explicitly: an exit whose verdict is **withdrawn** mid-run (a task landing back in the project) is
reset, and an exit the board **never finishes** is put back after `EXIT_RECOVERY_MS`, because an
erased zero-height row is a hole the user can neither see nor click and has to reload to clear. The
row's height is frozen when the exit begins, so the collapse cannot overwrite what it is collapsing
from and the particle layer keeps the full height while the row closes underneath it.

**The celebration is nine sparks, and it must never become confetti.** AT-2492's ranking rule
stands: the all-projects empty inbox owns confetti (46 pieces, gravity, spin, a `position: fixed`
layer that escapes to the viewport), and clearing one project stays smaller in KIND. So these are
struck OFF the dissolve front on the same `particleLiftOff` derivation the dust uses — the
celebration is visibly caused by the line leaving rather than thrown over it — they rise and twinkle
(grow into their peak, where a mote only ever shrinks), nothing falls or spins, they carry the
project's own colour with every third one gold so a pale project still reads, and the layer is
`position: absolute` bounded to the 56px row. Their life is CLAMPED to `COLLAPSE_START` rather than
tuned to fit, so `SPARK_LIFE` can be retuned without leaving a particle drifting while the board
pulls the content below up through it.

Pinned by `projectLineDisintegration.test.js` (the mask arithmetic re-derived from the CSS spec, the
grain, the dust and the celebration), `ProjectLineDisintegration.test.js`,
`projectCompletedSweepMotion.test.js` (the branch, both arrival orders, both recoveries),
`ProjectHeaderLineExit.test.js` (the wiring — the mask on the right node, the particles outside it,
and every other board in the app unaffected), and the AT-2495 blocks in
`ProjectEmptyInboxCelebration.test.js`, which measures the sparks against the real all-projects
confetti so a future change that quietly promotes them fails the build. Plus `browser-tests/at2495`,
which is the only place any of this is ever seen: jsdom drops `mask-image` without a word and
`__mocks__/react-native.js` stubs `Animated.timing`, so it screenshots the row every ~50ms and counts
surviving pixels per column, in four modes (leaving, late verdict, staying, reduced motion).

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

### Gold Transactions

- Every gold change (earn, spend, refund, adjustment) must go through `applyGoldChange` / `deductGold` / `refundGold` / `adjustGold` in `functions/Gold/goldHelper.js` so it lands in the user's `goldTransactions` subcollection. Never mutate `users/{uid}.gold` directly — the log is how users see what happened in the Gold history modal.
- When adding a new gold spend or refund, always pass a descriptive `source` (a new machine key, e.g. `meeting_transcription`, `gmail_labeling`) plus as much linking context as you have: `projectId`, `goalId`, `objectId`, `objectType`, `channel`, and an optional human `note`. The sanitized fields are defined in `functions/Gold/goldTransactions.js` — add new fields there if you need more link context.
- Add a human label for every new `source` in `components/SettingsView/Profile/Properties/GoldTransactionsModal.js` (`getTransactionLabel`) and a matching translation key in `i18n/translations/en.json`, `de.json`, and `es.json`. The modal falls back to `Gold transaction` if the source is unknown.
- Prefer storing enough context that the transaction can deep-link back to its source (chat/topic, goal, contact, Gmail message, etc.). The modal's `getTransactionLink` builds the URL from `projectId` + `objectId` + `objectType` / `channel`; extend it when adding a new source type that has a natural destination.

#### Gold analytics & rollups (tracking earn/spend over time)

- **GA4 events (consent-gated)**: `goldHelper.js` calls `logGoldAnalytics` → `GAnalytics.logEvent` for every change. `normalizeServerEvent` in `functions/GAnalytics/GAnalytics.js` maps each ledger direction to its **own** GA4 event so they don't pollute each other: `earn_gold`→`earn_virtual_currency`, `spend_gold`→`spend_virtual_currency`, `refund_gold`→`refund_virtual_currency`, `adjust_gold`→`adjust_virtual_currency` (all with `virtual_currency_name: 'gold'`, `value`, `source`). `adjustGold` passes the **signed** delta so admin deductions report a negative `value`. These only fire for users with `analytics.consent === 'granted'`, so GA **undercounts** — use it for trends, not exact totals.
- **Firestore rollups (consent-independent, exact)**: the `aggregateGoldTransactionStats` trigger (`functions/Gold/goldStatsAggregator.js`, registered on `users/{userId}/goldTransactions/{transactionId}` in `index.js`) increments `goldStats/daily/days/{YYYY-MM-DD}` and `goldStats/monthly/months/{YYYY-MM}` (UTC buckets). Each doc holds gross `earn`/`spend`/`refund` + signed `adjust`, per-direction counts, a signed `net`, and `spendBySource`/`earnBySource`/`refundBySource` maps (spend-by-source = feature usage). Idempotent via an `aggregatedAt` stamp on the source ledger doc (guards against at-least-once duplicate trigger delivery; an `update` doesn't re-fire `onDocumentCreated`). `goldStats` is admin-read / server-write only (`firestore.rules`).
- **Deploy steps**: deploy the function + `firebase deploy --only firestore:rules`, then backfill existing history with `node migration/backfillGoldStats.js --firebase-project-id=<project>` (dry run; add `--execute` to apply, `--user-id=<uid>` to scope). The backfill reuses the same per-transaction idempotent path, so it is safe to run with the trigger already live. No Cloud Tasks / IAM grants are needed.
- **A spend total is not interpretable without its billing dimensions (AT-2487).** `spendBySource` says which feature spent Gold; it cannot say why the number moved, because the Gold charged for one unit of the same feature depends on how the run was billed. The VM is the case that forced this: a run on the user's own Claude/Codex subscription or their own API key pays the 20-Gold base reserve and 10 Gold per sandbox minute but **zero** Gold for model tokens (`tokenBillingExempt`), so `vm_execution` — **63%** of August 2026's entire spend, 309,864 of 490,806 Gold — falls both when usage drops and when a user connects a subscription, and the two are indistinguishable. Worse, the ledger carried **nothing joinable to `vmJobs`**, so answering it by hand meant matching on `projectId` + `objectId` + timestamp, which is ambiguous the moment a thread has run more than once. Each source-tracked direction therefore also carries `spendByBilling` / `spendByModel` (and the `refund*` equivalents), keyed `<source>__<value>` — `vm_execution__exempt`, `assistant_usage__gpt-5-2`. `functions/Gold/goldDimensions.js` is the single authority for that key format.

    Four things are load-bearing. **`billingExempt` is a tristate** — `true` (the user's own provider paid for the tokens), `false` (Alldone Gold paid), and **absent** (the question does not apply: a Gmail classification has no exempt variant). Coercing absent to `false` would add a constant to every rollup doc and imply a comparison that does not exist, which is why `sanitizeContext` persists it only for a real boolean and `computeStatsDimensions` emits nothing otherwise. **Keys are source-scoped**, because a bare `opus` bucket would merge VM spend with any future consumer of the same model and could not be reconciled against `spendBySource[source]`. **Model keys are slugged** to `[a-z0-9_-]` (`gpt-5.6-sol` → `gpt-5-6-sol`, `openrouter:deepseek/deepseek-v4-flash-0731` → `openrouter-deepseek-deepseek-v4-flash-0731`): a raw id carries dots, colons and solidi that need backtick-quoted field paths everywhere they are read. The raw value is kept verbatim on the ledger entry, so nothing is lost. And **the model recorded is the one the price was frozen from** (`agentModel`, the requested family/alias), never the concrete `resolvedAgentModel` the CLI reports mid-run — the base reserve is charged before a sandbox exists, so using the resolved id where available would split one run between an `opus` bucket and a `claude-opus-4-5` bucket.

    **Every token-priced charge site declares its model**, not just the VM: `assistant_usage` (via `spentGold`, which also covers pre-configured task topics), Gmail labeling and its follow-up prompt, the email draft-reply and create-task flows, all three routing classifiers, the rambler, and the realtime voice calls (`browser_call` / `phone_call` / `whatsapp_call` — token-priced at 100 tokens/Gold, so its `realtimeModel` is now frozen onto the call session at creation rather than read from env config at charge time, which would re-attribute Gold already spent). Flat- and duration-priced sources declare nothing and must keep doing so: `mcp_tool_call`, `iframe_deduction`, `linkedin_enrichment`, `meeting_transcription` and `whatsapp_voice` have no model in their price at all.

    A VM run charges Gold from **five** places (`vmJob.startVmJob`'s base reserve, `vmJobRunner`'s per-minute monitor and settlement top-up, `vmLlmProxy`'s incremental token charges, and the refund paths in `vmJob`/`vmJobRunner`/`vmInteraction`/`vmJobReconciliation`). All of them must stamp the **same** dimensions or one run splits across buckets and stops reconciling, so they read them through the single `buildVmGoldBillingDimensions` in `functions/Assistant/vmGoldDimensions.js` rather than hand-writing a context literal each. Refunds carry them too, so a source's NET Gold cost stays decomposable. `correlationId` is now minted **before** the base reserve is charged so the very first ledger entry of a run is already joinable.

    **Historical data is not backfilled, and cannot be honestly.** Entries written before this shipped carry no `model`/`billingExempt`/`correlationId` at all, and the only way to reconstruct them would be an approximate `vmJobs` match on projectId + objectId + a time window — several runs share a thread, so it would write silent misattribution into buckets that currently just do not exist. Every pre-existing number is therefore **unchanged and still correct**: `spend`, `count` and `spendBySource` are untouched, and a transaction declaring no dimensions writes no dimension fields, so `migration/backfillGoldStats.js` keeps working as-is. Read a dimension map as covering only the period since deploy, and cross-check its per-source total against `spendBySource[source]` for the same window to see how much of it is attributed.

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

Three things are load-bearing. **The run's tools are passed explicitly**
(`CONTACT_ENRICHMENT_TOOLS`: `web_search`, `fetch_url`, `find_profile_photo`, `update_contact`,
`get_contacts`) through the `aiSettings.allowedTools` override, because an assistant's persisted
`allowedTools` predates the two new tools; an existing assistant only gets them for ordinary chats
once its owner enables them in Tools Access. **The contact is switched to `isAssistantEnabled: true`**
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

Billing is two Gold-history lines on purpose: a flat `contact_enrichment` fee
(`CONTACT_ENRICHMENT_GOLD_COST`, refunded if the run throws before answering) for the research
tooling, then the ordinary metered `assistant_usage` of the run. The client mirrors the fee as
`ENRICH_PROFILE_GOLD_COST` for its pre-check and button label — keep the two in step. Pinned by
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
attested mailbox + verified login > attested mailbox > verified login > unattested mailbox.
A connected mailbox outranks a login email because it is the deliberate per-address act — you
OAuth-connect a mailbox INTO the workspace whose Anna should read it, while a login email is merely
how you sign in.

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

### IAM for firebase-admin GCP calls — use the Firebase Admin SDK SA, not the compute SA

This is a repo-wide gotcha, learned the hard way. Gen2 Functions are configured through `setGlobalOptions` to run as the environment's `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` service account, and `functions/firebaseConfig*.js` uses application-default credentials in that managed runtime. Therefore **every firebase-admin call that hits a Google Cloud API authenticates as the firebase-adminsdk service account — NOT the `<projectNumber>-compute@developer.gserviceaccount.com` default runtime SA**. So when a function needs a new GCP IAM permission (Cloud Tasks, Pub/Sub, etc.), grant the role to the **firebase-adminsdk SA**. Granting the compute SA looks right but does nothing. The old CI service-account JSON files may still be prepared for legacy tooling, but Functions no longer depend on baking that long-lived key into Cloud Run revisions. IAM changes also take up to ~7 min to propagate — wait before re-testing.

### Assistant VM Tool (`execute_task_in_vm`) & Cloud Tasks worker

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
- **`permissive` is Auto-Mode, and the level actually has to reach the rules (AT-2343)**: for a long time only three rules consulted the level at all (`analyzeGitPush`, MR/PR merge, outbound HTTP) — every other escalation was level-independent, so picking `permissive` changed almost nothing and interactive runs kept pausing on their own housekeeping. Two things were wrong. First, **the risky-pattern matching ran over the raw command string**, so a heredoc body or a quoted argument was scanned as if it were code: production interaction records are full of `git commit -F - <<'EOF' …` escalating as `bash:secrets` because the commit MESSAGE mentioned `.env`, a `python3 - <<'PY'` block escalating because the documentation it wrote contains the word "secrets", and `git check-ignore -v .env` escalating for the same reason — `splitCommandPipeline` even chopped those bodies into fake command segments at every `|` and `;` they contained. A heredoc body is now stdin **data** unless the reader would execute stdin as a program (`bash <<'EOF'`, `python3 - <<'PY'`), which is the same structural test AT-2235 introduced for pipes, and quoted argument content is blanked before the risky-command rules run — except for interpreters given inline code (`bash -c "…"`) and for programs whose quoted argument IS the operation (`psql -c "delete …"`, `ssh host "…"`). Secret detection matches real **path operands** (`classifySecretPathAccess`) instead of any occurrence of the word anywhere on the line, so `grep -rn secrets functions/` is a search again while `cat "$HOME/.ssh/id_rsa"` is still caught. Second, every rule now carries an **`allowedFrom` level** and the whole product decision sits in one table of named constants at the top of the module. `permissive` therefore auto-approves everything that only touches the ephemeral sandbox: `rm -r` anywhere in the VM, force-pushing a **feature** branch, `sudo`, workspace env files (the repo's own suite needs `node ci/writeTestEnv.js` to write one), writes outside the checkout, MR/PR merge and close, and unrecognised or MCP tools. `balanced` additionally got local Git housekeeping (`reset --hard`, `clean -fd`, `branch -D`) — local-only, and the remote is still governed by the push rules. What pauses at **every** level is the hard-danger list: base-branch push/force/delete, deployments and cloud mutation, package publishing, external DB mutation, `mkfs`/`dd of=`, `ssh`/`scp`/`sftp` to another machine, `curl … | bash`, real credential stores (`~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.codex/auth.json`, service-account keys, `*.pem`), deleting a protected root or the checkout itself, and writing into a system directory. Two smaller fixes ride along: the modern Claude Code tool surface (`BashOutput`, `KillShell`, `SlashCommand`, `Skill`, `NotebookRead`) was missing from `SAFE_CLAUDE_TOOLS` and therefore escalated on **every single call**, and the bridge now passes `additionalDirectories` as `writableRoots` so the relocated Git metadata does not read as a write "outside the working directory". `strict` is unchanged: it keeps its blanket wording for Git publishing and for any recursive delete. Remember this module ships in the **`vm-job-runner` Cloud Run image**, so the change is live only after `deploy:cloud:runner:*` rebuilds it.
- **A per-run override only counts when the user asked for it (AT-2224)**: `agent`, `agentModel`, `agentReasoningEffort` and `approvalPolicy` outrank the saved Settings → Integrations defaults, and the assistant fills them in **on its own** — production workflow-step tool calls carried `agent: 'codex'` and `approvalPolicy: 'balanced'` for a user whose saved defaults were `claude` / `permissive`, with nothing in the request asking for either. It reads as "my default is ignored, sometimes", because it is a sampling decision. `functions/Assistant/vmRunOverrideGuard.js` therefore drops any of those four that the user's own words do not corroborate, before `startVmJob` resolves anything; the dropped value simply resolves from the saved preference instead. Evidence is deliberately **user-authored text only** (`userContext.message`, the workflow step prompt, recent user turns of the thread threaded through `toolRuntimeContext.userRequestText`) — the tool arguments, including `objective` and `deliverable`, are model-authored and can never corroborate themselves. Naming a model names its agent ("use opus" ⇒ Claude); an effort level needs effort/reasoning context next to it, because "high" is ordinary prose; an invalid value passes through untouched so `startVmJob`'s validation still rejects it normally. The schema descriptions in `toolSchemas.js` carry the other half of the fix and must stay agent-neutral — the original text said "consider codex for heavy coding / repository work", which is what generated the bug. Failure is safe by construction: an unrecognised phrasing costs the user their explicit override, never their saved default.
- **Agent choice**: the tool takes optional `agent` (`claude` | `codex`) and `agentReasoningEffort` (`low` | `medium` | `high` | `xhigh`) params. Resolution happens once in `startVmJob`: a **corroborated** explicit tool argument wins (see above), otherwise `users/{uid}.defaultVmAgent` / `defaultVmAgentReasoningEffort` is used. Users without saved preferences receive the system defaults (`codex` + `medium`). Settings → Integrations persists the validated preferences through `getVmAgentSettings`, `setDefaultVmAgent`, and `setDefaultVmAgentReasoningEffort`; an explicit `null` effort preserves the user's "No default" choice and uses the selected provider's fallback. You can additionally pass `agentModel` (defaults: Claude → moving `opus` alias, Codex → `gpt-5.6-sol`); `opus` is persisted and passed unchanged so Claude Code automatically follows the latest Opus release. The minimum effort is `low`; legacy Codex `minimal` requests are still clamped to `low` because current Codex Responses requests may include tools that OpenAI rejects with minimal effort. Claude uses `--effort`; Codex uses `model_reasoning_effort`. Before Claude starts, status text says that the alias version is resolving; the worker then reads the concrete model ID from Claude CLI / Agent SDK's `system/init.model` event (and confirms/falls back via the primary assistant message's `message.model`), persists it as `resolvedAgentModel`, and force-refreshes the live header with a friendly version such as `Opus 4.8` or `Opus 5.0`. If Claude fails before emitting either event, no concrete runtime version is available. `vmJobRunner.js`'s `AGENT_CONFIGS` maps the agent to the matching E2B prebuilt template, credentials, and per-agent runtime: automatic Claude jobs call `claude -p … --model <id> --effort <level> --output-format stream-json`, interactive Claude jobs pass the same model ID to the Agent SDK bridge, and Codex calls `codex exec --model <id> -c model_reasoning_effort=medium --json`. Before each invocation the runner validates the active CLI against npm `latest`; only a missing, invalid, or older version is installed into `/home/user/.local`. Custom E2B template overrides are ignored.
- **Default model family (AT-2221)**: the user picks a _family_ — "Opus"/"Sonnet"/"Haiku"/"Fable" for Claude, "Sol"/"Terra"/"Luna" for Codex — never a concrete version, and it is stored **per agent** at `users/{uid}.defaultVmAgentModel = { claude, codex }` (written with a dotted field path so saving one agent cannot clobber the other's choice). Precedence matches `agent`/`agentReasoningEffort`: a **corroborated** explicit `agentModel` tool argument wins (AT-2224 — an uncorroborated one is dropped and resolves from the saved family), then the saved family, then the per-agent constant — so a user who never chose one behaves exactly as before. **The family is resolved to a model id at launch, not at save time** (`resolveAgentModelForRun` in `vmJob.js`), which is what makes "always the latest version of that family" true. `functions/Assistant/vmAgentModelCatalog.js` discovers families live from the providers' own `GET /v1/models` endpoints with the platform keys, parsing `claude-<family>-<major>[-<minor>]` and `gpt-<gen>-<tier>`, and caches the result in `vmAgentModelCatalog/{provider}` for 12h shared across all users (server-write/no client read — the default-deny rule already covers it, no `firestore.rules` change). **The two providers resolve differently on purpose**: Claude Code accepts `opus`/`sonnet`/`haiku` as _moving aliases_, so those are passed through unchanged and the CLI picks the newest release itself (the concrete id still comes back via `resolvedAgentModel`); families with no alias (`fable`, `mythos`, anything new) and every Codex tier are pinned to the newest discovered id. Codex additionally keeps only tiers present at the **newest generation** (major _and_ minor — matching the major alone would resurrect the retired `gpt-5.4` `mini`/`nano` next to `gpt-5.6`); Claude deliberately does not filter this way, since Haiku 4.5 is a whole major behind Opus 5 and still current. Degradation is total and silent: live → cached → **stale cache** (a real-but-old catalog beats a hardcoded one) → static fallback, and every failure path falls back to the previous default rather than blocking Settings or a VM run. `formatAgentModelLabel` is family-aware for every tier now (`Sonnet 4.6`, `Sol 5.6`), not just Opus.
- **OpenRouter models for the Codex harness (AT-2230)**: Codex speaks a plain OpenAI-compatible wire protocol, so it can drive any tool-calling OpenRouter model — the latest DeepSeek releases among them. Settings → Integrations therefore shows an **OpenAI / OpenRouter source toggle** under Codex (Claude has none: it cannot run one). **The source is encoded into the model string, not carried beside it**: `openrouter:deepseek/deepseek-chat` vs `gpt-5.6-sol`, decoded by `functions/Assistant/vmModelRouting.js` (`resolveModelRoute`). That is the whole design decision — a parallel `modelSource` field would have to be threaded through the tool argument, the `vmJobs`/`pendingWebhooks` docs, the settings map, `resolveAgentRunDetails` and the bridge input, and any one of them could drift out of sync with `agentModel`; one prefixed string cannot. It also means an old job doc still means exactly what it meant before. The selection shares the **Codex slot** of `users/{uid}.defaultVmAgentModel` (same question, one answer), and `resolveModelRoute` hands the CLI the **bare** id — the prefix is an Alldone marker and Codex would 404 on it. Three things differ from the OpenAI route and all three are load-bearing: the proxy route is `/openrouter/v1` (`vmLlmProxy` swaps in `OPENROUTER_API_KEY`, so the key never enters the sandbox exactly as for the other two); `wire_api` is **`chat`**, because Responses is OpenAI's own API and OpenRouter exposes the OpenAI-_compatible_ Chat Completions surface (asking it for `responses` fails at the first request with an error that reads like a proxy bug); and the proxy **injects `stream_options.include_usage`** into streaming requests, because Chat Completions omits `usage` from a stream unless asked — without it every streamed OpenRouter run would bill **zero** Gold, a silent revenue hole rather than a visible failure. Discovery is live from `GET https://openrouter.ai/api/v1/models` (public endpoint, cached in `vmAgentModelCatalog/openrouter` on the same 12h/degrade machinery), keeping only models whose `supported_parameters` include `tools` — a model without tool calling cannot run an agent loop at all — and excluding `openai/*`, which is already offered natively. **An OpenRouter run resolves its own credential slot** (BYOK, AT-2230): the user picks between **Alldone Gold** (the platform `OPENROUTER_API_KEY`) and **their own OpenRouter API key** in Settings → Integrations, exactly as for Claude/Codex, and a BYOK run pays no model-token Gold while still paying the 20-Gold base and 10-Gold-per-minute infra charges. What it must NOT do is inherit the Codex route: a ChatGPT subscription and a personal OpenAI key both authenticate against OpenAI and neither can serve DeepSeek, which is why credentials are keyed on a **credential provider** (`claude` | `codex` | `openrouter`, `resolveCredentialProvider` in `vmModelRouting.js`) rather than on the agent — the OpenAI and OpenRouter proxy routes share `expectedAgent: 'codex'` and are otherwise indistinguishable. OpenRouter is BYOK-or-Gold only; it sells no subscription to connect, so `providerSupportsSubscription` is false for it and the Settings card renders two routes, not three. The slot is persisted as `credentialProvider` on both job docs and encoded as `cp` inside the signed proxy token, and `vmLlmProxy` **rejects (403)** a BYOK request whose token provider does not match the route it arrived on. That check is load-bearing rather than defensive: before it, a Codex-BYOK job could call `/openrouter` — the token was valid (same agent), the job was flagged `tokenBillingExempt`, and `supportsByok: false` made the request fall back to the **platform** OpenRouter key, i.e. Alldone paying for tokens it charged no Gold for. **Gold is priced per model as a researched multiple of Sol**, which is the baseline and keeps the historical 100 tokens/Gold: `functions/Assistant/vmTokenPricing.js` is the single authority, and every other rate is `BASE * (blendedUsdPerMillion(Sol) / blendedUsdPerMillion(model))`, scaled as a divisor rather than a discounted price so the relationships survive any reprice of the base. Current rates (tokens per Gold): Sol 100, **Terra 250**, **Luna 2500**, DeepSeek V4 Pro 1800, V4 Flash 2800, V4 Flash 0731 4900, V3.2 820, deepseek-chat 490, **R1 180**, qwen3-coder 960, GLM-4.6 770, Kimi K2 Thinking 560. Two findings drive that table and both are counter-intuitive. First, **OpenAI's 2026-07-30 cut (Luna −80%, Terra −20%) made Luna 25x cheaper than Sol**, which overtook DeepSeek — so the previous "DeepSeek is 1/5 of Luna" rule billed every DeepSeek run below upstream cost, and Luna, not DeepSeek, is now the cheap tier. Terra (2.5x) and Luna (25x) are **exact and mix-independent**, because every Terra rate is 0.4x and every Luna rate 0.04x the matching Sol rate on input, cached input _and_ output alike. Second, the proxy meters one undifferentiated total-token number, so collapsing a three-part price list into one rate needs an input/output mix — and `OBSERVED_TOKEN_MIX` is **measured from production** (27 runs, 111.9M tokens), not assumed: **output is 0.4% of metered tokens and 85% are cache reads.** Prompt caching, not list price, therefore decides the real cost of an agentic run, which is why rates are **per model line, not per vendor**: `deepseek-r1` publishes no cache-read price, so it bills those 85% at full input price and lands at only 1.8x cheaper than Sol, while `deepseek-v4-pro` — dearer per output token — is 18x cheaper because its cache reads cost $0.003625/1M. A single vendor-wide DeepSeek rate would under-bill R1 by an order of magnitude. Two traps in that code, both of which silently make an uncached model look like the cheapest in the table: `Number(null)` is `0`, so a missing `input_cache_read` must be tested with `== null` **before** the numeric conversion (otherwise 85% of tokens price as free), and Luna's exact 0.04x arrives as `24.999999999999996` in binary, so quantizing to two significant figures needs a relative epsilon or it publishes 2400 instead of 2500. Prices come from **live** OpenRouter discovery first (`getOpenRouterUpstreamPrice`; the catalog now caches a `pricing` list covering every compatible model, not just the picker's top 40, and it is stripped from the client payload unless `includePricing` is set), then a **researched static table**, then the Sol base rate — never "assume it is cheap", because under-billing is a silent revenue hole while over-billing is visible and correctable. `startVmJob` resolves the rate **once** and freezes it as `tokensPerGold` on both the `vmJobs` and `pendingWebhooks` docs, so a catalog refresh mid-run cannot move what the user pays and neither charge site needs an async read inside its transaction. That single-authority module exists because the token charge is applied in **two** places that must agree exactly: `vmLlmProxy.chargeProxyTokenGold` bills incrementally against the run's cumulative token total while it streams, and `vmJobRunner.calculateCompletionGoldCharges` settles `round(total / rate) - alreadyCharged` at the end. Before it, the rate was a `const VM_TOKENS_PER_GOLD = 100` duplicated in `vmJob.js` and `vmLlmProxy.js` — and a drift between the two mis-bills invisibly in both directions: a higher settlement rate silently overcharges, a lower one clamps the subtraction to zero and hides the discrepancy. Both now call `resolveEffectiveTokensPerGold` on the same persisted job state (reading the rate from job state rather than the sandbox's request body also means a compromised agent cannot talk its own tokens down). **Native Anthropic models now use the same Sol-relative pricing path**, with version-specific official prices as detailed in the Anthropic Gold pricing note below. Only the **token** line moves: the 20-Gold base reserve and the 10-Gold-per-minute compute charge pay for the E2B sandbox, which costs the same whichever model the agent talks to. The hazard a bigger divisor introduces is rounding: at 4900 tokens/Gold a small request rounds to **zero** Gold 49x more often than at the Sol rate — safe only because both charge sites round against the run's _cumulative_ total, so dust is deferred and banked, never discarded. `formatVmBillingStatus` names the rate in the status comment (quoting the persisted rate, so the number shown is the number billed), since otherwise the only way to notice it is to compare Gold-history entries after the fact. **`OPENROUTER_API_KEY` needs THREE things, and two of them are easy to miss.** (1) It goes into the `GOOGLE_FUNCTIONS_ENV_DEV`/`_PROD` JSON blobs — a _key inside that JSON object_, not a standalone GitLab CI variable, which is what CI writes to `env_functions.json`. (2) It must also be listed in **`functions/envFunctionsHelper.js`**, which is an explicit **allowlist, not a passthrough**: a key present in the blob but absent from that map is silently `undefined` for every caller, with no warning and nothing failing at deploy time. This is precisely how AT-2230 shipped — the CI variable was set and `isOpenRouterConfigured()` still answered false, so the source toggle stayed hidden and every OpenRouter run was refused. `functions/envFunctionsHelper.test.js` pins it now. (3) The **Cloud Run runner image** needs it too, because `vmJobRunner` checks the key's presence before starting a sandbox — it comes from the same variable (`deploy:cloud:runner:*` writes the same blob into the image), but the image must be **rebuilt**, which CI does on any `functions/**` change. Without the platform key, Alldone Gold is unavailable for OpenRouter but **BYOK still works** — the platform key is only consulted on the Gold route. `startVmJob` refuses before charging any Gold in either direction (no platform key on the Gold route; no stored key on the BYOK route), naming the fix in both messages, because otherwise the proxy's rejection of the first request surfaces as a mid-run 503 after the base reserve and per-minute Gold have already been taken.
- **OpenRouter featured models + search**: the default OpenRouter picker is intentionally compact. For every major vendor in `OPENROUTER_VENDOR_ORDER`, discovery features the newest canonical model and the highest OpenRouter `agentic_index` model when that is different. Variants such as `:free` and `:batch` remain searchable but do not displace canonical recommendations. A client-safe `searchModels` index contains every compatible model for instant local Settings search; it deliberately omits pricing, while the server-only `pricing` index still covers the same full catalog. Saved non-featured models stay visible beside the featured choices. `setDefaultVmAgentModel` and `resolveFamilyToModel` validate/resolve against both lists, so a searched selection is a first-class persisted default rather than a UI-only escape hatch.
- **Model picker Gold rates use the billing authority**: every Claude, OpenAI and OpenRouter model entry returned to Settings carries a derived `tokensPerGold`, rendered as `1 Gold = N tokens`. `decorateCatalogGoldPricing` calls `vmTokenPricing.resolveTokensPerGold`, including the live OpenRouter price lookup already present in the cached catalog, so the picker cannot drift from launch-time billing. The raw OpenRouter `pricing` list remains server-only. Claude, OpenAI and OpenRouter therefore all display the model-specific rate used by launch-time billing.
- **Anthropic Gold pricing (2026-08-13)**: native Anthropic models use official Claude API input/cache-read/output prices through the same measured token mix and 100-token Sol baseline as every other platform-billed model. Prices are version-specific because Opus 4.1 is $15/$1.50/$75 while Opus 4.5+ is $5/$0.50/$25, and Sonnet 5 is $2/$0.20/$10 while Sonnet 4.6 is $3/$0.30/$15. Current moving-alias rates (tokens per Gold) are Opus 100, Sonnet 250 and Haiku 500; Fable/Mythos are 50. Concrete retired ids keep their own rate rather than inheriting the latest family price, and an unknown future id fails safe to Sol's 100 until its official price is recorded.
- **Optional personal subscription auth**: Settings → Integrations lets a user connect Claude (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) or Codex (`codex login` with `cli_auth_credentials_store = "file"`, then paste `~/.codex/auth.json`). Credentials live in `users/{uid}/private/vmAgentSubscriptions`; callable responses expose status only, never the secret. The job records whether subscription or Alldone API billing was selected and says so in both initial and live VM status text. API-billed runs use `vmLlmProxy` so platform API keys never enter the sandbox. Subscription runs bypass the proxy: Claude receives the OAuth token only in the process environment; Codex receives a mode-600 auth cache in `/home/user/.codex/auth.json`. The worker persists a refreshed Codex cache and removes it before pausing the reusable sandbox.
- **Detached Cloud Run Job + runtime errors**: `startVmJob` always launches one `vm-job-runner` Cloud Run Job execution through the Cloud Run v2 API instead of putting work behind Cloud Tasks' HTTP dispatch ceiling; there is no rollout feature flag. `vmJobConfig.js` sets an exact **five-hour agent runtime** split into **55-minute E2B leases**. At each boundary the runner disconnects the command stream, pauses and resumes the same sandbox, reconnects to the same PID, and reloads durable stdout/stderr from the VM. E2B's independent command-connection timeout is disabled (`timeoutMs: 0`) so it cannot kill the process after one hour; the runner supervisor is the authoritative limit. The Cloud Run task is deployed with a **5h45m timeout** for lease handoffs, artifacts, Gold settlement, result fan-out, refunds and sandbox cleanup. The runner claims a Firestore job lease and writes heartbeats so a duplicate/stale execution does not supervise the same paid run concurrently. It also transactionally leases each per-chat `vmSessions` sandbox before resuming it; overlapping work on the same thread is **queued** rather than run on a throwaway isolated sandbox (see the per-thread job queue section below), and command-channel timeouts or forced `-1` exits discard the unhealthy sandbox instead of preserving orphaned processes. Its typed timer maps timeout-shaped E2B errors to `The VM task exceeded its allowed execution time of 5 hours...` with `failureReason: runtime_timeout`. Build/deploy/IAM instructions are in `functions/Assistant/cloud-run-job/README.md`.
- **Persistent per-thread session (resume)**: each chat thread keeps one VM session. After a run the worker **pauses** the sandbox (snapshotting filesystem + the agent's session store) and records its id on `vmSessions/{projectId}__{objectId}`; the next `execute_task_in_vm` in that thread **resumes** it (`Sandbox.connect`) and runs the agent with `--continue` (Claude) / `codex exec resume --last` so it keeps prior files + conversation. `e2b@1.x` has no `pause()` — we POST the pause REST endpoint (`api.e2b.dev/sandboxes/{id}/pause`, `X-API-KEY`) directly; resume is `Sandbox.connect`, cleanup is `Sandbox.kill`. After a run the sandbox is **kept running for a ~10-min keep-alive window** (so back-to-back tasks in a thread hit a live VM with no resume latency); the `pauseIdleVmSessions` schedule (every 2 min) pauses sessions idle past that window, and `cleanupIdleVmSessions` deletes them after 7 days. The sandbox self-kill timeout (15 min) sits above the grace window + pauser interval so the pauser always pauses (preserving state) before E2B would kill the idle VM. `collectArtifacts` filters by `modifiedTime` so a resume only re-attaches files written in that run. Caveat: persistence is an E2B beta — validate across multiple resumes ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)).
- **A reused sandbox does NOT get a fresh hour, and `setTimeout()` will not give it one (PT-4747).** E2B grants a sandbox's hour at the **start of a session** — the `Sandbox.create` call, or a `POST /sandboxes/{id}/resume` — and a later `sandbox.setTimeout()` does not move that expiry. The call returns success and changes nothing, which is what made this invisible. Measured on **7/7** production sandbox deaths: every one landed 3598.7–3599.4s after that sandbox's last resume, never after its creation, while both the keep-alive `setTimeout(15min)` and the reuse `setTimeout(60min)` issued in between left no trace. So a sandbox reused inside the 10-minute keep-alive window (`status: 'idle_running'`, `wasPaused: false`) used to inherit only the **remainder** of that hour, while `runAgentInSandbox` recorded `sandboxLeaseDeadlineMs = Date.now() + E2B_SANDBOX_TIMEOUT_MS` — so `superviseVmCommand` budgeted a 55-minute slice and scheduled its protective rotation up to an hour **after** E2B had already killed the VM. The agent died mid-run and every following command 404'd — 10 times in the 7 days before the fix, and three at once on 2026-08-25 when three merge follow-ups were each approved into a warm sandbox already ~40 minutes into its hour (that clustering is why it looked like contention between "three simultaneously merging VMs"; it was three independent late reuses, not resource pressure). **The rule now is that a sandbox is only ever handed to a run through a fresh session**: `resumeVmSessionWithFreshLease` pauses a still-running keep-alive sandbox — pausing is what ENDS the running session — and then resumes it, while an already-paused one gets its new session from the resume it needs anyway. Both paths end in the same REST resume, so every run starts on the same predictable 60 minutes and there is no remaining-lease threshold to tune or get wrong. The cost is a few seconds of startup latency on a warm reuse, which is the deliberate trade against a run that starts instantly and then dies. Three things worth knowing: `readSandboxLeaseDeadlineMs` still **measures** the granted lease (`sandbox.getInfo().endAt`, bounded, falling back to the assumed value) so a lost pause race or a change in E2B's semantics surfaces as a shorter budgeted run rather than a sandbox dying under a running agent; a failed pause is deliberately **not** fatal, because the resume is what decides; and a vanished sandbox is recognised (`isE2bSandboxMissing`, keyed on E2B's quoted-id shape rather than a bare "not found", since an agent-exit error carries the model's own narration) so the session is discarded deterministically instead of via the `keep-alive failed — pausing instead` → pause-fails → kill cascade. Note the keep-alive window no longer buys instant reuse, only a warm sandbox to resume into; pausing at teardown instead would remove the reuse-time pause and the idle compute, and is the obvious follow-up.
- **A continued run keeps the agent its session was started with (AT-2240)**: the agent used to be re-resolved from scratch on every dispatch — corroborated tool override, then `users/{uid}.defaultVmAgent`, then the system default — with nothing consulting what the thread was actually running. Changing the Settings → Integrations default therefore switched a _live conversation_ to the other agent, and that switch is **destructive, not cosmetic**: the runner cannot hand a Codex sandbox to Claude (their session stores are not interchangeable), so `runVmJob` kills the sandbox (`discarding incompatible session`), drops the repo checkout and the whole agent conversation, and starts cold — the user asked to continue, read "🖥️ Spinning up Codex…", and lost what the thread was built on. `functions/Assistant/vmThreadAgentContinuity.js` inserts the thread's own agent into the precedence chain, so it is now **corroborated per-run request (AT-2224) > the thread's existing agent > saved default > system default**; `startVmJob` passes the pinned agent where it used to pass only the override. An explicit "use Codex" still switches — that is the deliberate cold restart, and it is the documented way to change a thread's agent. Three deliberate boundaries: (1) **only the agent is pinned** — model family, reasoning effort and the credential route (Gold/BYOK/subscription) are still re-resolved per run, because none of them invalidates a session (the same CLI resumes the same store) and freezing them would mean a thread could never pick up a model upgrade or a re-connected key; (2) **continuation is a state, not a time window** — the pin applies while there is something to continue (a `paused`/`idle_running` sandbox, or a run in flight/queued/blocked-on-interaction whose sandbox this job inherits), and **not** once the sandbox is gone, because the session doc outlives it by up to 7 days and a cold start is by definition a new run; (3) a corroborated **model** request belonging to the other agent ("continue, with opus" on a Codex thread) **steps the pin aside** rather than failing `normalizeAgentModel`. Legacy/partial session docs with no recorded `agent` fall through to the saved default, i.e. the old behaviour. When the pin overrides a changed default the status comment and the tool result both say so — otherwise it reads as the setting being ignored, which is the same complaint in reverse. The module is pure (the caller passes the already-read session doc, via `readVmThreadSession`, which now also feeds the occupancy peek — one read, two decisions).
- **Per-thread job queue (FIFO, one run at a time)**: a thread runs **one** VM job at a time. When `execute_task_in_vm` is dispatched for a thread whose VM is still actively running, the new job is **queued** (not run on a throwaway isolated sandbox) and runs on the **same** sandbox — resuming prior files + conversation — when the current job finishes (whether it succeeded or failed). Jobs run sequentially in dispatch order; the queue is unbounded (each queued job still reserves the 20-Gold base up-front, refunded on cancel/failure). Core logic is in `functions/Assistant/vmThreadQueue.js`, all keyed on the thread's `vmSessions/{projectId}__{objectId}` doc.
    - **State**: the session doc carries a `queue` array of correlationIds (+ `queueLength` for the sweeper's single-field query). Occupancy uses the **existing** runtime-lease fields (`activeLeaseOwner`/`activeLeaseExpiresAt`/`activeCorrelationId`); at dispatch a job takes a short **dispatch lease** (owner `dispatch:<correlationId>`, `VM_DISPATCH_LEASE_MS` = 5 min) that covers the launch→Cloud-Run-boot window until the runner claims its real runtime lease. **Dispatch/queue writes never touch `status`**, so a paused/idle sandbox stays flagged reusable and the incoming runner still resumes it. `claimVmSessionLease` was extended to take over a job's own dispatch lease (matched by `activeCorrelationId`), while still refusing a lease held by any **other** live job.
    - **Dispatch** (`vmJob.js` `startVmJob` → `admitVmJobToThread`): a read-only `isVmThreadOccupied` peek decides whether to **skip the cross-thread concurrency cap** — a same-thread follow-up is queued, not run, so it must not be rejected by the 10-job cap (the cap still rejects a _new_ job on a _different_ thread). The authoritative launch-vs-queue decision is the admission transaction. A queued job's `pendingWebhooks` doc is written with `status: 'queued'` (excluded from `countActiveVmJobsForUser`, so it never blocks other threads), and its status comment reads "⏳ Queued behind the current VM task…".
    - **Drain** (`vmJobRunner.js`): after a run settles — success, normal failure, unhealthy exit, or the pre-run cancel/credential early-returns — the owning runner calls `advanceVmThreadQueue` and, if a job was waiting, `launchQueuedVmJob` (flips `queued`→`pending`, launches its Cloud Run execution). Normal-failure keeps the sandbox (next job resumes it); unhealthy exit clears `sandboxId` but **preserves the queue** (next job starts cold) instead of deleting the session doc.
    - **Gold short-circuit** (`launchQueuedVmJob`): before launching a queued job it reads the user's live Gold balance; if it's below one VM minute's worth (`VM_MIN_GOLD_TO_LAUNCH_QUEUED = VM_GOLD_PER_MINUTE`) it does **not** burn a sandbox on a run that would immediately hit gold-exhaustion — it refunds the job's base reserve, settles it `failed`/`insufficient_gold` (in-app status comment updated), and drains to the next (same user → the rest of the queue cascades to the same outcome). The balance read fails open (a transient read error launches anyway and relies on the in-run gold-exhausted path). A Gold top-up between jobs is respected because the check is a live read at each launch. Note: the short-circuit updates the in-app comment only; it does not re-fan-out to WhatsApp/origin channels (the in-app follower notification still fires).
    - **Race + crash safety**: if a runner ever starts on a thread already held by another live job (the rare dispatch/claim race), it re-queues itself to the **front** and throws `VmThreadBusyError` — a clean deferral (no failure comment, no refund), relaunched by the current owner's drain. `drainStalledVmThreadQueues` (`onSchedule` every 2 min, `index.js`) is the crash backstop: it advances any thread with `queueLength > 0` whose lease has expired (owner died without draining) and relaunches the next job. A launch that fails definitively (or an ambiguous launch the reconciler later fails) also advances the queue so a follow-up is never wedged behind a job that never started.
    - **Cancellation**: cancelling a **queued** job (`cancelAssistantRunSecondGen` in `index.js`) settles it as `cancelled`, refunds the base Gold, removes it from the thread queue, and finalizes its status comment — it never sets `cancel_requested` (no runner would process it).
- **File/artifact return**: the agent is told to save deliverable files to `/home/user/output/` only when the user requested a file or the work genuinely produces an artifact; normal chat answers should stay in the final message with no generated output file. Before tearing down the sandbox, the worker pulls those files out (`sandbox.files.list/read`), uploads them to Firebase Storage at `attachments/{commentId}/{file}` (with a `firebaseStorageDownloadTokens` metadata token), and attaches them to the result comment. **Inline downloadable rendering requires embedding an attachment token in the comment text** — `${ATTACHMENT_TRIGGER}{url}${ATTACHMENT_TRIGGER}{name}${ATTACHMENT_TRIGGER}false` (trigger `EbDsQTD14ahtSR5`, see `components/Feeds/Utils/HelperFunctions.js`), which the chat parses into a `FileDownloadableTag`. The `mediaContext` array alone does NOT render an inline download, and a bare filename in the text gets auto-linkified to a bogus URL by `REGEX_URL`, so always use the token. We also store `mediaContext` for the assistant read-side. Caps: 10 files, 20 MB/file, 40 MB total. Uses the existing `roles/storage.admin` on the firebase-adminsdk SA.
- **Gold pricing is hybrid + metered** (`VM_JOB_BASE_GOLD` + `VM_GOLD_PER_MINUTE` + `VM_TOKENS_PER_GOLD` in `vmJob.js`): 20 Gold is charged up-front in `startVmJob` (refunded on failure), then the worker charges 10 Gold per started execution minute plus `round(totalTokens / tokensPerGold)` on completion. Tokens come from the agent's actual reported `usage` (Claude `result` event incl. `total_cost_usd`; Codex `turn.completed`), captured in the stream parser and stored on the `vmJobs` doc. When a personal Claude/Codex subscription is used, `tokenGoldTotal` is forced to zero; the 20 Gold base + 10 Gold per started VM minute still applies. API-billed token usage matches in-app assistant usage (100 tokens/Gold).
- **Cloud Tasks IAM (three grants, NOT auto-configured by `firebase deploy`)** — all on the firebase-adminsdk SA (see gotcha above): (1) `roles/cloudtasks.enqueuer` at the **project level** (queue-scoped was observed not to be honored for firebase-admin's `enqueue()`), (2) `roles/iam.serviceAccountUser` on the SA itself (`actAs`, to mint the task's OIDC token), and (3) `roles/run.invoker` on the **`runvmjob`** Cloud Run service (gen2 lowercases the function name) so Cloud Tasks can invoke the worker. The denials surface one at a time as you fix them (`cloudtasks.tasks.create` → `iam.serviceAccounts.actAs` → `run.invoker`). Run `functions/e2b-template/grant-enqueuer.sh <projectId>` once per environment after deploy; it auto-detects the SA and applies all three.
- **E2B SDK is pinned to `e2b@^1.x`** in `functions/package.json` — v2 cannot load under the CommonJS functions runtime (`ERR_REQUIRE_ESM` from its CJS bundle; `Dynamic require of node:url` from its ESM bundle under raw `node`). The Docker-free v2 **template build** tooling lives isolated in `functions/e2b-template/` (its own ESM package, run via `tsx`) and is excluded from the functions deploy via `firebase.json` `functions.ignore`.
- **Templates and CLI versions**: the worker always starts from E2B's managed `claude` or `codex` template, queries the selected package's npm `latest` version, and validates the active CLI before every run (including resumed sandboxes). Current CLIs are reused without calling `npm install`. For an install or upgrade, the runner takes a per-agent `flock`, temporarily moves only `/home/user/.local/bin/{claude,codex}` out of npm's link path, installs the exact resolved version, validates it, and restores the prior launcher if npm or validation fails. This avoids the managed-template `EEXIST` collision without `npm --force`. Bootstrap output is retained in bounded buffers; failures include sanitized npm stdout and stderr in logs and the job result. The legacy `functions/e2b-template` builder remains in the repository for reference but is not selected by the runner.
- Secrets `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `VM_PROXY_SIGNING_SECRET` are read via `getEnvFunctions()` (so they come from the `GOOGLE_FUNCTIONS_ENV_DEV` / `_PROD` GitLab variables that build `env_functions.json` in CI — add new keys into those JSON blobs, not as standalone CI variables).
- **LLM key never enters the sandbox (proxy)**: the real Anthropic/OpenAI key is NOT injected into the VM. The worker mints a short-lived, per-job, HMAC-signed token (`functions/Assistant/vmLlmProxy.js`, `mintProxyToken`) and points the agent at the `vmLlmProxy` `onRequest` function, passing the token in place of the key. Claude uses `ANTHROPIC_BASE_URL=<proxy>/anthropic`. Codex is configured per command with an explicit custom Responses provider whose `base_url` is `<proxy>/openai/v1` and whose `supports_websockets=false`; this is required because current Codex CLIs may otherwise open `wss://api.openai.com/v1/responses`, bypass the HTTP-only proxy, and send the proxy token to OpenAI. `OPENAI_BASE_URL` remains only as compatibility for older Codex CLIs. `vmLlmProxy` verifies the token (signature + expiry + agent-match), checks that the job can continue, swaps in the real key server-side, streams the upstream response, and accounts token usage. This means a compromised/prompt-injected agent (which runs with `--dangerously-skip-permissions` + internet) can at most leak a per-job token usable only against the proxy for its short TTL — not the permanent platform key. **`VM_PROXY_SIGNING_SECRET` is required**; if it or the upstream key/base URL is unavailable, VM execution fails closed. Rotating the secret instantly revokes all outstanding tokens. The proxy base URL defaults to the deployed function URL; override with `VM_LLM_PROXY_BASE_URL` if needed.
- **GitLab / GitHub coding flow (clone → code → optional Merge/Pull Request)**: a `prototype` VM task can run inside a checkout of the project's connected GitLab **or** GitHub repo and open an MR/PR only when it actually changed repository files. Wiring is per-provider but symmetric: per-project repo config (`gitlabRepoUrl`/`gitlabBaseBranch`/`gitlabHost`, or `githubRepoUrl`/`githubBaseBranch`/`githubHost`/`githubApiBase`) lives on the `projects/{projectId}` doc (non-secret, member-readable); the **per-user** token lives at `users/{uid}/private/{provider}Auth_{projectId}` (`gitlabAuth_…` / `githubAuth_…`, owner+server read only — never on the project doc). The `connect{Gitlab,Github}Repo` / `disconnect{Gitlab,Github}Repo` callables (`functions/Gitlab/gitlabConnect.js`, `functions/Github/githubConnect.js`, registered in `index.js`) validate the token + repo against the provider REST API and persist it; the UI is `components/ProjectDetailedView/ProjectProperties/ConnectGitLab/` + `ConnectGitHub/` (mirror ConnectGmail, but a simple paste-token form). In `vmJobRunner.js`, `loadRepoContext()` reads the repo + the **requesting user's** token (GitHub preferred if both are connected), and `setupGitRepo()` clones (fresh) or fetches (resume) into `/home/user/repo`. The runner does **not** install repository dependencies before starting the agent; the agent installs them lazily with the repository's package manager only when the requested change or necessary validation requires them. `buildAgentPrompt()` branches on provider: **GitLab** → branch/commit/push with **push options** (`-o merge_request.create …`, no `glab`/API needed); **GitHub** → push then `gh pr create` (gh baked into the E2B template; falls back to the REST API via curl). The E2B sandbox is created/connected with internet access enabled, and Codex is invoked with `sandbox_workspace_write.network_access=true` because Codex has its own inner command sandbox; GitHub is normal outbound HTTPS traffic, not a special E2B permission, though transient DNS/network errors should be retried. The agent returns the MR/PR URL in its final message when one is opened, or explains that no MR/PR was opened because no code change was needed. For task threads, the newest VM run that returns an MR/PR becomes the canonical `vmMergeRequest`; thread-run ordering plus transactional status writes prevent delayed older runs or refreshes from restoring a previous link. **Security**: the token is injected ONLY as a per-command env var (`GIT_TOKEN`, plus `GH_TOKEN`/`GITHUB_TOKEN` for GitHub) and a git credential helper that resolves `$GIT_TOKEN` at push time (username `oauth2` for GitLab, `x-access-token` for GitHub) — never written to `.git/config`, `prompt.txt`, logs, or the paused-session snapshot. Recommend users supply a repo-scoped token (GitLab **Project Access Token** `api` + `write_repository`, Developer+; GitHub **fine-grained PAT** with Contents + Pull requests read/write) and keep the base branch protected so the agent can only open MRs/PRs, not push to it or merge.
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
- **Deploy**: `firebase deploy --only functions:runGoldenBuild,functions:rebuildProjectVmGolden,functions:cleanupUnusedVmGoldenSnapshots` (use the repo-pinned `firebase-tools@13.29.3` — newer CLIs reject pre-existing 3600s scheduled-function timeouts elsewhere in `index.js`); **also rebuild the `vm-job-runner` Cloud Run Job** because the golden **seeding + drift + prompt** changes live in `vmJobRunner.js`, which runs in that image, not the Functions runtime. **CI now does this automatically**: `deploy:cloud:runner:{staging,production}` in `.gitlab-ci.yml` runs `deploy.sh` with `CI_MODE=1` (skips one-time project setup) on any `functions/**` change, authenticating as the `firebase-adminsdk` SA — which therefore also needs `roles/cloudbuild.builds.editor` + `roles/run.developer` + `roles/artifactregistry.writer` (granted alongside the golden Cloud Tasks roles). For a manual rebuild: `functions/Assistant/cloud-run-job/deploy.sh <projectId>`. Then run `functions/Assistant/grant-golden-builder-task-worker.sh <projectId>` once per env (grants the three Cloud Tasks roles to the **firebase-adminsdk SA** — enqueuer at project level, self `actAs`, `run.invoker` on the `rungoldenbuild` service; IAM propagates in ~7 min). **Gotcha — staging has TWO `firebase-adminsdk` SAs** (`-5wi3r` and `-9idaq`); the script auto-picks the first alphabetically, which may not be the cert SA the runtime authenticates as, so grant to **both** (`grant-golden-builder-task-worker.sh <projectId> <sa-email>` for the second). **No Firestore rules change**: `vmGolden` is a non-secret, member-readable field on the project doc, written by the Admin SDK (which bypasses rules). A member could in principle write a bogus `vmGolden` client-side, but the cold-start fallback + self-healing rebuild neutralize it; an optional field-diff guard on the `projects` update rule is the hardening if ever wanted (none exists on that doc today).
- **Caveat**: E2B snapshot persistence is beta ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)). **Validation checklist (run against your E2B account — cannot be unit-tested):** (1) trigger a build (connect a repo, run a VM task or press Rebuild) and confirm `projects/{projectId}.vmGolden.status` flips `building → ready` with a `snapshotId`; (2) run a fresh cold job and confirm the log line `creating sandbox … fromGolden:true` and that `node_modules` is present without an install; (3) change the lockfile and confirm the next cold job enqueues a rebuild while still running; (4) delete the snapshot in the E2B dashboard and confirm a cold job falls back to the managed template and re-enqueues a build.

### Assistant heartbeat scheduler

- Heartbeats are registered per assistant/user in the server-only `assistantHeartbeatSchedules` collection. `checkAssistantHeartbeats` only dispatches schedules due in the next five minutes; `runAssistantHeartbeat` performs one at-most-once occurrence through Cloud Tasks with five concurrent workers.
- Run `node migration/backfillAssistantHeartbeatSchedules.js --firebase-project-id=<project> --execute` after deploying the worker and indexes. Without `--execute` the script is a dry run.
- Cloud Tasks IAM must be granted to the **firebase-adminsdk SA** after deploying `runAssistantHeartbeat`. Run `functions/Assistant/grant-heartbeat-task-worker.sh <projectId>`; it grants project-level enqueue, self `actAs`, and `run.invoker` on the worker.
- Rollback requires pausing or purging the `runassistantheartbeat` task queue before restoring the legacy scanner. Legacy assistant heartbeat status maps are intentionally retained.

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
- Cloudflare worker deployment should be run from `cloudflare/email-worker/` under Node 20, not from the repo-wide Node 14 environment

### CI/CD & Deployment

- **GitLab CI/CD**: All deployments are handled via GitLab pipelines (`.gitlab-ci.yml`)
- **Environment secrets**: Stored in GitLab CI/CD variables, not in the repository
- **Branches**: `develop` deploys to staging, `master` deploys to production. Note
  `develop` has drifted far behind (~1660 commits as of 2026-08-05), so the practical
  pre-merge QA surface for a feature branch is the **manual `deploy:web-webpack-preview`
  job**, which publishes a Firebase hosting preview channel `webpack-<ref-slug>` on the
  staging project.
- **Manual QA that involves signing in must run on staging live
  (`deploy:web-staging-live` → https://alldonestaging.web.app), NOT on a preview
  channel.** Preview channels get a fresh random origin
  (`alldonestaging--webpack-<ref>-<hash>.web.app`) that is not in the Google OAuth
  client's authorized JavaScript origins, so Google sign-in fails there and the app is
  untestable past the login screen (hit 2026-08-17 QA-ing the offline-support branch).
  Preview channels remain useful only for compile/render smoke checks of the
  logged-out surface. Deploying a feature branch to staging live is last-writer-wins
  over whatever was there — fine for QA, just say so if others are testing.
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
  its scope is `git diff <marker> <HEAD>` against `ci/deploy-scope/<target>.paths`. That is
  inherently catch-up: whatever a skipped pipeline left behind is still missing from the
  marker, so the next pipeline ships it alongside its own change, and a target whose paths
  have not moved is still skipped, so the steady-state deploy count is unchanged. `compute`
  runs once per pipeline (`deploy_scope`) and publishes `deploy-scope.env`, so a build, its
  tests and its deploy can never disagree about whether they are shipping — which is why
  `build_web_production` and `test:web:full` are no longer `changes:`-scoped on master either
  (they feed `deploy:web` through `needs`, so being absent from the catch-up pipeline would
  make `needs` unresolvable). Exit `76` means "already up to date", declared alongside `75` in
  `allow_failure.exit_codes`. **Every uncertain path resolves to deploying**, never to
  skipping: a redundant deploy is visible and cheap, a silently skipped one ships nothing.
  Note a job with an explicit `needs` list loses the default "artifacts from all earlier
  stages", so it must name `deploy_scope` or it silently falls back to deploying always.
  **Recording a marker pushes a tag, which `CI_JOB_TOKEN` may not do** — it needs a project
  access token with `write_repository` in the masked CI/CD variable `DEPLOY_MARKER_TOKEN`.
  Until that exists `record` warns and no-ops, every target falls back to the old push-range
  comparison, and behaviour is exactly what it was before (hole included); the first
  successful deploy after the variable is added lays the marker and switches catch-up on.
  Tag pushes cannot trigger pipelines here — the `workflow` rules only admit pipelines that
  have `$CI_COMMIT_BRANCH`. Pinned by `__tests__/CiDeployScope.test.js`, which also fails the
  build if `ci/deploy-scope/web-production.paths` drifts from the `*web-relevant-paths` anchor.
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
  `:$CI_COMMIT_REF_SLUG`, selected by the consuming jobs through a rules-level
  `APP_IMAGE_TAG` (default `latest`); `:latest` is still only ever written from
  develop/master, because master builds from it. Two consequences: the branch's first
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
  (`build_base:<ref-slug>`, `build_web_bundler:<ref-slug>`) accumulate one per
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
