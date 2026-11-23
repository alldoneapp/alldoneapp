# Unified Inbox Plan: messages as tasks

Status: **Phase 1a partly built** on branch `ai/unified-inbox-messages` (2026-11-09), tested but not
committed (see §13).

Goal: Alldone becomes the one place where the user sees what they owe other people, across email,
Slack and Teams. A conversation that needs a reply is a **task** in a "Messages" section of its
project's task list, like calendar events are today. Anna drafts the reply, the user previews and
steers it, and it is sent only on the user's tap.

Alldone does not become a chat client. It shows the conversations that need the user, not every
conversation.

---

## 1. Decisions

| Question                 | Decision                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it lives           | A "Messages" section inside each project's open-task list, like the Calendar section                                                                      |
| Privacy                  | DMs (and email) are private to the user. Messages from team channels pinned to a project become project-visible tasks                                     |
| Drafting                 | On demand: when the user expands the row and picks an intent or asks for a draft. Opt-in pre-drafting per person or project                               |
| Counting                 | Reply tasks count like normal tasks: Gold, statistics, skyline, day-rate                                                                                  |
| Scope (Slack, Teams)     | DMs, group chats, @mentions, replies in the user's threads, plus every message in channels the user pins to a project                                     |
| WhatsApp                 | Left out for now                                                                                                                                          |
| Sending                  | Always the user's tap. Anna never sends on her own                                                                                                        |
| Order                    | Email first (the email line stays for labels and counts), then Slack, then Teams                                                                          |
| Informational messages   | Never become tasks                                                                                                                                        |
| Messages that need work  | Stay what they are today: normal tasks in the main list with a channel chip (the Gmail follow-up task pattern). Only "needs a reply" goes to Messages     |
| Archived without a reply | Archiving the email completes its reply task. Only reading it does not                                                                                    |
| Email task privacy       | Email tasks that need a reply are private to the user. Email tasks that need other work stay project-visible as today                                     |
| Reopening                | A later message reopens a done task only when it needs a reply or an action. This applies to **every** email task, not only reply tasks (changes AT-2709) |
| Slack distribution       | Internal app first (the user's own workspace). Marketplace listing once the feature is proven                                                             |
| Outlook email            | Automatic polling comes with Teams in Phase 3. Manual "Create task" until then                                                                            |
| Stored message text      | The Slack / Teams copy stays as long as its task exists                                                                                                   |
| Slack / Teams FYI        | Only conversations that need a reply or an action appear in Alldone. No topics for informational Slack or Teams conversations                             |

## 2. What exists today

Most of the email half is already there. The plan builds on it instead of adding a second system.

- **Sections by task type.** `getTaskTypeIndex` in `utils/backends/openTasks.js` puts a task with
  `calendarData` into `CALENDAR_TASK_INDEX` (10), and `TasksSections.js` renders
  `CalendarSectionContainer` for it. `utils/backends/Tasks/openGoalTasks.js` has its own copy of
  `getTaskTypeIndex` for the goal detail view. Twelve files read the calendar index (filters,
  priority filter, drag lists, date header, goal views).
- **One task per email thread.** `functions/Email/emailThreadTaskStore.js` and
  `emailThreadContinuation.js` (AT-2709) match a new email to the existing task of its thread,
  reopen a completed task, and add a summary comment. The registry is
  `users/{uid}/emailThreadTasks`.
- **Draft replies.** `draftReply` in `functions/Email/emailLine/emailLineService.js` composes a
  reply with optional user guidance and project grounding (`replyComposer.js`), charges Gold, and
  creates a draft **in the mailbox**. The user opens it in Gmail or Outlook
  (`DraftReplyPopup.js`). There is no preview in Alldone and no sending from Alldone.
- **Project routing.** Gmail labels can name a project (`resolveConfiguredProjectForEmailLabel`).
  Calendar events are routed by a classifier with learned rules and feedback
  (`functions/GoogleCalendar/calendarProjectRouting*.js`).
- **Read state sync.** An email handled in Gmail marks its Alldone comment read
  (`emailCommentReadSync.js`, AT-2376), from the 5-minute labeling poll.
- **Connections.** `functions/Integrations/providerConnections.js` resolves Google and Microsoft
  connections. Scopes: Gmail `gmail.modify`; Microsoft `Mail.ReadWrite` (no `Mail.Send`).
- **Gold for tasks.** `resolveTaskProgressReward` in `functions/Gold/serverGoldRewards.js` pays
  once per task and step (`task_progress:{taskId}:{stepIndex}:{uid}`), never for subtasks.

Two gaps found while reading:

- **Nothing sets "needs reply".** `loadNeedsReplyFlagsFromAudit` reads `needsReply === true` from
  the labeling audit records, but I found no code that writes it (both providers hardcode
  `needsReply: false`, and the labeling sync never mentions the field). The "needs reply" count of
  the email line is therefore always 0 today. Phase 1 fixes this as its first step.
- **Outlook has no automatic path.** AT-2709 states that Outlook only has the explicit "Create
  task" action; there is no Outlook polling or labeling.

## 2a. Email thread topics (in progress, branch `ai/email-thread-topics`)

A parallel session is building "Email conversations get their own topic" (decided with Karsten on
2026-11-09). It is uncommitted work on that branch at the time of writing. This plan builds on it
and must land after it, because both change `executePostLabelPrompt`
(`functions/Gmail/serverSideGmailLabelingSync.js`), `emailThreadContinuation.js` and the
`add_chat_comment` case in `assistantHelper.js`.

What it decides:

- **Three places for an email, in this precedence: task > thread topic > daily digest.** A first
  email nobody answered stays a line in "Daily emails <project> <date>". Once a reply comes in or
  goes out, the Gmail thread gets its own topic (`EmailThread_<key>`, registry
  `users/{uid}/emailThreadTopics`, new module `functions/Email/emailThreadTopicStore.js`), seeded
  with the earlier digest lines. A thread that has a task continues on the task (AT-2709).
- **Thread topics are private to the mailbox owner** (`isPublicFor: [uid]`), so they stay out of
  the project wiki.
- **Sent mail is recorded.** A message the user sends appears in the thread topic, or on the
  thread's task, as the user's own comment (`direction: 'outgoing'`, no model, no Gold, the task is
  not reopened or rewritten). The direction check moves behind thread continuation so outgoing
  mail reaches that branch.
- **The topic's project is sticky**: where the conversation started, else the label's project.

What that means for this plan:

| Topic                      | Consequence                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where a conversation lives | A reply task is the "task" level of the same precedence. No fourth place is added. When a thread topic exists and a message needs a reply, the task is created and the topic gets a line linking it (step 3 of the routing) |
| Conversation view          | The reply panel shows the task's comments: summaries of incoming mail and the user's own sent messages, which the thread work now writes                                                                                    |
| "Answered elsewhere"       | No separate poll. The new outgoing branch of `continueEmailThread` is the signal: sent mail landing on a task with `messageData.needsReply` clears the flag and completes the task (§7)                                     |
| Privacy                    | Email conversations are already private by that decision. Private email reply tasks follow from it (decided, §1)                                                                                                            |
| Verdict                    | The classifier already returns `followUpType` (`actionable` / `informational`) in the labeling call. "Needs a reply" is one more field of the same result (§3), not a new classifier                                        |
| Registries                 | Slack and Teams copy the identity and registry pattern (`emailThreadIdentity.js`, `emailThreadTasks`, `emailThreadTopics`) instead of inventing another                                                                     |

One existing gap matters more once replies are tasks: comments added by task continuation are not
stamped for the server read sync, so their unread markers are not cleared when the mail is read in
Gmail (listed as out of scope in the thread-topic plan). Phase 1a should stamp them.

## 3. The model

Every incoming message gets a verdict. For email it is the labeling classifier's existing result
plus one new boolean, `needsReply`:

| `followUpType`  | `needsReply` | What happens                                                                                               |
| --------------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| any             | true         | The conversation gets a task with `messageData.needsReply: true`, shown in the Messages section            |
| `actionable`    | false        | A normal task in the main list with the email chip (today's Gmail follow-up task)                          |
| `informational` | false        | No task. A line in the daily digest, or in the conversation's thread topic once it is a conversation (§2a) |

`needsReply` is a separate field on purpose: `coerceClassifierResult` maps every `followUpType`
other than `actionable` to `informational`, and the grey-notification rule and the stored task
data depend on those two values.

Rules for a reply task:

- **One task per conversation.** A new message in the same thread updates the task (summary,
  `lastMessageAt`) instead of creating another. Email already works this way (AT-2709).
- **It completes itself** when the user answers, in Alldone or in the source app. See §7.
- **It comes back** when the other side writes again and that message needs a reply or an action.
  A plain "thanks" is added as a comment and the task stays done. Decided for **every** email
  task, not only reply tasks, so it changes the AT-2709 rule ("reopen completed tasks" on any
  later email): `buildEmailTaskUpdate` in `functions/Email/emailTaskContentUpdate.js` reopens
  only when the new message's verdict is `actionable` or `needsReply`. Update
  `functions/Email/AT-2709.md` with it. The rule for rejected assistant suggestions stays.
- **It is a real task**: postpone, swipe, estimate, My Day, assignee, comments and the task's own
  chat with the assistant all work unchanged.

## 4. Data model

### On the task

A new field next to `calendarData` / `gmailData`:

```js
messageData: {
    provider: 'gmail' | 'microsoft' | 'slack' | 'teams',
    connectionKey,          // which connected account or workspace
    conversationKey,        // opaque thread / DM / channel-thread id, hashed
    kind: 'dm' | 'group' | 'mention' | 'thread' | 'channel' | 'email',
    senderName,
    senderContactId,        // when the sender matched a contact
    lastMessageAt,
    needsReply: true,       // false once answered; decides the section
    webUrl,                 // "Open in Slack"
}
```

Email tasks keep `gmailData` (thread matching, the Gmail chip and the wiki filter read it) and get
`messageData` in addition.

`getTaskTypeIndex` gains one line before the calendar check:
`if (messageData?.needsReply) return MESSAGE_TASK_INDEX` (new index 12; 11 is
`EMPTY_SECTION_INDEX`). A task whose reply is sent but which stays open for other reasons falls
back into the main list.

`messageData` is written only by Cloud Functions. `firestore.rules` must refuse client changes to
it (same pattern as the other server-owned task fields), because the send callable trusts it to
decide where a reply goes.

### Message text

- **Email:** not stored. The text is fetched from the mailbox when the row is expanded
  (`getMessageContext` exists).
- **Slack / Teams:** a copy in a server-only collection
  `messageThreads/{uid}/threads/{conversationKey}` (no client rule): the messages of conversations
  that have a task. Reason: Slack limits history reads (§9), so fetching on demand is not
  dependable. **The copy stays as long as the task exists** (decided), so a done task still shows
  its conversation. It is deleted when the task is deleted, when the task's project is deleted,
  and when the user disconnects the workspace. That needs a hook in `onDeleteTask` and in the
  disconnect callable; and because the collection is keyed by user, project deletion reaches it
  through the task deletions, which must be verified. Bound each conversation (for example the
  newest 200 messages). Slack's terms may limit how long message data may be kept (§12).
- The browser reads message text only through a callable (`getMessageThread`) that checks the
  caller owns the task or, for a shared channel task, is a member of the project.

### Thread registry

Slack and Teams copy the email pattern: an identity hash like `getEmailIdentity`
(`functions/Email/emailThreadIdentity.js`) and a registry `users/{uid}/messageThreadTasks/{key}`
that points to the task. They need a sibling identity function, because `getEmailIdentity` requires
a mailbox address and accepts only `google` and `microsoft`. Email keeps `emailThreadTasks` and
`emailThreadTopics`.

### Drafts

`users/{uid}/messageDrafts/{projectId}__{taskId}`: `{ body, basedOnMessageId, guidance, model,
updatedAt }`. Owner-readable and owner-writable under the existing user-subcollection rule. That is
safe because a draft is the user's own text and sending always carries the text the user saw (§6).

## 5. Privacy and routing

### Visibility

- `kind` `dm`, `group`, `mention`, `thread`, `email` → `isPrivate: true`, `isPublicFor: [uid]`.
  The task, its chat and its feed entries are then invisible to other members, and the project
  wiki skips it (`isVisibleToWholeProject`).
- `kind: 'channel'` (a pinned team channel) → `isPublicFor: [0, uid]`, like calendar tasks. It is
  then a wiki source and searchable like any task created from an email (AT-2833).
- The user can share a private reply task with the project by hand, like any private task.

A change to today: tasks created from an email are project-visible (`createTaskFromEmail` passes
`isPrivate: false`, which is also the default in `TaskModelBuilder.js`). Reply tasks from email
are private (decided), in line with the thread topics, which are private to the mailbox owner
(§2a). Email tasks that need other work stay project-visible.

Pinning a channel shows its messages to every member of the Alldone project, including people who
are not in that Slack channel. The pin dialog must say so, and only the person who connected the
workspace may pin.

### Which project

In this order:

1. **Existing thread.** A conversation that already has a task stays in that task's project
   (AT-2709 rule).
2. **Pin or label.** A pinned channel, or a Gmail label with a configured project.
3. **Contact.** The sender matches a contact that exists in exactly one of the user's projects.
4. **Classifier.** The calendar routing classifier's shape, with the project descriptions
   (`buildProjectRoutingDescription`).
5. **Fallback.** The project the connection belongs to.

Moving a reply task to another project records a learned route for that sender, like the calendar
routing feedback does for event series.

## 6. Drafts: preview and steering

### The panel

Expanding a row in the Messages section opens a reply panel under it (a bottom sheet on phones,
through `AppPopover`). It shows:

1. the incoming message in full (fetched from the mailbox), with the earlier conversation from the
   task's comments: summaries of incoming mail and the user's own sent messages (§2a),
2. intent chips: "Yes", "No", "Need more info", plus a text field and the microphone ("Tell Anna"),
3. the draft, editable in place, with one line saying what it is based on,
4. actions: Send via <channel>, Shorter, Open in <channel>.

Opening the panel is free. A draft is written only when the user picks a chip, gives guidance or
presses "Draft reply". With pre-drafting switched on for the sender or project, the draft and
message-specific chips are already there and the row shows "Draft ready".

### Steering, three levels

| Level           | How                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This reply      | Intent chip, typed or spoken guidance, direct edit, "Shorter". Longer back-and-forth in the task's own chat                                                             |
| Person, channel | Tone per channel learned from the user's sent messages; a "how to write to this person" note on the contact                                                             |
| Everything      | A "Reply style" instruction in Settings, next to the Gmail labeling prompts. The difference between a draft and what was sent is stored in the private assistant memory |

### Server side

- Split today's `draftReply` into **compose** (returns the body, stores the draft document,
  charges Gold) and **create mailbox draft** (kept as "Open in Gmail").
- `composeReply` stays a plain completion with no tools. Message text is untrusted: a crafted
  message can at most change a draft the user reads before sending.
- Grounding: what `loadReplyGroundingContext` loads today, plus the open tasks and goal of the
  task's project, the contact note and the reply-style instruction.
- A revision ("Shorter", new guidance) sends the previous draft along and is charged like a draft.
- Gold: keep the existing draft-reply source for email; add `message_draft_reply` for Slack and
  Teams with its label in `GoldTransactionsModal.js` and the three translation files. Model and
  rate come from `featureModelPreferences`, as today.

## 7. Sending and completing

- New callable action `sendReply` with `{ projectId, taskId, body, requestId }`. The body is the
  text on screen. The destination comes from the server-owned `messageData`, never from the
  request.
- **Idempotent.** A browser can replay a callable (the laptop-lid case in CLAUDE.md). The action
  claims `requestId` in a server-only document before calling the provider; a replay returns the
  first result and sends nothing.
- Gmail: `messages.send` in the thread. `gmail.modify` should cover it; confirm on a live
  account. Microsoft: needs the extra scope `Mail.Send`, so Outlook users reconnect once.
- After a successful send: `messageData.needsReply = false`, the task is completed as the user,
  the draft document is deleted, and the sent message is written to the task as the user's own
  comment under the id the labeling sync would use for it. When the sync later sees the same
  message in the mailbox, its write is then a no-op and the comment is not doubled.
- **Archived without a reply.** Archiving the email completes its reply task (decided); only
  reading it does not. The server read sync (`functions/Gmail/emailCommentReadSync.js`) already
  asks Gmail whether a message left the inbox; the same check completes the task. Mail the
  labeling sync archived itself (`archivedByLabeling`) never counts as the user's archiving.
- **Answered elsewhere.** Sent mail already reaches the thread's task through the outgoing branch
  of `continueEmailThread` (§2a). That branch gets one addition: if the task has
  `messageData.needsReply`, clear it and complete the task. It runs on the labeling sync, so the
  task completes within one sync interval, not instantly. Slack and Teams do the same from their
  own events, where it is immediate.
- **Gold.** The reward key is per task and step, and a conversation keeps one task, so a
  conversation pays once however often it reopens. No extra rule is needed for the "count like
  tasks" decision.

## 8. UI work

- `utils/backends/openTasks.js`: `MESSAGE_TASK_INDEX`, the bucket in `getTaskTypeIndex`, sorting by
  `lastMessageAt` (not by priority, like calendar). Same in `openGoalTasks.js`.
- `components/TaskListView/OpenTasksView/MessagesSection.js` + container, modelled on
  `CalendarSection.js`; wired in `TasksSections.js`. Then every reader of `CALENDAR_TASK_INDEX`
  listed in §2 needs the matching branch (filters, priority filter, drag lists, date header, goal
  views). Check My Day and the assistant profile board.
- Row: a sender chip with the channel icon through `SocialText`'s `leftCustomElement` (the Gmail
  chip pattern), and a "Draft ready" badge.
