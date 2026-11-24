import { resolveMeetingCategory } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import { getCalendarEventExclusionReason } from '../../functions/shared/meetingReview/calendarEventCounting'
import { normalizeMeetingCategory, toMeetingDocId } from '../../functions/shared/meetingReview/meetingReviewConstants'
import { getMeetingReviewState } from './meetingReviewStore'

/**
 * AT-3137 — read-only helpers over the meeting review store. Kept free of Firestore imports: the
 * task row (checkbox, tags) imports these, and the row must not pull the backend module into every
 * list render and test.
 */

/** A calendar task the logged-in user can rate: their own, timed (not all-day), not cancelled/declined. */
export const isRatableMeetingTask = (task, uid) =>
    !!task &&
    !!uid &&
    !!task.calendarData &&
    task.userId === uid &&
    !task.isSubtask &&
    getCalendarEventExclusionReason(task) === null

export const getSeriesCategory = (task, state = getMeetingReviewState()) => {
    const seriesId = task?.calendarData?.recurringEventId
    if (!seriesId) return null
    const doc = state.seriesCategories[toMeetingDocId(seriesId)]
    // A series default saved as a retired key counts as its merged category (AT-3147).
    return doc ? normalizeMeetingCategory(doc.category) : null
}

export const getStoredReview = (task, state = getMeetingReviewState()) =>
    (task?.id && state.reviews[toMeetingDocId(task.id)]) || null

export const resolveTaskMeetingCategory = (task, state = getMeetingReviewState()) =>
    resolveMeetingCategory({
        task,
        review: getStoredReview(task, state),
        seriesCategory: getSeriesCategory(task, state),
        rules: state.rules,
    })
