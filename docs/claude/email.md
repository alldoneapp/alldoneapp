# Email: Gmail labeling, email line, inbound Anna email, OAuth

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Gmail Follow-Up Tasks

- Gmail follow-up tasks created from labeling prompts use `task.gmailData.origin === 'gmail_label_follow_up'`.
- Since AT-3151 every email task, these included, is listed under Messages on the open-tasks board (see "All email tasks under Messages" below). The old rule "follow-ups stay in the normal list" no longer holds.
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

## Chats > Unread is a list of messages with tags; newsletters and ads can archive themselves (2026-11-18)

Decided with the product owner from mockups (variant A). The "Unread" chat filter no longer lists
topics with previews: each project shows every unread message of its unread chats as one row
(sender, tag, summary, time; archive for emails, mark as read, open the chat), filtered by tag
chips and sorted by newest or sender (`components/ChatsView/UnreadTriage/`). The "All" filter is
unchanged. The "Unread" chip counts **messages**, not chats (`getUnreadMessageCount`: per chat
unread for the tab, the messages the list shows - followed ones if any, else unfollowed), so it
equals the "All" tag chip and the red chats badge in the top bar; for that the list loads every
unread chat of a project (`UNREAD_LIST_CHAT_LIMIT`, 50) instead of the first page. Layout
(2026-11-18, second round): one filter row - "All | Unread N", a divider, the tag chips (Unread
itself means every tag, a tag chip toggles), sort and settings as icons at the right end; each row
has the avatar top-aligned with a short time under it (`formatRowTime`: time today, day and month
this year, two-digit year before), and the message text as plain text: `stripMarkdownForPreview` in
`functions/Utils/parseTextUtils.js`, because SocialText turned an assistant's "## Heading" into a
"##" hashtag chip. The MyDay "Last comment" block uses the same helper, applied before the line
breaks are joined (`LastAssistantCommentWrapper`, `LastCommentText`). Pressing an email row opens the
email in Gmail in a new tab (`getRowEmailUrl`, the link the thread's "Email" chip opens); the chat
icon at the right end opens the thread, and any other row opens its chat. Opening the email marks
nothing read here; the Gmail read sync clears the row once the mail is read or archived there. "Mark as read" on a project line marks only the filtered rows while a tag is selected
(`UnreadTriageMarkAsRead`); the "Archive emails" buttons already act on what the rows register.

**A tag that matches nothing in a project hides the project (AT-3112, 2026-11-19).** In All Projects,
a selected tag chip with no row left in a project hides that project's whole section (header and the
"Nothing unread with this tag" line): `UnreadMessagesList` reports `onFilteredEmptyChange` and
`ChatsByProject` sets `display: 'none'` on the `ProjectSection`. Hidden, not unmounted: the list
holds the comment subscriptions that bring the section back when the tag changes or a matching
message arrives, and keeps feeding the email registry. Without a tag nothing is hidden, so an unread
chat whose messages are missing keeps its "Mark as read". When the tag matches nothing anywhere,
`UnreadTriageEmptyState` (via `isTagFilterEmptyEverywhere`) shows one global "Nothing unread with
this tag", but only once every project with unread chats has registered `loaded` (all its chats'
first snapshots), so it does not flash while messages arrive. The single-project view keeps its
header (it carries the page navigation) and the local line.

**Unread comments are read by id, never as "the newest N" (AT-3149, 2026-11-24).** The chip said
"Unread 2" and the list showed one email: `useGetUnreadChatMessages` read the newest "unread + 5"
comments of the chat and kept the unread ones. In a "Daily emails" topic newer emails are read or
archived (Gmail read sync, auto-archive) while an older one stays unread; in production the unread
GameStar newsletter was the 8th newest of 38 comments, outside the window of 7, so it had no row (and
no "Newsletters" chip) while the chip counted its notification. The hook now listens to exactly the
unread comment ids (`utils/backends/Chats/watchCommentsByIds.js`, `documentId() in` chunks of 30,
newest 100 per chat) and sorts them into thread order. The chat row previews under "All" use the same
hook. Pinned by `hooks/Chats/useGetUnreadChatMessages.test.js`, whose fake Firestore offers only the
by-id query.

