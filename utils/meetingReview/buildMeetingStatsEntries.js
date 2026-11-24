import {
    dedupeCalendarTasks,
    getCalendarEventBounds,
    getCalendarEventExclusionReason,
    normalizeTitleForDedupe,
} from '../../functions/shared/meetingReview/calendarEventCounting'
import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import {
    MEETING_REVIEW_STATUS_RATED,
    isMeetingCategory,
    toMeetingDocId,
} from '../../functions/shared/meetingReview/meetingReviewConstants'
import { isSoloWorkBlock } from '../meetingTimeToday'

const getSlotKey = task => {
    const bounds = getCalendarEventBounds(task.calendarData)
    const title = normalizeTitleForDedupe(task.name || task.extendedName)
    return bounds && title ? `${title}\u0000${bounds.startMs}\u0000${bounds.endMs}` : null
}

/**
 * AT-3137 — joins the calendar tasks of a period with the private reviews, series defaults and
 * learned rules into the entries `computeMeetingTimeStats` expects.
 *
 * Duplicates (same event in two connected calendars) are dropped before counting; the copy that
 * carries a review wins, then a completed one.
 *
 * `soloWorkBlock` (AT-3145, meeting-free work time) follows "Time to work": a reliably solo work
 * block is work time, but when the same event also came from another calendar as a normal meeting,
 * the slot stays a meeting whichever copy survived the deduplication.
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
    const meetingSlots = new Set()
    tasks.forEach(task => {
        if (!task || isSoloWorkBlock(task)) return
        const slot = getSlotKey(task)
        if (slot) meetingSlots.add(slot)
    })
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
            soloWorkBlock: isSoloWorkBlock(task) && !meetingSlots.has(getSlotKey(task)),
            task,
        }
    })
}
