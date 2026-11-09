# Project artifacts

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Project artifacts are code, and are never served from the app's origin

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