**An emptied tag moves on to the next tag with unread messages (AT-3120, 2026-11-20).** When the
selected tag chip (e.g. "Ads") drops to zero, the next tag in `UNREAD_TAG_ORDER` that still has
messages is selected, wrapping around to the start (Karsten: wrap, not back to "Unread"), whatever
emptied it (row/line actions, the Gmail read sync, another device). Only the tag changes; project
and Unread filter stay. `useAutoAdvanceUnreadTag` (called by `UnreadTriageTagChips`) arms a tag only
once it was seen with messages in a fully loaded scope, decides only when every registered project
of the scope is `loaded`, and disarms when the scope (selected project) changes, so selecting a tag,
switching project or a chat still loading never jumps. With no other tag left it does nothing: the
tag's empty state shows and the existing flows (AT-3104/3108 redirect, ChatFiltersLine leaving
Unread at 0) take over. Pinned by `unreadTagAutoAdvance.test.js`.

**A row shows the whole message and grows with it (AT-3094, 2026-11-18).** The second round capped
the summary at 320/160 characters and `maxHeight: 3 * body2.lineHeight` with `overflow: hidden`. That
cut the third line in half: SocialText with `wrapText` renders each word as its own flex item with
`marginTop`/`marginBottom: 3` (`WordsList` `wrappedText`), so a wrapped line is 28px, not 22px, and
66px holds about 2.4 lines. The product owner then chose the whole message over a summary: no
character limit, no line clamp, no height cap; words carry `overflowWrap: 'anywhere'` so a long hash
or path breaks inside the column; the action icons sit at the top of the row (next to the sender)
instead of centred, so they stay in the same place however tall a row gets. A line height or clamp
on SocialText has to count the 6px word margins. Pinned by `UnreadMessageRow.test.js`.

**The preview is capped by characters again (AT-3106, 2026-11-18).** The product owner then asked
for a maximum length with "...": a row previews at most 320 characters (160 on a phone,
`getUnreadSummaryLimit`) via `shortenUnreadSummary` in `unreadMessageTags.js`. The character limit
is the only cap: still no line clamp and no height cap (see above). The cut falls between words,
because mentions, hashtags, links and encoded images/attachments are single words and half of one
renders as a broken chip or a wrong link; only a preview with no space at all is cut inside the
word. `row.summary` stays whole: the row's accessibility label and the opened chat keep the full
message. The chat list's per-topic previews (`ChatItemUnreadMessage`) are not shortened; they render
the thread body on purpose. Pinned by `UnreadMessageRow.test.js` and `unreadMessageTags.test.js`.

**On a phone the row's actions stack (AT-3107, 2026-11-18).** Side by side, archive / mark as read /
open chat took 3 x 32px + 8px of a ~390px screen; the message wrapped into a narrow column and the
sender + tag (both `flexShrink: 0`) ran under the archive icon. With `smallScreenNavigation` the
actions are one column at the top right (`actionsMobile`), each still a 32 x 32 touch target, and
the tag may shrink with "..." (`tagMobile`; the chat title that gives way on desktop is hidden on a
phone). Desktop is unchanged. These are the per-message actions, not the project line's header
buttons. Pinned by the AT-3107 block in `UnreadMessageRow.test.js`.

**Where a tag comes from.** "Needs action" is not a tag: an actionable email becomes a task and an
email that needs a reply goes to Messages (UNIFIED_INBOX_PLAN.md), so an unread email comment is
informational by construction. The classifier now also returns `emailKind` (`person`, `newsletter`,
`notification`, `ads`; `null` when missing or unknown, kept from the first pass when the auditor
omits it). The sync writes `labelKey`, `labelName`, `emailKind`, `fromName`, `fromEmail` onto the
comment's `gmailData` (`buildGmailCommentTagFields` in assistantHelper). Tag rule, the same on
both sides (`resolveUnreadEmailKind` / `getUnreadMessageTag`): label `ads` → Ads, label
`newsletter` → Newsletters, otherwise `emailKind`; in the default mode every other label is a
project and says nothing about the kind. Comments from before this have no fields and show as
"Other emails"; the row then reads the sender back from the "Email from X (x@y): summary" line. A
chat comment is "From people" or "Assistant"; one an MCP client wrote in the user's name
(`via: 'mcp'`, mcp.md) counts as "Assistant" and its sender reads "Karsten Wysk (via Claude)"
(`withMcpActorLabel`), as in the thread.

