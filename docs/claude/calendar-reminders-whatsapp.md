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

## Meeting time and time to work in the All projects line (AT-3136)

The task boards and My Day show the time to work on the right of the All projects line, as a large
figure with two small lines to its right (`AllProjectsLine showMeetingTime` → `AllProjectsMeetingTime`,
required on use so Notes/Chats/Contacts/Goals never load it):

```
1h 30m  Zeit zum Arbeiten
        7h 30m Meetings
```

Rules live in `utils/meetingTimeToday.js` and are pinned by `utils/meetingTimeToday.test.js`:

- **Working hours are NOT a My Day setting.** There is none. The only stored working day is the
  public meeting link's `workingHoursStart/End` (`users/{uid}/bookingSettings/default`), which
  Anna's availability search also uses. A user who never saved it gets 09:00–17:00, named as the
  default in the tooltip, never presented as their own choice. The clock is read
  in the device's local zone for the local today; the doc's `timeZone` is ignored because the
  settings screen never sends one and the server fills it from the integer `users/{uid}.timezone`,
  i.e. often "UTC".
- **Meetings are the synced meeting tasks** (`calendarData`), from every active project because
  routing puts a meeting wherever it belongs. Two listeners per project, both clause-for-clause
  identical to queries the board already runs (`getOpenTasksQuery` state 0 and
  `getTasksCompletedTodayQuery`), so Firestore shares the server targets; the done-today stream keeps
  a meeting that was ticked off this morning in the whole-day total. Cancelled/declined events never
  become tasks (`filterEvents`). All-day and multi-day timed events are not busy time (same as
  `normalizeGoogleBusyInterval`). Intervals are clipped to the window and unioned; duplicates
  collapse by task id and by name + timing. Microsoft `dateTime` has no offset and is read in its own
  `timeZone` (UTC), not in the reader's zone.
- **Unknown is never zero.** No connected calendar → no figure, only "Time to work / Connect
  calendar". Listeners not answered → a dimmed "…" figure and "… meetings". A listener error → no
  figure, "Calendar data unavailable". `checkIfCalendarConnected` reports `syncing/synced/failed` to
  `utils/calendarSyncStatus.js`; a running pull dims the figure, a failed one adds a small orange
  `alert-circle` icon after the meetings line (beside the figure in the minimal form), explained in
  the tooltip.
- **Layout (user requests after !934 and !938, 2026-11-23).** The free time inside the working
  hours is the one large figure, "Time to work" ("Zeit zum Arbeiten"; "Calendar-free"/"Kalenderfrei"
  before !938). Everything else stands to its RIGHT as two stacked small lines, "Time to work" and
  "7h 30m meetings" (`meetingTime meetings duration`, so the duration comes first in every language).
  Nothing stands before the figure: the working hours ("9–18", or the default) are only in the
  tooltip (`title`) and the accessibility label, together with the explanation that this is calendar
  availability, not tracked work. The whole display is one touchable: it opens Settings >
  Customizations (meeting link working hours), or Settings > Integrations when no calendar is
  connected (calendars are account-level connections there since the July 2026 integrations
  overhaul; the project properties have no calendar section, do not link there). One touchable, not
  nested links, so screen readers get one control with the full label.
- **Mobile: same row, title left aligned.** On mobile sizes (`smallScreenNavigation`) the display
  stays in the line's actions cluster, right aligned before the menu, and "All projects" is left
  aligned: no AT-3132 centring spacer where `showMeetingTime` is set (the mirrored spacer would leave
  the title no room). Lines without the display (Notes, Chats, …) stay centred (product decision,
  2026-11-23). The title sits in a `maxWidth: '100%'` wrapper (`titleBound`), because the mobile
  title column aligns its children at their own width and an unbounded title ran under the figure at
  320px. `AllProjectsLine` measures the line (onLayout) and `getMeetingTimeDensity` picks the form:
  full (≥ 440px line width, ~472px screens), compact (≥ 340px, e.g. 390px screens: figure +
  "7h 30m / Meetings", no "Time to work" label), minimal (narrower, e.g. 360/320px: the figure only);
  the sync warning icon needs 20px more. Compact and minimal use an 18px figure. Thresholds were
  measured in the browser with the German labels at 320/360/390/430/600px; check them again with
  the browser when the line gets another element.
