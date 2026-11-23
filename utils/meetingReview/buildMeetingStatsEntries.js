import {
    dedupeCalendarTasks,
    getCalendarEventBounds,
    getCalendarEventExclusionReason,
} from '../../functions/shared/meetingReview/calendarEventCounting'
import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import {
    MEETING_REVIEW_STATUS_RATED,
    isMeetingCategory,
    toMeetingDocId,
} from '../../functions/shared/meetingReview/meetingReviewConstants'

/**
 * AT-3137 — joins the calendar tasks of a period with the private reviews, series defaults and
 * learned rules into the entries `computeMeetingTimeStats` expects.
 *
 * Duplicates (same event in two connected calendars) are dropped before counting; the copy that
 * carries a review wins, then a completed one.
 */
export const buildMeetingStatsEntries = ({ tasks = [], reviews = {}, seriesCategories = {}, rules = [] }) => {
    const reviewOf = task => reviews[toMeetingDocId(task.id)] || null
    const ordered = tasks
        .slice()
        .sort(
            (a, b) =>
                Number(!!reviewOf(b)?.reviewStatus) - Number(!!reviewOf(a)?.reviewStatus) ||
                Number(!!b.done) - Number(!!a.done)
        )
    return dedupeCalendarTasks(ordered).map(task => {
        const review = reviewOf(task)
        const seriesId = task.calendarData?.recurringEventId
        const seriesDoc = seriesId ? seriesCategories[toMeetingDocId(seriesId)] : null
        const resolved = resolveMeetingCategory({
            task,
            review,
            seriesCategory: isMeetingCategory(seriesDoc?.category) ? seriesDoc.category : null,
            rules,
        })
        const bounds = getCalendarEventBounds(task.calendarData) || {}
        const rated = review?.reviewStatus === MEETING_REVIEW_STATUS_RATED
        return {
            id: task.id,
            name: task.name || '',
            projectId: task.projectId,
            startMs: bounds.startMs,
            endMs: bounds.endMs,
            excludedReason: getCalendarEventExclusionReason(task),
            done: !!task.done,
            category: resolved.confirmed ? resolved.category : null,
            categoryConfirmed: !!resolved.confirmed,
            suggestedCategory: resolved.confirmed ? null : resolved.category || resolved.candidates?.[0] || null,
            usefulness: rated ? review.usefulness || null : null,
            attendance: review?.attendance || null,
            actualStartMs: review?.actualStartMs ?? null,
            actualEndMs: review?.actualEndMs ?? null,
            task,
        }
    })
}