- `MessageReplyPanel` (§6), built on `AppPopover` / `useModalSizing`, with `RambleButton` for
  spoken guidance.
- Settings: reply style, pre-drafting per person or project, channel pins.
- The email line stays. Its "needs reply" number becomes real and opens the Messages section.
- All new strings in `en.json`, `de.json`, `es.json`.

## 9. Channels

### Email (Phase 1)

- Starts after the thread-topic work (§2a) is merged.
- Add `needsReply` to the Gmail labeling classifier's output, next to `followUpType`, and write it
  to the audit record. It rides on the classification that already runs, so it costs no extra
  model call. The classifier sees one message without the earlier thread; that is enough to judge
  "does this message ask me something", and the task's history covers the rest.
- `needsReply` creates or continues the thread's task through the AT-2709 path, with
  `messageData`. If the thread already has a topic, the topic gets the line linking the task.
- The outgoing branch of `continueEmailThread` completes a reply task (§7).
- Stamp continuation comments for the server read sync (the gap named in §2a).
- Works only with Gmail labeling switched on. Outlook gets polling in Phase 3.

### Slack (Phase 2)

- OAuth v2 with a **user token** (the app reads and sends as the user): `im:history`,
  `mpim:history`, `channels:history`, `groups:history`, `users:read`, `users:read.email`,
  `chat:write`. Connected per project like Gmail. The token is stored server-only.
