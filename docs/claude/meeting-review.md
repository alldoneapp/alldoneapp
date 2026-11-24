# Meeting categories, usefulness rating and time statistics (AT-3137)

Added 2026-11-23. The concept artifact is `I1XDKGUd0ngAg5QStoOB` (project Alldone Product). Read
this before touching calendar task completion, the calendar sync fields, the meeting chip or
Settings → Meeting time.

## Two dimensions, never mixed

- **Category** (type, `functions/shared/meetingReview/meetingReviewConstants.js`): `work`,
  `stakeholder`, `status`, `network` ("Netzwerk & Austausch", chosen over "Netzwerk & Persönlich"
  on 2026-11-23, E7), `own_time`. Suggested, confirmed by the user.
- **Usefulness** (judgement): `worthwhile`, `partly`, `not_helpful`, or unrated. **Only the user
  sets it.** Nothing (series, rules, AI, title) ever proposes or copies a usefulness. "Pointless" is
  not a category; it is `not_helpful` in any category.

## Where the data lives (privacy)

Everything personal is under `users/{uid}/…` (owner-only by the existing
`users/{userId}/{userSubcollection}/{document=**}` rule, no rules change):

- `meetingReviews/{taskId}`: category (+ source, confirmedAt), usefulness, reviewStatus
  (`rated`/`skipped`), attendance, actualStartMs/actualEndMs, startMs/endMs, and the server-written
  `aiSuggestion`. Doc ids go through `toMeetingDocId` (Microsoft ids may contain `/`).
- `meetingSeriesCategories/{seriesId}`: the series default category.
- `meetingCategoryRules/{pattern}`: learned rules (visible and deletable in the statistics).

The shared calendar task only gained **counts and times** (`calendarData.startMs/endMs/isAllDay/
attendeeCount/externalAttendeeCount/selfResponseStatus`, `getCalendarMeetingFields` in
`functions/GoogleCalendarTasks/calendarTasks.js`): calendar tasks are readable by project members,
so no addresses or names are stored. Decided with the user 2026-11-23. A task synced before this is
updated once (the sync compares calendarData) to gain them.

## Suggestions: one LLM call, not two

The category suggestion rides the **existing** calendar project routing call
(`calendarProjectClassifier.js`, decided with the user): extra JSON keys `meetingCategory`,
`meetingCategoryConfidence`, `meetingCategorySignals`, coerced by `coerceMeetingCategorySuggestion`
(unknown category → null, confidence capped at "medium", "why" lines that judge the meeting are
dropped). No extra Gold, no extra data sent. The sync writes it as `aiSuggestion` into the owner's
private review doc (`writeMeetingCategorySuggestion`), merge-only. When the routing run does not
happen (routing off, not premium, already routed, learned series route), the client falls back to
rules and keywords. Priority: user > series default > learned rule > "no other participants →
own time" > AI > keywords (`resolveMeetingCategory`). Low confidence preselects nothing.

A series exception never becomes a title rule (series learn through their default).

## Counting rules (shared with AT-3136)

`calendarEventCounting.js` and `meetingTimeStats.js` are pure and importable from app and
functions. All-day, cancelled and declined do not count; duplicates (same id, or same title+time
from two calendars) count once; overlaps split evenly so each wall-clock minute counts once;
future parts of open appointments are "still planned"; past open ones count as unrated (E2);
unconfirmed categories are "Category open" (E1); "not helpful" is a range (👎 … 👎+〰️); shares use
the largest-remainder method so they sum to exactly 100 %. Day boundaries come from the caller
(device-local moment, like the task lists), so DST days are 23/25 h.

AT-3136 (meetings in working time, All Projects line) was not started in the repo when this was
built; it should reuse these helpers instead of defining its own, and label its number
differently ("Meetings in working time" vs "Recorded calendar time"). Since then AT-3136 was built with its own
union-based maths in `utils/meetingTimeToday.js` and leaves reliably solo work blocks out
(`calendarData.soloEvent`/`workBlock`, see `calendar-reminders-whatsapp.md`); the statistics here do
not use those fields.