**`users/{uid}.unreadEmailSettings`** (`{ newsletter, ads }`, each `show` | `archive`, default
show; whitelisted in `mapUserData`). With `archive` the labeling sync archives an incoming,
informational, no-reply-owed email of that kind in Gmail (on top of the label's own
`autoArchive`, also under a fallback label, AT-3102 below) and passes `suppressUnread`, so `add_chat_comment`
writes the comment without its `chatNotifications` doc and without the MyDay "last assistant
comment" pointer. Actionable mail and mail needing a reply are never affected. The archive rides on
the same Gmail call as the label, so a failed write leaves the email in the inbox, unread and
unlabeled, and is retried (AT-3102 below). The audit record keeps `emailKind` and
`archivedForUnreadSettings`, and a pending thread continuation replays both.

**One ads switch.** The per-connection "Auto-archive Ads" (`adsAutoArchive` on the gmailLabeling
config) is merged into `unreadEmailSettings.ads`: the Gmail labeling settings show the same user
switch (`isAdsArchived`) and save it at once, and `resolveEffectiveGmailLabelingConfig` sets the
built-in Ads label's `autoArchive` from it (`resolveAdsUnreadSetting`), so a label correction to
Ads archives by it too. A user who never chose keeps the connection's old value; the first sync
copies it onto the user once (`migrateAdsAutoArchiveSetting`; an explicit `show` is never
overwritten, a failed copy still applies for that run). `adsAutoArchive` stays in the config only
as that fallback.

**Ads reach the unread list as "Daily ads" lines (AT-3101, decided with Karsten 2026-11-18).** The
built-in Ads label has no post-label prompt, so until then an ad produced no chat comment and never
appeared under Chats > Unread, whatever the ads setting said. Now every incoming ad no prompt
handles (the Ads label, or a fallback-labeled email with `emailKind: 'ads'`; a label with its own prompt
keeps its prompt) gets one line in a **private** topic `Daily ads <date>` in the user's default
project (`functions/Gmail/dailyAdsDigest.js`, called from `executePostLabelPrompt` after thread
continuation). Choices: its own topic rather than the project's "Daily emails" digest; **no model**,
the line is `Email from <name> (<email>): <subject>`, so no Gold per ad and the promotional text never
reaches a model with tools; `isPublicFor: [owner]` (the digests are project-wide, someone's ads are
not project content) with a deterministic chat id per user and day (`DailyAds_<sha1(uid:date)>`),
because `add_chat_comment`'s lookup by title would find another member's topic of the same name.
The ads setting decides read or unread exactly as for newsletters: `show` writes it unread, `archive`
archives the mail and stores the line read (`suppressUnread`). The author is the default project's
assistant; without one the action is `blocked` and nothing is written. The fallback-label path also
stamps `emailComments` for the read sync, so a line for an ad no label matched clears once Gmail reads it.

Pinned by `functions/Gmail/dailyAdsDigest.test.js`, the AT-3101 block of
`serverSideGmailLabelingSync.test.js`, `functions/Gmail/unreadEmailSettings.test.js`, the "unread setting" block and the Ads
label case of `serverSideGmailLabelingSync.test.js`, `ChatFiltersLine.test.js` (message count), the emailKind block of `gmailPromptClassifier.test.js`, the
tag-field cases in `assistantHelper.test.js` and `components/ChatsView/UnreadTriage/*.test.js`.

**Clearing the last unread messages of the Chats view: grey unread, then tasks (AT-3104, decided
with Karsten 2026-11-18, revised 2026-11-19).** `components/ChatsView/lastUnreadRedirect.js`. Red
unread = chat notification `followed: true` (`totalFollowed`), grey = `followed: false`
(`totalUnfollowed`); the Followed tab lists only red, the All tab both. **The view decides**: the
selected project, or in All Projects every project counted like the Chats tab chips (archived and
template projects excluded). The first version checked only the touched project, so in All Projects
clearing "Privat" opened Privat's tasks while "Alldone Business" was still unread (the 2026-11-19
report; production logs showed archives of both projects seconds apart). Now: nothing red or grey
left in the view -> the selected project's open tasks, or the All Projects task list; the press
cleared the last red message on the Followed tab and grey remain -> switch to the All tab (the
Unread filter kept as it was, since `Set chats active tab` resets it); anything else -> stay. Armed
only by a press in the Chats list (row Archive / Mark as read, preview Archive, project line and All
Projects line Mark as read / Archive emails, More > Mark as read), never by the initial load, the
Gmail read sync or another device.