- The connect flow reuses the browser binding (`oauthBrowserBinding`, NV-23) and needs a hosting
  rewrite for `/slackOAuthCallback`.
- Messages arrive through the **Events API** at one `onRequest` function: verify the signing
  secret, answer within 3 seconds, hand the event to a Cloud Tasks worker, dedupe by event id.
- Contacts: match the Slack user's email to a contact; store the Slack user id on the contact.
- **Internal app first** (decided): the first version is installed as an internal app in the
  user's own workspace. As far as I know, Slack's 2025 history limits do not apply to internal
  apps; confirm. The Marketplace listing follows once the feature is proven.
- Only conversations that need a reply or an action appear in Alldone (decided). No topics for
  informational Slack conversations.
- Two checks before any code, because they can change the design:
    - In 2025 Slack cut history reads for commercially distributed apps that are not in its
      Marketplace to about one request a minute. The design avoids history (events push the
      messages), but a Marketplace listing is probably still needed.
    - Slack's API terms restrict how message data may be used with AI models. Confirm that
      classifying and drafting from a user's own messages is allowed.

### Teams (Phase 3)

- Microsoft Graph with the existing Microsoft connection, extra delegated scopes `Chat.Read` and
  `ChatMessage.Send`.
- Start with polling the user's chats on the existing 5-minute pattern. Live change notifications
  for chats are restricted; confirm what a delegated app may subscribe to.
