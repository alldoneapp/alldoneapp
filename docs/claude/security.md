# Security: callables, server fan-outs, outbound fetches, iOS bridge

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## A callable acts as `request.auth.uid`, never as an id from `request.data` (security audit 2026-11)

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

## Assistant memory is private to the user (NV-20)

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

## Server fan-outs and public endpoints trust nothing the client wrote (security audit 2026-11)

Follower lists are member-writable and outlive membership, so `TaskCommentService`,
`ObjectCommentService`, the VM completion path and the chat email sender intersect recipients with
`projects/{id}.userIds` (`shared/projectMemberRecipients.js`); removing a member also cleans the
project's `followers` documents. `/api/booking/book` is rate limited per IP, page and recipient
(`Booking/bookingRateLimit.js`, server-only `bookingRateLimits`, hashed ids; give it a TTL policy on
`expiresAt`) and its visitor mail has a fixed subject and no echoed note. Chat media are fetched only
from this project's Storage bucket, without redirects (`shared/storageMediaUrl.js`).

## The iOS shell answers native bridge calls from its own main frame only (NV-33)

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

## A server-side fetch of a URL somebody else chose goes through `shared/outboundUrlGuard.js`

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

## Video conversion only ever reads an object the app uploaded (NV-30)

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

## `ipRegistryLookup` looks up the caller and nobody else (NV-24)

It used to put a caller-supplied `data.ip` into the ipregistry URL path (any address, or 1024 of them
comma-separated, on our paid key), and the app's own call without `ip` geolocated the Functions
egress address rather than the user. It now ignores `request.data` and looks up one address: the
rightmost public `X-Forwarded-For` entry (Google's front end appends what it saw; `req.ip` under the
framework's `trust proxy` is the leftmost, client-controlled one), encoded, 10 lookups per user per
day (`shared/callableRateLimit.js`). Any failure returns the United States fallback the client
already handles. Pinned by `functions/IpRegistry/ipRegistryLookup.test.js`.

## A deleted project's id is tombstoned and its every root removed (NV-26)

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

## Project skill catalogs authorize on the project document (NV-18)

`requireSkillWriteAccess` (`functions/Assistant/assistantSkills.js`), the gate of
`uploadAssistantSkillFile` and `importAssistantSkillsFromRepo` for a project catalog, used to read the
caller's `users/{uid}` membership arrays, which the owner can write. It now reads
`projects/{projectId}.userIds` through `isProjectMemberData`, the authority the rules and
`assertProjectAccess` use. Any new Admin SDK gate must do the same: the user arrays may only nominate
candidate projects (`filterMemberProjectIds`). Pinned by `assistantSkillsProjectScope.test.js`.