**AT-3108 (2026-11-19, replaces !915): at once, and back to the last task list.** !914 waited for
the action to settle, and an archive settles only after the Gmail archive plus a forced summary
refresh (4-8s, longer cold): the row vanished, nothing happened, and any click in between cancelled
the jump. The store is now watched from the press on and the same view rules are applied to the
LOCAL counts, which the archive clears first (AT-2424); the grey switch is immediate too, and after
it the watch keeps going in the All tab (a bulk action clears one project at a time, so "no red,
grey left" can be a step on the way to "nothing left"). Overlapping presses in the same view share
one watch until the last settles (+2s window for a late local snapshot); a failure before the
decision ends it; any change of the captured view (route, project, Chats tab, Unread filter, user)
ends it. A failure after the redirect still restores the unread state; the row alerts as before, the
bulk "Archive emails" buttons (`notifyOnError: false`) now alert too when `leftChats()`, since their
red "try again" is off screen. Target: the task list last on screen (`createTaskListMemory`, fed
from App.js's store): All Projects or the project, the board (`currentUser`: own, colleague,
contact, assistant, workstream; Karsten: "genau dieses Board") and the Open/Workflow/Done (In
progress) toggle. Board owner not loaded in the project any more -> the user's own tasks there (In
progress mapped to Open). Nothing remembered -> the !914 target (selected project's open tasks, or
All Projects). All archive presses go through the provider's wrapped `archiveLinkedEmails`. The thread view
(ChatBoard) is out of scope. App.js hands the store in (`configureLastUnreadRedirect`); the module
must not require the store itself: that cost ~4.4s in a cold Jest cache and timed out the first
archive test on master pipeline 3085791241. Pinned by `lastUnreadRedirect.test.js` and
`lastUnreadRedirect.wiring.test.js`.

## Every email gets a Gmail label: fallback labels and bounded retries (AT-3102, 2026-11-18)

**The invariant.** The project wiki (Email Management) says every incoming email gets a label, with a
default when nothing matches; there is no "no label" outcome. Until AT-3102 the code did not do that:
a `matched:false` result, or a pick below the confidence threshold (`coerceClassifierResult` in
`gmailPromptClassifier.js` turns it into `matched:false`), wrote **no** Gmail label and an audit record
with `skippedReason: 'no_match'`. The reported case was a subscribed Modash newsletter in
karsten@alldone.app (`emailKind: 'newsletter'`, confidence 0.9, "not Ads, no configured project"); in
the week before, about 16% of that account's incoming mail stayed unlabeled the same way.

**Fallback label** (`resolveFallbackLabelDefinition` in `serverSideGmailLabelingSync.js`), chosen
with Karsten:

- `emailKind: 'newsletter'` → the built-in **`Newsletter`** label (key `newsletter`, top-level like
  `Ads`). A configured label with key `newsletter` (custom mode) is reused instead.
- anything else → the connection's **default project label**: the label whose `sourceProjectId` is
  the effective config's `defaultProjectId` (the config's `projectId`, else the user's default
  project; `resolveEffectiveGmailLabelingConfig` returns it).
- no default project label (custom prompt mode, or the default project archived, inactive, a
  template, or gone) → the built-in catch-all **`Alldone/Other`** (key `alldone_other`). Never no
  label.

The prompt is unchanged: the classifier may still answer `matched:false`, and the sync labels anyway.
The fallback applies to `no_match`, `below_threshold` and `missing_label_definition` (a key that no
eligible definition has), for incoming and sent mail alike.

**What a fallback label does and does not do.**

- It runs **no follow-up prompt**: the definition is passed with `postLabelPrompt: ''`, so no model
  run, no Gold beyond the classification and no project task. What unlabeled mail always got still
  happens: thread continuation, the thread topic, and the "Daily ads" line for an ad. A pending
  continuation replay of a fallback record strips the prompt too (`labelSource === 'fallback'`). A
  user's follow-up-type correction in the feedback UI is explicit and may still run the label's
  prompt.