- Channel messages and channel @mentions need `ChannelMessage.Read.All`, which requires admin
  consent in the customer's tenant. Phase 3 therefore covers 1:1 and group chats; channels follow
  only where an admin consents.
- **Outlook email polling** is built in this phase too (decided), since it uses the same Microsoft
  connection: the labeling sync's classification and thread continuation for Outlook mailboxes.

## 10. Phases

| Phase | Content                                                                                               | Proves                                 |
| ----- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 0     | Email thread topics and sent mail in threads (§2a, separate session, branch `ai/email-thread-topics`) | Conversations and sent mail in Alldone |
| 1a    | `needsReply` verdict for Gmail, `messageData`, Messages section, auto-complete when answered in Gmail | The list model with real data          |
| 1b    | Reply panel: preview, intent chips, guidance, edit, send from Alldone (Gmail), idempotent send        | The draft flow                         |
| 1c    | Reply style setting, pre-drafting opt-in, learning from edits                                         | Steering                               |
| 2     | Slack: connect, events, routing with pins and contacts, private and shared tasks, send                | A second channel on the same model     |
| 3     | Teams chats; Outlook email polling                                                                    | Microsoft                              |

Each phase is shippable on its own. 1a alone already fixes the dead "needs reply" count.

## 11. Rules from CLAUDE.md that apply

