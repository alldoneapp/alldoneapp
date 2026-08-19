import moment from 'moment'
import { settleWithinBudget } from './promiseBudget'

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

/**
 * How long the new-day flow waits for its Firestore writes before reloading
 * the app (AT-2367).
 *
 * The wait exists only so the common online case reloads with the user
 * document already acked; it is never a correctness requirement, because
 * Firestore's IndexedDB persistence keeps an unacked mutation in the queue
 * across the reload. Offline the writes return immediately anyway
 * (`awaitWriteAck`), so this budget is only ever spent on a slow-but-alive
 * connection — exactly the mobile case that used to hang the popup.
 */
export const NEW_DAY_WRITE_GRACE_MS = 1200

const runSync = (fn, onError, label) => {
    if (typeof fn !== 'function') return
    try {
        fn()
    } catch (error) {
        onError(error, label)
    }
}

const runAsync = (fn, onError, label) => {
    if (typeof fn !== 'function') return Promise.resolve()
    try {
        return Promise.resolve(fn()).catch(error => onError(error, label))
    } catch (error) {
        onError(error, label)
        return Promise.resolve()
    }
}

/**
 * Runs the "Start new day" acknowledgement (AT-2367).
 *
 * The popup used to close only as a side effect of work finishing: it awaited
 * the happiness writes, then the `statisticsModalDate` write, then a full app
 * reload whose own pre-work included a per-project Firestore scan and a service
 * worker update check. On mobile that chain is seconds; offline the first
 * `await` never resolves at all (a Firestore write promise settles on the
 * SERVER ack — AT-2340), so the popup stayed up forever with its spinner while
 * the mutation itself was already durable locally.
 *
 * The order here is deliberate and is the whole fix:
 *
 *   1. apply the acknowledgement to LOCAL state (redux + user cache) — no I/O,
 *   2. close the popup — before anything that can block,
 *   3. issue the writes, INDEPENDENTLY of each other, so a stalled happiness
 *      write can never keep the day itself from being acknowledged,
 *   4. reload only if this device actually crossed midnight while open, and
 *      never wait longer than `writeGraceMs` for step 3 first.
 *
 * Every dependency is injected: the helper stays free of redux/Firestore
 * imports, which is what makes the ordering guarantees testable at all.
 *
 * @returns {Promise<{statisticsModalDate: number, reloaded: boolean}>}
 */
export async function startNewDay({
    now = Date.now,
    applyLocalAcknowledgement,
    closePopup,
    persistAcknowledgement,
    persistHappinessDrafts,
    reloadApp,
    onError = () => {},
    writeGraceMs = NEW_DAY_WRITE_GRACE_MS,
    wait,
} = {}) {
    const statisticsModalDate = now()

    // 1 + 2 — synchronous, so the popup is gone in the same frame as the tap.
    runSync(() => applyLocalAcknowledgement(statisticsModalDate), onError, 'applyLocalAcknowledgement')
    runSync(closePopup, onError, 'closePopup')

    // 3 — started together, awaited by nobody the user is waiting on.
    const writes = Promise.all([
        runAsync(persistHappinessDrafts, onError, 'persistHappinessDrafts'),
        runAsync(() => persistAcknowledgement(statisticsModalDate), onError, 'persistAcknowledgement'),
    ])

    if (typeof reloadApp !== 'function') {
        await writes
        return { statisticsModalDate, reloaded: false }
    }

    await settleWithinBudget(writes, writeGraceMs, wait)
    await runAsync(reloadApp, onError, 'reloadApp')
    return { statisticsModalDate, reloaded: true }
}