- **An incoming email under a fallback label still gets one line (decided with Karsten
  2026-11-23).** Until then such mail was labeled in Gmail but reached neither Chats > Unread nor a
  task, so clearing Alldone left it in the inbox (the report: DHL, Booking, Facebook Memories,
  Claude status and a newsletter, all in the fallback labels Privat and Newsletter).
  `writeFallbackLineForMessage` writes `Email from <name> (<email>): <subject>` without a model
  (`buildEmailSubjectLineText`, shared with the "Daily ads" line) into the **project-wide** "Daily
  emails <label> <date>" digest of the default project label's project
  (`resolveDefaultProjectLabelDefinition`, the topic its prompt writes to), or of the default
  project when it has no label (custom mode, `Alldone/Other`). Karsten chose the project digest over
  a private topic. A thread that already has its own topic gets the line there. The comment carries
  the fallback label as tag and the classification's `followUpType`, so an email called actionable
  is a followed (red) entry, never a task; the unread settings still archive newsletters and ads
  and store the line read. Ads keep their "Daily ads" line, sent mail gets none. The line is stamped
  into `emailComments` for the read sync, also on a continuation replay. Pinned by the "Daily
  emails line" block of `gmailLabelingFallbackAndRetry.test.js`.
- Not changed, on purpose (Karsten, 2026-11-23): a row cleared by the Gmail read sync because the
  mail was **read** in Gmail leaves the mail in the inbox (read is handled), and "Mark as read" on an
  email row never archives.
- It **never archives on its own**: neither the label's `autoArchive` nor `autoArchiveAllLabeled`
  applies, so unsure mail does not leave the inbox. Only the user's unread setting for newsletters
  and ads archives it, in the same `messages.modify` call as the label.
- The selected project is not passed to the post-label step, so nothing is routed into the project.

**Audit record.** A fallback write has `labelSource: 'fallback'` (a classifier match has
`'classifier'`), `selectedLabelKey`/`selectedGmailLabelName` of the fallback, `selectedProjectId` +
`selectedProjectSource: 'fallback_label'` for the default project label, `applied: true`,
`skippedReason: null`, `fallbackReason` (`no_match` | `below_threshold` | `missing_label_definition`),
`fallbackKind` (`newsletter` | `default_project` | `other`), and the classifier's own decision:
`classifierMatched`, `classifierLabelKey`, `classifierRawLabelKey`, `classifierRawMatched`,
`confidence`, `reasoning`, `emailKind`, `consistencyCheck`. The settings audit list shows
"<label> (fallback, no label matched)" (`Gmail fallback label`). The sync counts a fallback label as
`labeled`. Records written before AT-3102 keep `skippedReason: 'no_match'`; there is no backfill, and
the email line's "No label" section stays for that mail and for mail outside the sync scope.

**Bounded retries.** The audit record is also the "already processed" marker
(`getExistingAuditIds`), and the history cursor moves on, so a failed email used to stay unlabeled
for good (`processing_error`). Now `recordMessageProcessingError` counts `processingAttempts` and sets
`processingErrorRetryPending: true` for a **retryable** error; every sync queries that flag
(`loadProcessingRetryMessageIds`, up to 20), fetches those emails past the history cursor, the
candidate filter and the processed marker, and processes them again. After
`MAX_GMAIL_MESSAGE_PROCESSING_ATTEMPTS` (3, the first run included) it sets
`processingErrorRetryExhausted: true`, stops, and the run's `lastError` says so. An email that can no
longer be fetched uses up an attempt (`processingStage: 'fetch'`). A successful write sets
`processingErrorRetryPending: false`.

Only errors **before any side effect** are retryable (`markRetryableProcessingError`):

- `classification`: the classifier threw; no Gold was charged.
- `label_write`: resolving or writing the label (with its archive) failed, and the classification
  Gold was refunded (`applyLabelWithRefundOnFailure`). A retry classifies and charges again, so the
  user pays once per labeled email.

Not retryable: a failed refund (`label_write_refund_failed`, a retry would charge twice), and
anything after the label was written (follow-up run, final audit write), which could otherwise create
a task or charge Gold twice. Insufficient Gold leaves a pending retry pending without counting an
attempt, because it never reaches the classifier.

Pinned by `functions/Gmail/gmailLabelingFallbackAndRetry.test.js` (fallback choice, diagnostics,
follow-up suppression, archive and unread settings, the retry/exhaustion cycle across real
`syncGmailLabeling` runs on an in-memory Firestore) and the updated no-match cases in
`serverSideGmailLabelingSync.test.js`.

## Relayed person-to-person mail can need a reply; a later reply email upgrades a task (AT-3131, 2026-11-22)

Kleinanzeigen buyer questions arrive from `noreply@mail.kleinanzeigen.de`. The `needsReply`
guidance used to say "false for … notifications, automated or bulk mail", so most were classified
"no reply needed": FE-2149 and FE-2150 landed in the regular list, and only FE-2148 got
`needsReply: true` and went to Messages. Two changes, decided with Karsten:

- **Classifier** (`GMAIL_NEEDS_REPLY_GUIDANCE`, used by both passes): a message a real person wrote
  and a platform relays (marketplaces such as Kleinanzeigen/eBay, LinkedIn/Xing DMs, Airbnb/Booking
  guests or hosts, contact forms) is judged by the person's message, not the sender address or
  `emailKind`. Automated notifications without such a message (alerts, receipts, order/shipping
  updates, reminders, connection requests, likes, profile views) stay false, as does "uncertain".
- **Upgrade**: when a newer email in the thread needs a reply and the task has no `messageData`,
  `buildEmailTaskUpdate` adds it (same shape as `buildReplyTaskMessageData`; sender from the
  `From` header via `plan.replySender`), so the task moves into Messages. **Visibility is kept**:
  the upgrade never writes `isPrivate`/`isPublicFor`, so a project-visible task does not vanish
  for other members. Only a task that belongs to the mailbox owner is upgraded
  (`gmailData.accountUserId`). New reply tasks are still created private.

Not done: the sender name of a relayed email is still the `From` display name ("… über
Kleinanzeigen"), not the person. If a send-reply action is built on `messageData` (UNIFIED_INBOX_PLAN
§7), it must check that the caller owns the mailbox. It cannot rely on `isPrivate`, because an
upgraded reply task can be visible to the project. Pinned by the AT-3131 blocks in
`gmailPromptClassifier.test.js`, `emailTaskContentUpdate.test.js`,
`emailThreadContinuation.test.js` and the "reply task creation" block in `assistantHelper.test.js`.

## Recurring email of one source is collected in one to-do (AT-3135, 2026-11-23)

Kleinanzeigen buyer inquiries each arrive as a new thread, so AT-2709 thread reuse never applied and
every inquiry became its own (mostly reply) task: 18 tasks from about 45 mails in two days, split over
"Privat" and "Familie". This is task bundling, not the message grouping of AT-3131. Decided with
Karsten:

- **Who decides**: the post-label assistant names a handling context on `create_task`
  (`emailBundle: { key, label }`), only where the sync offers it (`gmailContext.emailBundles`:
  incoming, actionable, thread not ambiguous). The sync lists the existing contexts of the sender so the
  key is reused. The **identity is the server's**: owner, provider, mailbox, the sender's registrable
  domain from the From header (`mail.kleinanzeigen.de` = `kleinanzeigen.de`) and the key
  (`resolveEmailBundle`). A task with its own `dueDate` or reminder is never collected
  (`shouldBundleCreateTask`), and the prompt keeps urgent, legal, payment, security and unrelated mail
  separate. Same domain alone is not a reason.
- **Reply mail is collected too.** A collection to-do is a normal **private** to-do without
  `messageData`, so collected buyer inquiries no longer appear one by one in Messages, and a later
  reply in a collected thread never upgrades it to a reply task.
- **Sticky project**: the to-do stays where it was created, like thread tasks, even when a later
  email is routed to another project. It takes new conversations only while it is still the owner's
  own private to-do in one of their projects (`isOwnerPrivateTask`); shared, reassigned or deleted, the
  next email starts a new one (threads already in it keep continuing there, like AT-2709).
- **Done**: the next actionable email of the context, or of a collected thread, reopens it.
  Informational mail of a collected thread is a silent comment and leaves it done.
- **Content**: each email is one line at the end of the description (`- <state> <Gmail link>`) and
  one comment in the task chat (`email_<messageKey>`, so a retry never duplicates it). The title is
  `<label>: <current state>` ("Kleinanzeigen: Layla möchte ein Foto der Wickelkommode"). It moves with
  every newer actionable email, including later mail of a collected thread (the continuation summary
  returns `state` when called with `bundle: true`), but only while it still equals the title the
  automation wrote last (`gmailData.taskContent.name`). A user's rename and description edits are kept.