- **MCP and assistant parity.** Reply tasks are tasks, so `get_tasks` / `update_task` cover them on
  both sides. There is deliberately no "send reply" tool on either side: sending is always the
  user's tap. Record that reason in the parity list when Phase 1b ships.
- **Updates feed.** A reply sent from Alldone is a change the user made in the app, not a tool
  call, so the Gmail activity entry rule does not apply. The task's own feed entries follow its
  privacy.
- **Server fan-outs trust nothing the client wrote.** `messageData`, tokens and the message store
  are server-owned; the send destination is never taken from the request.
- **A callable acts as `request.auth.uid`.** Every new callable checks project membership and task
  access before reading a message or sending.
- **New project-keyed roots** (`messageThreads` is user-keyed; channel pins live under the user)
  need no entry in the project-deletion list. Re-check if that changes.
- **Tests.** Functions suites next to each module; the section bucketing in the open-tasks tests;
  a real-DOM test for the reply panel; rules emulator cases for `messageData` and the server-only
  collections.

## 12. To check before building

All product questions are decided (§1). What remains are facts to verify, each before the phase it
affects:

1. **Gmail sending (Phase 1b).** Confirm on a live account that the existing `gmail.modify` scope
   allows `messages.send`. If not, Gmail users reconnect once, like Outlook users will for
   `Mail.Send`.