## Flow

- `CheckBoxWrapper` calls `offerMeetingReviewAfterCompletion` **after** `moveTasksFromOpen`
  resolves (never on failure). The row unmounts after completion, so the sheet lives in
  `MeetingReviewHost` (mounted once in AppContent next to the New Day popup) fed by
  `utils/meetingReview/meetingReviewStore.js` (a small external store, not redux, so rows
  re-render only for their own review). Task rows import only `meetingReviewSelectors.js` and the
  store; the Firestore backend is required lazily, otherwise every TaskPresentation test loads
  `utils/backends/firestore.js`.
- Completion from other places (task detail, bulk, automations) shows no sheet; the chip on the
  done task and the detail section ("Rating (only visible to you)") rate later.
- Statistics: Settings → Meeting time (`/settings/meeting-time`). Data comes from the callable
  `getMeetingTimeStatsDataSecondGen` (`functions/MeetingReview/meetingStatsData.js`): caller only,
  membership from `projects/{pid}.userIds`, own tasks only, ≤ 45 days, a range on
  `calendarData.startMs` alone (Firestore's automatic single-field index; the owner filter runs in
  code) plus a bounded legacy query over the
  existing `(isPublicFor, inDone, userId, dueDate)` index for tasks synced before the new fields.
  Projects that fail are reported, never silently dropped.
- **By project and in the project details (AT-3145, 2026-11-24).** Decided with the user: the
  statistics stay their own tab (no merge into Settings → Statistics, layout unchanged) and gain a
  project breakdown. Settings → Meeting time has a "By project" table; a row narrows the whole view
  to that project (the table keeps listing every project). Project details → Meeting time
  (`/project/{pid}/meeting-time`, `ProjectMeetingTimeView`, hidden without project access like
  Statistics/Happiness) shows the same view fixed to the project. It is still the **caller's own
  appointments and private ratings only**: other members of the project see their own, never
  someone else's. `computeMeetingTimeStats({ projectId })` splits overlaps against **every**
  project's appointments first and only then counts the scoped project, so per-project figures add
  up to the all-projects total; that is why the app still loads all projects (no server-side
  project filter in the callable). `projectRows` is the per-project breakdown.
- **Navigation (AT-3145).** "Time to work" in the All projects line opens Settings → Meeting time
  (it opened Settings → Customizations before); without a calendar it still opens Integrations.
  The statistics show the working hours ("Arbeitsfenster", from `users/{uid}/bookingSettings/default`
  via `resolveWorkingHours`, default labelled) with a link to Settings → Customizations, where they
  are edited. No second working-hours setting.