Data: `users/{uid}/emailTaskBundles/{bundleId}` → `{ projectId, taskId, key, label, senderDomain,
gmailEmail, provider }`. The task carries `gmailData.bundle` (`id`, `key`, `label`, `senderDomain`,
`itemCount`, `lastItemAt`) and `gmailData.threadIds`. A thread that joins after the first email gets
`users/{uid}/emailThreadTasks/bundleThread_<threadKey>`, which `findEmailThreadTasks` reads (one extra
doc read per lookup), so AT-2709 continuation finds the to-do for later mail of that thread.
`TaskCommentService.addComment({ emailBundle })` re-checks account, collection and selection inside
its transaction. `persistEmailTaskAtomically({ bundle })` serializes creation of the first to-do of a
context, and only collects a thread that has no task yet. It registers the thread on the to-do in the
same commit (threadIds, thread registry, pointer), so a concurrent email of that thread cannot
create a second task. A thread with several tasks gets AT-2709's separate task, without the collection
marker. Only single-field indexes are used. MCP's `create_task` schema does not offer `emailBundle`.

Not done: existing separate tasks are not merged; the explicit "Create task" of the email line never
collects; the sender name of a relayed email is still the platform's display name unless the model
names the person. Pinned by `functions/Email/emailTaskBundle.test.js`, the AT-3135 blocks in
`assistantHelper.test.js`, `serverSideGmailLabelingSync.test.js`, `toolSchemas.test.js` and
`mcpServerSimple.test.js`.

## All email tasks under Messages (AT-3151, 2026-11-24)

Karsten saw email tasks with the Email badge in the normal list of a project while other email tasks
of the same project were under Messages. Cause: `getTaskTypeIndex` (openTasks.js) routed only
`messageData.needsReply === true` to `MESSAGE_TASK_INDEX`. The badge, however, reads `gmailData`. So
every email task without a reply flag (classified "no reply", answered, created before reply data,
legacy inbox summaries) and every AT-3135 collection to-do (no `messageData` by design) landed in the
main list. AT-3131 only changed the classification, so it could not fix this.

Rule now: **the section follows the email origin, not `needsReply`.** `isEmailOriginTask`
(`utils/Gmail/emailTaskOrigin.js`) is `!!task.gmailData`, the same marker that shows the badge (both
the inbox-summary chip and the follow-up chip in the title, Microsoft included). Precedence is
unchanged from the reply rule, as decided with Karsten: own tasks only (`userIds.length <= 1`). Shared
workflow, observed, workstream and assistant-profile boards keep their sections, and
assistant-suggested and mention email tasks go to Messages. Each task maps to exactly one bucket, and
a changed task is removed from the bucket its _old_ version maps to, so nothing is listed twice.
`needsReply`/`messageData` keep their other meanings (Messages sort key, reply upgrade, email line
counts).

- Sort inside Messages: `getEmailTaskActivityTime`, the newest of `messageData.lastMessageAt`,
  `gmailData.lastEmailReceivedAt`, `gmailData.bundle.lastItemAt` and `gmailData.receivedAt`, then
  `created`. Tasks with none of these come last.
- "Select all" in organize mode (`DateBarOrganizeModalItem`) now also selects Messages tasks, and
  completing a Messages task counts like a main task for the goal reminder move
  (`moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks`). Without these two changes, email tasks
  would have lost both behaviours by leaving the main bucket.
- The goal detail view (`openGoalTasks.js`) has no Messages section and keeps email tasks in its main
  list (left unchanged on purpose).

Pinned by the AT-3151 block in `utils/backends/openTasks.test.js` and by
`utils/Gmail/emailTaskOrigin.test.js`. The second test checks that the helper agrees with the badge
helpers.

## Postponing an email task can archive its email in Gmail (AT-3164, 2026-11-26)

The postpone dialog (`DueDateModal`, so the swipe popup, the row's date tag, the detail view and the
drag modal alike) shows **"Archive email in Gmail"** for a single open Gmail task while its email is
still in the inbox, **checked by default**. The task takes over the follow-up: it comes back on the
chosen date in Alldone. No Gmail snooze, and nothing ever moves the mail back to the inbox. Decided
with Karsten:

- **Where**: every single-task postpone. Not for several tasks, a goal, a project, Outlook tasks, or
  the edit-mode date picker (that only sets a draft saved later) (`getPostponeEmailArchiveData`).
- **Visible only on positive evidence**: the dialog asks `getMessageStates` (read-only) on open, and
  the option appears only when a linked message reports `inInbox: true`. Offline, an expired
  connection, another user's mailbox or an unknown state hide it silently. A date picked before the
  answer arrives postpones without archiving.
- **Archive = the existing `archive` action** (`archiveEmailInBackground`, shared with the
  completion modal): `threads.modify({ removeLabelIds: ['INBOX'] })` on the whole thread, like
  Gmail's own button. UNREAD and every other label stay. Karsten chose the thread over the single
  message.
