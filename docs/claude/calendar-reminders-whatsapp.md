# Calendar sync, reminders and WhatsApp

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## A meeting exists only after somebody's browser asked for it (AT-2480)

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

## Task reminders and the channel they come back on (AT-2211)

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

## A phone number routes WhatsApp and calls only when exactly one account claims it (NV-44)

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

## WhatsApp replies must finish or report failure before their worker expires

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

## An assistant result sent over WhatsApp must also land in the Daily WhatsApp Topic (AT-2387)

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
