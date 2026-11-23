import store from '../../redux/store'
import { getStoredReview, isRatableMeetingTask } from './meetingReviewSelectors'
import { requestMeetingReview } from './meetingReviewStore'

/**
 * AT-3137 — called once a calendar task has been completed from its checkbox (click, keyboard,
 * swipe). The completion is already written: the sheet is an offer, never a gate (concept 2.1),
 * so nothing here can block or undo the completion.
 *
 * Only the calendar's owner is asked, and only for appointments that can count (not all-day,
 * cancelled or declined), and not again once rated or skipped. Tasks completed elsewhere (task detail, bulk, automations) get no sheet
 * and stay unrated until rated from the chip (E11).
 */
export const offerMeetingReviewAfterCompletion = (task, projectId) => {
    try {
        const uid = store.getState().loggedUser?.uid
        if (!task?.calendarData || !isRatableMeetingTask(task, uid)) return false
        // Already rated or skipped (e.g. completed again after a reschedule reopened it): the chip
        // is the way to change it, we do not ask twice.
        if (getStoredReview(task)?.reviewStatus) return false
        requestMeetingReview({ task: { ...task, projectId, done: true }, projectId })
        return true
    } catch (error) {
        console.error('[meetingReview] could not offer the rating', error)
        return false
    }
}
