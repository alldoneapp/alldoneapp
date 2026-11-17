# Email: Gmail labeling, email line, inbound Anna email, OAuth

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Gmail Follow-Up Tasks

- Gmail follow-up tasks created from labeling prompts use `task.gmailData.origin === 'gmail_label_follow_up'`.
- These tasks must stay in the normal task list, not the dedicated Gmail/email task bucket. Only inbox-summary Gmail tasks should be treated as email tasks.
- Do not rewrite or sanitize the task title text for Gmail follow-up tasks. If the assistant-created title contains a Gmail link, leave it as-is.
- In the task list row, the Gmail affordance should be rendered as an inline left tag/chip using `SocialText`'s `leftCustomElement`, not as an absolutely-positioned icon. This keeps wrapping correct so continuation lines align under the chip instead of under the first text token after it.
- Opening a Gmail follow-up task from the chip should target the specific Gmail message and should prefer an account-aware URL flow. Current helpers live in `utils/Gmail/gmailTaskUtils.js` and `functions/Gmail/serverSideGmailLabelingSync.js`.

## The email line summary is reused while the mailbox is unchanged (AT-2913)

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

## An email handled in Gmail marks its Alldone email comment as read (AT-2376)

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

## An email conversation gets its own private topic (decision 2026-11-09)

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

## The email a task was created from opens the task's chat (AT-3022)

`continueEmailThread` only writes the **later** mail of a thread into its task's chat, and skips the
email the task was created from because the task already lists it. So a task chat used to start with
the second email. Both creation paths (the labeling run's `create_task`, via
`addOriginEmailToCreatedGmailTasks`, and the email line's "Create task") now call
`appendOriginEmailToTask` once the task exists. The line is sender, date and the provider snippet
(`buildReceivedMessageText`, max 300 characters). Decided with Karsten 2026-11-13: no model summary
and no Gold. It uses the continuation comment id (`email_<messageKey>`), so a retry never duplicates
it. It is silent (the new task already notified) and backdated to the email's received time
(`TaskCommentService.addComment({ createdAt })`, never in the future), so it sits above the "added
this task" lines. Mail the owner sent appears as the owner's message (`direction: 'outgoing'`). The
line is best effort and never fails the created task. A continued or reused task gets none. Existing
tasks were not backfilled. Pinned by the "the email a task was created from" block of
`emailThreadContinuation.test.js` and the AT-3022 cases in `emailLineService.test.js` and
`serverSideGmailLabelingSync.test.js`.

## One email address can belong to several accounts, and a connected mailbox has to prove itself (AT-2483)

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

## An OAuth connect is completed only by the browser that started it (NV-23)

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

## An Anna email names an account only when DKIM proves the sender (NV-06)

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

## `users/{uid}.email` is not an identity another system may trust (AT-2908)

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

## alldone.team pages in the IframeModal are billed by alldone.team's server

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

## Over email, Anna may change only the calendar events she created over email

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
