# Firestore/Storage rules and access boundaries

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## A project shared "With link" may be opened by id, never listed (incident 2026-11-08)

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

## A member-written link only ever opens as a web link (security audit 2026-11)

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

## What a Firestore trigger reads from a client document must be bound by the rules (security audit 2026-11)

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

## Joining a project is a server operation (`joinProjectSecondGen`)

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

## Every `<origin>/<name>Callback` a function builds needs a hosting rewrite

OAuth redirect URIs are built on the app origin (`https://my.alldone.app/googleOAuthCallback`,
`/microsoftOAuthCallback`, `/mcpClientOAuthCallback`, `/mcpOAuthCallback`). Without a rewrite in
`firebase.json` the provider's redirect falls through to `** -> /index.html` and the code lands in the
SPA: `/microsoftOAuthCallback` did exactly that in production until it got its rewrite. Add the
rewrite (above `**`) and the service worker's `NAVIGATION_DENYLIST` entry with the function;
`__tests__/OAuthCallbackHostingRewrites.test.js` scans `functions/` and fails otherwise. The redirect
URI must also be registered with the provider (Google Cloud console / Microsoft Entra app).

## Storage rules (`storage.rules`, `storage.notes.rules`)

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
