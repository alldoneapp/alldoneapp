# Note storage, task dates/recurrence, day-rate, happiness, feeds

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## A note's body lives in a bucket, and two rules used to disagree about which one (AT-2498)

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

## Never read a note with `Y.Text.toString()` where a model or an offset is involved

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

## A date-only dueDate is "due on that day", not a new timestamp (AT-2891)

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

## A recurring task remembers where it was planned, and asks when that matters (AT-2803)

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

## A recurrence copy must carry its goal's privacy, not just its goal id

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

## Day-rate logging: the target is a ceiling as well as a floor — for calendar time

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

## Happiness ratings — what a rating popup knows before you rate

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

## Client feed cleanup: concurrent trims race, and a lost race reads as permission-denied

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

## A privacy change reaches the stored activity in two halves, and a browser owns only one

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

## An object's last feed state is as private as the object (2026-11-09)

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