- The previous layouts (a separate row under the line on mobile, `wrap-reverse` secondary text
  before the figure) are gone; `utils/meetingTimeToday.js` was not touched by either layout
  revision (only by the solo work block change below).
- Known gap: a Google event marked "free" (`transparency: transparent`) still counts, because the
  sync does not store `transparency` on `calendarData`.
- **Solo work blocks are time to work (user correction after !939, 2026-11-23).** "Meetings in
  denen ich alleine bin sollten als echte Arbeitszeit gelten", narrowed by the user in the same
  thread: only solo appointments that are _work blockers_; private solo appointments (doctor,
  childcare) still take time away, and "the LLM decides when it looks at the event". An event is
  left out of the meeting time only when `calendarData.soloEvent === true` AND
  `calendarData.workBlock === true` (`isSoloWorkBlock`). Everything unknown stays a meeting, so a gap
  in the data can only make "time to work" smaller. Only the union of the remaining meetings is
  counted, so an overlapping solo block changes nothing there; the copy check runs after the solo
  check, so an event imported twice where only one copy is a solo work block still counts once.
    - `soloEvent` (sync, `getSoloEventFlag` in `calendarTasks.js`, a rule, never the model): `false`
      as soon as anybody else is in it (attendee or organizer, whatever their answer: unanswered,
      tentative AND declined invitees keep it a meeting, decided with the user; rooms/resources are
      not people). `true` only with nobody else AND the user verifiably the organizer (Google
      `organizer.self`, Microsoft `isOrganizer`, now in the Graph `$select` and mapped to
      `organizer.self` by `graphEventToGoogleEvent`, or the organizer address equals the connected
      account). Only the organizer is sure to see the full guest list. Unset (unknown) for a group
      calendar organizer, no organizer, or Google `attendeesOmitted`. Microsoft without `isOrganizer`
      and an alias address counts the "other" organizer: a meeting (safe direction).
    - `workBlock` / `workBlockSource`: `calendar` for Google `eventType: 'focusTime'` (always wins);
      otherwise `ai`, the `workBlock` key of the EXISTING calendar routing call
      (`WORK_BLOCK_PROMPT` in `calendarProjectClassifier.js`, booleans only via
      `coerceWorkBlockVerdict`, null = no decision; no extra model call, no extra Gold). The model sees
      an event only once (routed events are never re-classified), so `applyWorkBlockVerdict` keeps
      the stored `ai` verdict on later syncs (otherwise the regenerated `calendarData` would drop it).
      No verdict exists, i.e. the event stays a meeting, when routing is off, the user is not premium,
      Gold is insufficient, a learned series route skipped the model, or the event was routed before
      this change (today's events at deploy time).
    - The tooltip adds "Work blocks with only you count as time to work (n today)" when n > 0; the
      visible line is unchanged. Pinned by "solo work blocks" in `meetingTimeToday.test.js`, "solo
      events and work blocks (AT-3136)" and the AT-3136 routing test in `calendarTasks.test.js`, and
      the AT-3136 cases in `calendarProjectClassifier.test.js` / `calendarProjectRouting.test.js`.
    - The AT-3137 statistics and the "no other participants → own time" category suggestion still
      use `attendeeCount` and are unchanged.
- **Time to work is what is still available, live (user correction after !940, 2026-11-23).** "Die
  verfügbare Arbeitszeit sollte live aktualisiert werden. Wenn die vorherigen Zeitfenster bereits
  vorbei sind, stehen die entsprechenden Stunden auch nicht mehr zur Verfügung."
    - The large figure (`view.freeMinutes`) is the remaining window `[max(now, start), end)`
      (`getRemainingWindow`) minus the union of the meetings inside it: before the working day the
      whole window, after it 0 (`workdayPhase` `before`/`during`/`after`). An ongoing meeting only
      takes its rest; free time that has passed is gone. Solo work blocks, dedup, clipping, all-day,
      cancelled/declined are the same rules as before, applied to the remaining window.
    - The meeting figure (`meetingMinutes`, `meetingCount`, `workBlockCount`, `windowMinutes`)
      stays the WHOLE working day ("how much of my day is meetings"); so during the day the two
      figures no longer add up to the window. The visible labels are unchanged; the tooltip and the
      accessibility label say "Meetings today …: 4h (whole working day, including meetings that are
      over). Still free to work from 14:05 to 18:00: 2h; free time that has passed no longer
      counts." and, after the working hours, `meetingTime summary after hours`.
    - The clock is `hooks/useMinuteClock.js`: one chained timeout re-aligned to just after every full
      minute, plus an immediate refresh through `subscribePageVisible` (`utils/appResume.js`: tab
      shown, focus, thaw, bfcache), cleared on unmount. No calendar sync, snapshot or navigation is
      needed for the figure to move; no listener is re-opened by a tick.
    - Day rollover: the same clock gives the local day key. A new day re-opens the listeners and
      the line shows "…" until they answer (`tasksState.key` mismatch), never yesterday's figures.
      `utils/DailyAppReload.js` then reloads the page as usual (deferred while offline).
    - `dailyPlanModel.computePlanCapacity` (AT-3142) still reads `windowMinutes − meetingMinutes`
      (whole day) and ignores `freeMinutes`; it was deliberately not changed with this (open product
      question whether Plan my day should plan against the remaining time).
    - Pinned by "remaining time to work (live)" in `meetingTimeToday.test.js`, "live remaining time
      to work" in `useMeetingTimeToday.test.js` (fake clock: ticks, resume, unmount, midnight),
      `hooks/useMinuteClock.test.js` and the tooltip cases in `MeetingTimeToday.test.js`.

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