2. **Slack limits (Phase 2).** Confirm that an internal app is not subject to the 2025 history
   limits, and what the Marketplace listing will require later.
3. **Slack terms (Phase 2).** Confirm that classifying a user's own messages, drafting replies from
   them with a model, and keeping a copy for as long as the task exists are allowed.
4. **Teams (Phase 3).** Confirm which chat change notifications a delegated app may subscribe to,
   or stay with polling.
5. **Thread-topic work (before Phase 1a).** The reopening rule changes code that the
   `ai/email-thread-topics` branch also touches. Build it after that branch is merged.

## 13. Build status

Built on `ai/unified-inbox-messages`, branched from master `aea3ea6d54` in its own worktree so it
does not touch the uncommitted `ai/email-thread-topics` work:

- **Verdict.** Both classifier passes return `needsReply` (`gmailClassifierPrompt.js`,
  `gmailPromptClassifier.js`). Only an explicit `true` counts, and when the auditor leaves the field
  out the first pass's answer is kept. The sync never sets it for outgoing mail and writes it to the
  audit record, so the email line's "needs reply" count is no longer always 0.
- **Reply task.** `needsReply` makes the post-label run treat the email as actionable and tells the
  model to title the task "Reply to <name>: …". `create_task` then creates it private
  (`isPublicFor: [uid]`) with `messageData` (`buildReplyTaskMessageData` in `assistantHelper.js`,
  `messageData` in `TaskModelBuilder.js`).
- **Reopening.** A later email reopens a done email task only when it is actionable or needs a reply
  (`plan.reopen` in `emailTaskContentUpdate.js`, `reopenOnNewEmail` in
  `emailThreadContinuation.js`). The explicit "Create task" action keeps reopening, since the user
  asked for that task. A newer email also moves `messageData.lastMessageAt` and turns `needsReply`
  back on. `functions/Email/AT-2709.md` still states the old rule and needs updating.
- **Messages section.** `MESSAGE_TASK_INDEX` (12) in `openTasks.js`, newest message first,
  `MessagesSection.js`, wired into `TasksSections.js`, the hashtag and priority filters, drag lists
  and the All projects counts. The browser keeps `messageData` in `mapTaskData` only on tasks that
  have it.
- **Rules.** `firestore.rules` refuses client updates that change `messageData`; a create may carry
  it (project moves).
- **Tests.** Cases in `gmailPromptClassifier.test.js`, `utils/backends/openTasks.test.js`, the rules
  emulator suite, and the new `emailTaskContentUpdate.test.js`.

Verified (Node 22.23.4, `TZ=UTC` like the repo's own test scripts): the full Cloud Functions suite
(493 suites, 7,010 tests), the 713 web suites related to the changed task-list files, and Prettier on
every changed file, and the Firestore rules emulator suite (218 tests, Java 21). The new
`messageData` case was checked against the rule: it fails with the rule removed. Not tried in a
browser.

Left for after `ai/email-thread-topics` is merged:

- Completing a reply task when the user's sent mail lands on it (the outgoing branch of
  `continueEmailThread` exists only on that branch).
- Completing a reply task when the email is archived (server read sync).
- Stamping continuation comments for the read sync.
- A row chip for the sender, the email line's "needs reply" number opening the section, and the
  reply panel (Phase 1b).
