# Assistant profile (AT-3072)

The root `CLAUDE.md` index says when to read this file.

## What it is and why it is not the global description

Every user has a private **assistant profile**: a text of about 2,000 characters that every one of
their own assistant runs reads, kept up to date every night from what the user did. It replaced the
recurring assistant task "User Description Update", which had two problems:

- **It posted a message every day.** The profile changes quietly at night; the user sees one line in
  Updates the next morning (see below), never a chat message or a task.
- **It wrote into the global user description, which is not private.** `users/{uid}` is readable by
  every member of a shared project (`firestore.rules`, `match /users/{userId}`), and a member's
  profile shows the global description wherever no project-specific one is set
  (`ProjectHelper.getUserDescriptionInProject`). The task filled it with "top of mind", chats,
  contacts and assistant memory from all projects. The global description stays what the user
  writes for others to see; its helper text in Settings now says so.

The profile lives in its own tree, read only by its owner and written only by Cloud Functions:

```
assistantProfiles/{uid}                  settings, the current text, run state
assistantProfiles/{uid}/revisions/{id}   every version (text + previousText), id r000001…
assistantProfiles/{uid}/runs/{runId}     nightly runs and what they cost
```

`firestore.rules` allows `read` to `request.auth.uid == userId` and no writes. The browser saves
through `setAssistantProfileSettings` (on/off, instructions, model, monthly Gold cap, sources, and
the text itself as a `user` revision), `requestAssistantProfileRefresh` and
`restoreAssistantProfileRevision`. Each acts on `request.auth.uid` and takes no user id from the
request.

## Where the text goes

`getUserDescriptionContextMessage(projectId, userId)` in `assistantHelper.js` appends the profile
(`AssistantProfile/assistantProfileContext.js`) after the global and project descriptions, framed as
background about the user and not instructions. It is called with the **requesting** user's id, so a
run only ever sees the profile of the user it answers. A switched-off or empty profile adds nothing,
and a failed read leaves the prompt as it was. It is not used by the email line's reply composer
(outbound mail), search, the Updates feed or any other member's run.

## The nightly run

`AssistantProfile/assistantProfileRun.js`, built like the wiki ingest (`KnowledgeBase/
knowledgeBaseIngest.js`): `dispatchAssistantProfileRuns` (every 15 minutes) enqueues due profiles on
the `runAssistantProfileUpdate` Cloud Tasks worker; a lease on the profile document keeps two runs
apart; the schedule is 04:00 in the user's own day (`assistantProfileSchedule.js`), an hour after
their wikis.

- **No research loop.** `collectAssistantProfileSources.js` reads a fixed, bounded set of sources
  across the user's regular projects (no templates, guides or archived projects): assistant memory
  changed in the window (`assistantMemories`, only projects the user is still a member of), tasks
  the user owns and completed, notes and contacts the user edited last (with the beginning of each
  note's text through `NoteService.getStorageContent`), conversations the user wrote in during the
  window (with the assistant's replies), and open goals assigned to the user as context. Every object
  must pass `canAccessObject` for the user: their own private objects count, other members' never
  do. All range queries are single-field. The model gets two tools of its own, `save_profile` and
  `keep_profile`, and no Alldone tools, so it cannot run out of research budget before it saves,
  which is how the old task failed on 2026-11-11.
- **The window** starts at `cursorAt` (the start of the last run that dealt with its activity) and
  never reaches back more than 7 days. It only moves on when the run decided (`changed`,
  `unchanged`, or `no_activity`); a failure, a stop before the decision, a run without a decision or
  a conflict reads the same window again.
- **A quiet day costs nothing**: no activity, no model call. Goals do not count as activity.
- **The first version** starts from the global description the user wrote (and all of their
  assistant memory), so the switch-over loses nothing.
- **The user's own edit wins.** A run writes only over the revision it read
  (`assistantProfileStore.js`, `expectedRevision`); if the user saved meanwhile, the run's text is
  dropped (`conflict`).
- **Stops** mirror the wiki: user away 30 days → `owner_inactive`, `nextRunAt` null until they log
  in again; monthly cap → paused until the 1st (UTC), a cap raised during the run is re-checked on
  release; out of Gold → next night; a transient model error → retried in 7 minutes, at most 3 times
  in a row, enqueued by the run itself.
- **Gold**: `deductGold` with source `assistant_profile_update` (label in `GoldTransactionsModal.js`),
  default model DeepSeek V4 Flash, default monthly cap 300 (about 8 Gold for a busy night).

## On by default

`assistantProfileDefaults.js` creates an enabled profile (`enabledBy: 'default'`, first run at the
next 04:00) for every active user (login within 30 days) who has no document, from the daily
`applyAssistantProfileDefaults` sweep and from the user trigger when somebody comes back after 30
days. An existing document is a decision and is never switched back on; the only thing the default
changes on one is resuming an `owner_inactive` pause. Settings show a user the default has not
reached yet as on, and their first save keeps it on.

## The Updates line

`assistantProfileFeed.js` writes one line per changed version (`FEED_ASSISTANT_PROFILE_UPDATED`,
with `profileRevision`) and one per month when the cap pauses it (`FEED_ASSISTANT_PROFILE_PAUSED`),
into the user's **default project**, if they are still a member of it; without one there is no
line. Everything is private to the user: the feed object (`assistantProfiles` type), the entries and
the last state all carry `isPublicFor: [uid]`. **The object id is `assistantProfile_<uid>`, never the
bare uid**: `projectsFeeds/{p}/{day}/{id}` is keyed by id alone, and the bare uid is already the id of
the user's own `users` feed object (description, role, …) in the same project, which the profile's
object overwrote in the first local test. `canReadFeedObjectLastState` falls back to the stored
privacy for this type, so no rule change was needed. The line carries no profile text. The unread
counter is one fixed slot per user and day (`assistant_profile`), so it can never pile up in the
activity summary. The client renders it with `components/Feeds/FeedsObjects/AssistantProfileObject.js`
(registered in `FeedsList.js`, `getFeedObjectTypes` and `generateMissingFeedObject`, which only
rebuilds the object for its owner); "Show changes" opens `AssistantProfileChangeModal`, which reads
the revision from the owner-only tree and diffs it with `WikiDiffView`.

## Settings

Settings → Profile, below the description: `components/SettingsView/Profile/AssistantProfile/
AssistantProfileSection.js`. The switch, the editable text, last/next run, "Update now", recent
versions with their changes, and behind "Show settings" the instructions, the six sources, the
model (`ModelPicker`, exported from `ProjectWikiSettings.js`) and the monthly Gold limit.

## Tests

`functions/AssistantProfile/*.test.js` (sources and their privacy filters, the run's stops, window,
conflict and retry, settings, default, feed privacy, prompt context), the AT-3072 cases in
`assistantHelper.test.js` and `onUpdateUserFunctions.test.js`, and the client tests next to
`AssistantProfileSection.js` and `AssistantProfileObject.js`. The functions suites use the wiki's
`KnowledgeFirestoreDouble`, which gained `transaction.create` and `collection(...).doc(id)`.