- **Only on confirmation, only after the task moved**: picking a date, Someday or Auto postpone is the
  confirmation; closing the dialog is the cancel and touches nothing. The choice is read at the click
  (`shouldArchive`), and `wrapPostponeWithEmailArchive` archives only after the task write resolved,
  so a failed postpone never leaves the mail gone from both places (it alerts "…so the email was not
  archived"). A failed archive alerts on its own ("The task was postponed, but …"); the task stays
  postponed. Undoing the postpone does not move the mail back.
- `DueDate.js` (detail view) now returns its write promise so the archive waits for it.

Pinned by `DueDateModal/emailPostponeArchive.test.js` and `DueDateModal/DueDateModalEmailArchive.test.js`.

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

**alldone.team reads the Roadmap Creator's Alldone source on its own site (JO-3355).** Inside
alldone.app the embed window pushes an Alldone project's goals, milestones and OKRs to the Roadmap
Creator over postMessage (`utils/roadmapSourceBridge.js`, protocol version 1). On alldone.team itself
there is no alldone.app page, so alldone.team's Functions ask `POST https://my.alldone.app/api/roadmap/source`
(hosting rewrite → `roadmapSource`, europe-west1, `functions/Roadmap/roadmapSourceApi.js`) for the
alldone.app account linked to the alldone.team account (its `billingAccount.appAccountId` / `email`).
It is signed exactly like the Gold webhook and shares its code (`functions/MenubarApp/alldoneTeamSignature.js`):
`x-alldone-timestamp` (Unix seconds) and `x-alldone-signature` = hex HMAC-SHA256 of
`` `${timestamp}.${rawBody}` `` with `MENUBAR_APP_WEBHOOK_SECRET` (or `EXTERNAL_TOOLS_SIGNING_SECRET`),
compared in constant time, at most 5 minutes off; 401 `INVALID_SIGNATURE`, 503
`SIGNING_NOT_CONFIGURED` without a secret. There is no user token: whoever holds that secret can read
any account's roadmap data, which is the trust the Gold webhook already places in it (it can spend any
account's Gold). Body `{ action: 'projects' | 'snapshot', account: { appAccountId?, email? }, projectId? }`;
the account is found by its user id (what `/api/menubar/session` answers as `accountId`), else by the
verified login email, never by the users document's email field (404 `ACCOUNT_NOT_FOUND`). `projects`
answers `{ success: true, projects: [{ id, name, color }] }`, the list `getActiveRoadmapProjects` gives
the embed window, limited to projects whose `userIds` list the account. `snapshot` answers
`{ success: true, snapshot: { project: { id, name, color, focusAreas }, goals, milestones, okrs } }`,
exactly what `subscribeToRoadmapProject` delivers, read once with the Admin SDK (403 `NOT_A_MEMBER`,
404 `PROJECT_NOT_FOUND`); other errors are `INVALID_ACTION`, `INVALID_ACCOUNT`, `INVALID_PROJECT_ID`
(400) and `INTERNAL_ERROR` (500), always as `{ success: false, error }`. Both sides build the snapshot
from the normalizers in `functions/Roadmap/roadmapSourceModel.js` (a pure module the web bridge imports);
the one difference is the day keys of a time-logged revenue OKR, which the browser takes from its own
zone and the server from the account's stored zone (else UTC). Pinned by
`functions/Roadmap/roadmapSourceApi.test.js` and `__tests__/Roadmap/roadmapSourceParity.test.js`, which
runs the real bridge and the server read on the same documents and requires equal snapshots.

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

## No email pill in the task headers; messages are reached through Chats (AT-3110, 2026-11-19)

The All Projects header line and every project header no longer show the email summary pill
(envelope + Inbox/Newsletter/label counts). It duplicated the Chats entry point and confused
navigation, so the header-only `AllProjectsEmailLabelChips` / `ProjectEmailLabelChips` components
and the `showEmailLabels` prop on `AllProjectsLine`, `ProjectHeader` and `ProjectAndUserData` were
removed. Email handling is unchanged: labeling, Chats > Unread, the email label modal and the
standalone Email line (`EMAIL_LINE_ENABLED`, still off) remain. Do not re-add email counts to the
headers; `AllProjectsLineAddTask.test.js` and `ProjectAndUserData.test.js` pin that neither header
renders an `EmailLabelChip` or loads `useEmailLabelGroups`.
