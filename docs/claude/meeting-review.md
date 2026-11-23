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
differently ("Meetings in working time" vs "Recorded calendar time").

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
  membership from `projects/{pid}.userIds`, own tasks only, ≤ 45 days, indexed on
  `userId + calendarData.startMs` (new composite index) plus a bounded legacy query over the
  existing `(isPublicFor, inDone, userId, dueDate)` index for tasks synced before the new fields.
  Projects that fail are reported, never silently dropped.

Pinned by `functions/shared/meetingReview/*.test.js`, `functions/MeetingReview/meetingStatsData.test.js`,
the AT-3137 cases in `calendarTasks.test.js`, `calendarProjectClassifier.test.js`,
`calendarProjectRouting.test.js`, `CheckBoxWrapper.test.js`, `utils/meetingReview/*.test.js`,
`components/MeetingReview/*.test.js` and `firestoreRequiredIndexes.test.js`.