**WhatsApp gets the 25-minute budget of every server-started assistant run** (decision 2026-11-24:
no WhatsApp-only limit). `WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS` equals
`HEARTBEAT_PROMPT_MAX_RUN_WALL_CLOCK_MS`; the derived transport timeout is 1800 seconds. Browser
chats keep 55 minutes only because the browser holds the onCall request open; nothing the server
starts can: Eventarc caps at 540s, Cloud Tasks and Cloud Scheduler at 30 minutes.

So the run no longer happens in the Firestore trigger. `processWhatsAppInboundQueueItemSecondGen`
only calls `enqueueWhatsAppQueueRun` (`whatsAppQueueDispatch.js`, task id per queued message, so a
redelivered trigger does not dispatch twice), and the Cloud Tasks worker `runWhatsAppInboundQueue`
(single attempt, `invoker` set to the Admin SDK SA so the deploy manages its IAM) drains the user's
queue under the per-user lock. A failed dispatch leaves the item pending for the recovery sweep.

The whole drain shares one deadline. `whatsAppRunGuard` races context assembly and response
collection against it and aborts the provider request. Check the guard before tools and response
writes, including delegated calls: merely racing a Promise does not stop its continuation. A timeout
marks the queue batch failed and sends a localized WhatsApp error. Do not retry the entire assistant
after a tool has started, even for a transient error. A long run also holds the user's lock, so a
next WhatsApp message waits behind it.

**The run stops researching 90 seconds before the deadline** (`WHATSAPP_WRAP_UP_WINDOW_MS`,
`guard.shouldWrapUp()`). From then on `interactWithChatStream` passes `timeBudgetSpent` to
`prepareResearchRequest`, which makes every further request the final reply: no lookup tools (the
tools that act stay, as for the other research stops) and `TIME_BUDGET_REPLY_INSTRUCTION`, which
asks for a short answer from the evidence so far plus one sentence on what is still unchecked. The
optional post-answer summary is skipped in that window so it cannot abort a stored answer before it
is sent. Delegated runs share the guard and wrap up too. Do not shrink the window below one tool plus
one answer (a browser page load took 13s).

Incident behind both changes (2026-11-24): a "gib mir ein Briefing" request with a link made 19 new,
non-repeating lookups (web, Gmail, calendar, browser clicks), never tripped the count-based research
guard, and was aborted twice by the then 4-minute limit with only the timeout notice.

`recoverWhatsAppInboundQueues` scans every two minutes, rotates a bounded user cursor and uses
`listDocuments()` because historical queue parents have subcollections without a parent document.
It only dispatches: for a user with pending or processing items and **no live lock** (a live lock
means a worker is still answering and claims new items itself), it enqueues one worker task per
two-minute slot. The worker resumes pending requests; processing requests older than the full worker
timeout plus two minutes are marked failed and reported without replaying their possibly completed
actions. `runWhatsAppInboundQueue` is listed in the assistant run-host timeout tests
(`assistantRunLimits.test.js`). No new Firestore indexes are needed.

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