- **Meeting-free work time per day (AT-3145 follow-up, 2026-11-24).** User request: "how much
  actual working time free of meetings did I have per day, over time". A block at the top of
  Settings → Meeting time (and the project tab), `MeetingFreeTimeSeries` fed by the pure
  `utils/meetingReview/meetingFreeWorkTime.js`: per local day `free = working window − union of
meetings clipped to the window`, a column chart for week/month (scrolls on month), a time line
  for a day, a per-day table. Labelled as **calendar-derived** time without appointments, never as
  measured/productive time. Decided with the user (all four recommendations):
    - **Always global.** The free time subtracts every own appointment of every project. A project
      scope (filter row or `/project/{pid}/meeting-time`) only adds `scopedMeetingMs`, the time in
      which at least one appointment of that project ran (union, not the even split of the usefulness
      statistics), shown as "of which {project}" and a darker part of the meeting segment, with a
      hint that the free time is across all projects.
    - **Days without any calendar entry** (not even all-day/excluded ones) count as free but are
      flagged `noCalendarEntries` (faded, "?", counted in the summary). Reason: there is no
      scheduled server-side sync (`taskBoardCalendarSync.js`); the sync reads from "today" on and
      keeps past tasks, so a day on which the app was never opened has no meetings at all, and later
      calendar changes to past days are not reflected.
    - **Workdays** follow the existing "Include weekends" switch (`includeWeekends`, default off) of the
      same booking settings; without it Saturday/Sunday have no window and are left out of the totals.
      "Time to work" in the All projects line still ignores it.
    - **Review corrections count**: "not attended" occupies nothing, an adjusted duration replaces the
      planned one. Past appointments never checked off still occupied the calendar and count.
    - Like "Time to work": all-day, cancelled, declined and multi-day timed events are not busy;
      reliably solo work blocks (`soloEvent && workBlock`) are work time. The callable now passes those
      two booleans on (`pickCalendarData`); until it is deployed they are missing and the blocks count
      as meetings (only ever too little free time). `buildMeetingStatsEntries` sets
      `entry.soloWorkBlock` and keeps a slot a meeting when another calendar imported the same event as
      a normal meeting.
    - The **current** working hours apply to past days (no history of the setting); the UI says so.
      Windows are set by wall clock per day (`getWorkingWindowForDay`), so DST days keep 9–17.
    - Only days whose window has ended count in totals/averages; today is drawn faded from the
      calendar plan, future days get no values. No calendar connected (`loggedUser.apisConnected`) →
      no series, a hint instead; failed/truncated loads → "may be too high" warning.
    - Chart colours: free `#2a78d6`/`#3987e5`, meetings `#e87ba4`/`#d55181` (light/dark via
      `modeColor`), checked with the dataviz palette validator; every value is also printed.
- **Header spacing (AT-3145 layout fix, 2026-11-24).** The title row ("Zeitstatistik" plus
  Day/Week/Month) uses the header box of Settings → Statistics, Project → Statistics and Happiness
  (`StatisticsHeader`, `StatisticsSectionHeader`, `UserHappiness`): min height 72, padding 32 on
  top and 12 below, on mobile too (column, no vertical padding of its own). It had only the min
  height with `flexWrap`, so the row packed to the top and sat on the tab divider. Pinned by "keeps
  the Statistics tab spacing" in `MeetingTimeStatistics.test.js`.
- **Memory: 512MiB, not 256MiB (AT-3145 incident, 2026-11-24).** At 256MiB the callable was
  killed with "Memory limit of 256 MiB exceeded" (258-271 MiB) at 12:32, 12:48 and 14:26 UTC, before
  and after !946, so the app showed "Die Statistik konnte nicht geladen werden". It fans out three
  task queries per member project (`Promise.all`, 141 projects = 423 queries for the reporting user)
  on top of the whole `functions/index.js` loaded at cold start; the 256MiB functions of this
  codebase have little headroom (other 256MiB functions log the same OOM occasionally). Do not lower
  it again; if it grows, project a field mask or bound the per-project concurrency first. Pinned by
  "deployment configuration" in `meetingStatsData.test.js`.
- **No composite index on purpose.** The first version filtered `userId ==` plus the range and
  declared a composite index; CI never creates indexes (`ci-cd.md`), so the master pipeline's
  `check:firestore:indexes:production` failed after the merge (pipeline 3104346584) and the query
  would have failed in production. A single-field range needs nothing deployed by hand. Keep it
  that way unless someone creates the index interactively first.

Pinned by `functions/shared/meetingReview/*.test.js` (project scope: the AT-3145 block in
`meetingTimeStats.test.js`), `utils/meetingReview/meetingFreeWorkTime.test.js` and the
"meeting-free work time" block in `MeetingTimeStatistics.test.js`, `MeetingTimeToday.test.js` (click target), `functions/MeetingReview/meetingStatsData.test.js`,
the AT-3137 cases in `calendarTasks.test.js`, `calendarProjectClassifier.test.js`,
`calendarProjectRouting.test.js`, `CheckBoxWrapper.test.js`, `utils/meetingReview/*.test.js`,
`components/MeetingReview/*.test.js` and `firestoreRequiredIndexes.test.js`.
