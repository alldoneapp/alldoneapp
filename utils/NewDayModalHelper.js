import moment from 'moment'

/**
 * Helpers for the "Start new day" (end-of-day statistics) modal.
 *
 * The user's confirmation of a new day is stored per user ACCOUNT as
 * `statisticsModalDate` on the `users/{uid}` document. That value is synced
 * live across every device the user is logged into via `watchLoggedUser`
 * (a Firestore `onSnapshot`), which makes it the single source of truth for
 * whether the modal still needs to be shown. A brand new day needs to be
 * acknowledged whenever the current calendar day is after the day of the last
 * acknowledged `statisticsModalDate`.
 *
 * Keeping the day-boundary decision here means the modal trigger and the
 * cross-device reconciliation always agree on what "a new day" is, and the
 * device-local midnight timer (`showNewDayNotification`) only acts as a wake
 * signal, never as an independent source of truth.
 */
export function needToAcknowledgeNewDay(statisticsModalDate, now = Date.now()) {
    return moment(now).isAfter(moment(statisticsModalDate), 'day')
}
